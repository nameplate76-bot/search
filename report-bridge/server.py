"""Read-only NAS document bridge. Run privately behind an HTTPS reverse proxy."""
import argparse, hashlib, json, mimetypes, os, re, sqlite3, threading, time
from pathlib import Path, PurePosixPath
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, urlencode, quote
from urllib.error import HTTPError

EXTENSIONS={'.pdf','.hwp','.hwpx','.xlsx','.xls','.docx','.doc','.zip'}
class Failure(Exception):
    def __init__(self,status,message): self.status,self.message=status,message

def relative_path(value):
    value=str(value).strip().replace('\\','/')
    p=PurePosixPath(value)
    if not value or p.is_absolute() or ':' in value or any(x in ('..','.') for x in value.split('/')):
        raise Failure(400,'NAS 기준 폴더 아래의 상대 경로를 입력하세요. Z: 및 .. 는 사용할 수 없습니다.')
    return p.as_posix()

def inside(root,path):
    resolved=path.resolve()
    try: resolved.relative_to(root.resolve())
    except ValueError: raise Failure(403,'허용된 보고서 폴더 밖에는 접근할 수 없습니다.')
    return resolved

def date_tokens(value):
    if not value: return []
    try:
        import datetime
        date=datetime.date.fromisoformat(value)
    except ValueError: raise Failure(400,'실시기준일은 YYYY-MM-DD로 입력하세요.')
    return [date.strftime('%Y%m%d'),date.strftime('%y%m%d')]

class Bridge:
    def __init__(self,config):
        self.config=config
        self.root=Path(config['nas_root'])
        self.db=Path(config['database']);self.db.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as c: c.execute('CREATE TABLE IF NOT EXISTS mappings (site_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
        self.lock=threading.BoundedSemaphore(4)
    def connect(self): return sqlite3.connect(self.db,timeout=10)
    def mapping(self,site_id):
        with self.connect() as c: row=c.execute('SELECT payload FROM mappings WHERE site_id=?',(site_id,)).fetchone()
        return json.loads(row[0]) if row else None
    def save(self,site_id,payload):
        folder=relative_path(payload.get('folder',''));inside(self.root,self.root/folder)
        date=str(payload.get('reference_date','')).strip();date_tokens(date)
        preferred=str(payload.get('preferred_file','')).strip()
        if len(folder)>1500 or len(preferred)>500 or '/' in preferred or '\\' in preferred:
            raise Failure(400,'폴더 경로 또는 파일명을 확인하세요.')
        result={'folder':folder,'reference_date':date,'preferred_file':preferred}
        with self.connect() as c:c.execute('INSERT INTO mappings VALUES (?,?) ON CONFLICT(site_id) DO UPDATE SET payload=excluded.payload',(site_id,json.dumps(result,ensure_ascii=False)))
        return result
    def files(self,site_id):
        mapping=self.mapping(site_id)
        if not mapping: return [],False
        if not self.root.is_dir(): raise Failure(503,'NAS 기준 폴더에 접근할 수 없습니다. 연결 프로그램을 실행한 PC의 NAS 연결을 확인하세요.')
        anchor=inside(self.root,self.root/mapping['folder'])
        if not anchor.is_dir(): raise Failure(404,'연결한 현장 폴더가 없습니다. 관리자에게 현장 폴더 위치 수정을 요청하세요.')
        tokens=date_tokens(mapping.get('reference_date',''));found=[];visited=0;deadline=time.monotonic()+15
        def walk_error(error): raise Failure(503,'일부 보고서 폴더를 읽을 수 없습니다. NAS 권한을 확인하세요.')
        for current,dirs,names in os.walk(anchor,followlinks=False,onerror=walk_error):
            if time.monotonic()>deadline: raise Failure(503,'폴더 검색 시간이 초과되었습니다. 검색 범위를 현장 폴더로 좁혀 주세요.')
            base=Path(current);depth=len(base.relative_to(anchor).parts)
            dirs[:]=[d for d in dirs if not (base/d).is_symlink()] if depth<int(self.config.get('max_depth',10)) else []
            visited+=len(names)
            if visited>int(self.config.get('max_scan_files',10000)): raise Failure(413,'현장 폴더에 파일이 너무 많습니다. 검색 범위를 좁혀 주세요.')
            for name in names:
                path=base/name
                if path.is_symlink() or path.suffix.lower() not in EXTENSIONS:continue
                if tokens and not any(t in re.sub(r'\D','',name) for t in tokens):continue
                path=inside(anchor,path)
                stat=path.stat();relative=path.relative_to(anchor).as_posix()
                file_id=hashlib.sha256(relative.encode('utf-8')).hexdigest()
                found.append({'id':file_id,'name':name,'folder':path.parent.relative_to(anchor).as_posix(),'size':stat.st_size,'modified':stat.st_mtime,'pdf':path.suffix.lower()=='.pdf','preferred':name==mapping.get('preferred_file'),'_path':path})
                if len(found)>500:raise Failure(413,'보고서 후보가 너무 많습니다. 실시기준일을 설정하세요.')
        found.sort(key=lambda r:(not r['preferred'],r['name'],r['folder']))
        return found,True
    def remote(self,path,token):
        base=self.config['supabase_url'].rstrip('/')
        req=Request(base+path,headers={'apikey':self.config['supabase_key'],'Authorization':'Bearer '+token})
        try:
            with urlopen(req,timeout=8) as r:return json.load(r)
        except HTTPError as e:
            if e.code in (401,403):raise Failure(401,'로그인이 만료되었거나 조회 권한이 없습니다.')
            raise Failure(503,'포털 권한 확인에 실패했습니다.')
        except (OSError,ValueError):raise Failure(503,'포털 인증 서버에 연결할 수 없습니다.')
    def authorize(self,token,site_id):
        if not token:raise Failure(401,'포털 로그인이 필요합니다.')
        user=self.remote('/auth/v1/user',token)
        user_id=str(user.get('id',''))
        if not re.fullmatch(r'[0-9a-fA-F-]{36}',user_id):raise Failure(401,'사용자 확인 실패')
        profiles=self.remote('/rest/v1/pjt_profiles?'+urlencode({'id':'eq.'+user_id,'select':'role,approved,can_use_staff_portal,can_view_staff_sites'}),token)
        if not profiles:raise Failure(403,'사용자 권한이 없습니다.')
        p=profiles[0]
        if not p.get('approved') or not p.get('can_use_staff_portal') or not (p.get('role')=='admin' or p.get('can_view_staff_sites')):
            raise Failure(403,'현장 조회 권한이 없습니다.')
        sites=self.remote('/rest/v1/staff_site_search?'+urlencode({'source_id':'eq.'+str(site_id),'select':'source_id','limit':'1'}),token)
        if not sites:raise Failure(404,'조회할 현장이 없습니다.')
        return p

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # Never log tokens, file paths or request URLs.
    def cors(self):
        origin=self.headers.get('Origin')
        if origin and origin not in self.server.bridge.config['allowed_origins']:raise Failure(403,'허용되지 않은 포털 주소입니다.')
        return origin
    def response_headers(self,origin):
        if origin:self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
    def json_reply(self,status,value,origin=None):
        data=json.dumps(value,ensure_ascii=False).encode('utf-8');self.send_response(status);self.response_headers(origin);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):
        try:
            origin=self.cors();self.send_response(204);self.response_headers(origin);self.send_header('Access-Control-Allow-Methods','GET, PUT, OPTIONS');self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type');self.end_headers()
        except Failure as e:self.json_reply(e.status,{'error':e.message})
    def do_GET(self):self.dispatch()
    def do_PUT(self):self.dispatch()
    def dispatch(self):
        origin=None
        try:
            origin=self.cors();url=urlsplit(self.path)
            m=re.fullmatch(r'/api/sites/([1-9][0-9]*)/(reports|mapping|files/([a-f0-9]{64}))',url.path)
            if not m:raise Failure(404,'존재하지 않는 요청입니다.')
            site_id=int(m[1]);operation=m[2];bridge=self.server.bridge
            auth=self.headers.get('Authorization','');token=auth[7:] if auth.startswith('Bearer ') else ''
            profile=bridge.authorize(token,site_id)
            if operation=='mapping':
                if profile.get('role')!='admin':raise Failure(403,'폴더 연결 설정은 관리자만 변경할 수 있습니다.')
                if self.command=='GET':return self.json_reply(200,{'mapping':bridge.mapping(site_id)},origin)
                size=int(self.headers.get('Content-Length','0'))
                if size<=0 or size>8192:raise Failure(413,'설정 요청 크기를 확인하세요.')
                body=json.loads(self.rfile.read(size))
                if not isinstance(body,dict):raise Failure(400,'설정 형식을 확인하세요.')
                result=bridge.save(site_id,body)
                return self.json_reply(200,{'mapping':result},origin)
            if self.command!='GET':raise Failure(405,'읽기 전용 기능입니다.')
            if not bridge.lock.acquire(blocking=False):raise Failure(503,'다른 보고서 검색을 처리 중입니다. 잠시 후 다시 조회하세요.')
            try:files,connected=bridge.files(site_id)
            finally:bridge.lock.release()
            if operation=='reports':
                clean=[{k:v for k,v in item.items() if k!='_path'} for item in files]
                return self.json_reply(200,{'connected':connected,'files':clean},origin)
            selected=next((item for item in files if item['id']==m[3]),None)
            if not selected:raise Failure(404,'파일 위치가 변경되었거나 파일이 없습니다. 목록을 새로 조회하세요.')
            limit=int(bridge.config.get('max_download_bytes',209715200))
            if selected['size']>limit:raise Failure(413,'웹 열람 한도를 초과한 파일입니다. ipDISK에서 다운로드하세요.')
            mode='inline' if url.query=='view=1' and selected['pdf'] else 'attachment'
            with selected['_path'].open('rb') as file:
                self.send_response(200);self.response_headers(origin)
                self.send_header('Content-Type','application/pdf' if selected['pdf'] else 'application/octet-stream')
                self.send_header('Content-Disposition',mode+"; filename*=UTF-8''"+quote(selected['name']))
                self.send_header('Content-Length',str(selected['size']));self.end_headers()
                while chunk:=file.read(65536):self.wfile.write(chunk)
        except Failure as e:self.json_reply(e.status,{'error':e.message},origin)
        except (ValueError,TypeError):self.json_reply(400,{'error':'입력 형식을 확인하세요.'},origin)
        except (BrokenPipeError,ConnectionResetError):pass
        except OSError:self.json_reply(503,{'error':'보고서 파일 또는 연결 설정에 접근할 수 없습니다.'},origin)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',default='config.json');args=parser.parse_args()
    config=json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    if not config.get('allowed_origins') or not config.get('nas_root') or not config.get('supabase_url','').startswith('https://'):raise SystemExit('config.json의 포털 주소, NAS 기준 폴더, 인증 설정을 확인하세요.')
    server=ThreadingHTTPServer(('127.0.0.1',int(config.get('port',8787))),Handler);server.bridge=Bridge(config)
    print('Report bridge listening on loopback. HTTPS reverse proxy is required for portal access.');server.serve_forever()
if __name__=='__main__':main()
