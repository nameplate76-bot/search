"""Read-only NAS document bridge. Run privately behind an HTTPS reverse proxy."""
import argparse, hashlib, json, mimetypes, os, re, sqlite3, threading, time, unicodedata
from pathlib import Path, PurePosixPath
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, urlencode, quote, parse_qs
from urllib.error import HTTPError

EXTENSIONS={'.pdf','.hwp','.hwpx','.xlsx','.xls','.docx','.doc','.zip'}
BRIDGE_VERSION='R8'
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

def probe_directory(path):
    # is_dir() can hide unavailable-share/access errors as a missing directory.
    with os.scandir(path) as entries:
        next(entries,None)

def load_config(filename):
    config_path=Path(filename).expanduser().resolve()
    config=json.loads(config_path.read_text(encoding='utf-8-sig'))
    # All relative paths are anchored to the selected configuration, never process cwd.
    for key in ('database','nas_root'):
        if key not in config:raise ValueError('config.json 필수 설정 누락: '+key)
        path=Path(config[key]).expanduser()
        config[key]=str(path if path.is_absolute() else (config_path.parent/path).resolve())
    config['config_file']=str(config_path)
    config['nas_root_candidates']=[str(Path(v).expanduser() if Path(v).expanduser().is_absolute() else (config_path.parent/Path(v)).resolve()) for v in config.get('nas_root_candidates',[])]
    return config

def windows_unc(path):
    # Reuse Windows' authenticated drive mapping; never store NAS credentials.
    if os.name!='nt':return None
    try:
        import ctypes
        from ctypes import wintypes
        size=wintypes.DWORD(0)
        api=ctypes.WinDLL('mpr').WNetGetUniversalNameW
        api.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,ctypes.c_void_p,ctypes.POINTER(wintypes.DWORD)]
        api.restype=wintypes.DWORD
        if api(str(path),1,None,ctypes.byref(size))!=234:return None
        buffer=ctypes.create_string_buffer(size.value)
        if api(str(path),1,buffer,ctypes.byref(size))!=0:return None
        return ctypes.cast(buffer,ctypes.POINTER(wintypes.LPWSTR)).contents.value
    except (OSError,ValueError,AttributeError):return None

def folder_name(value):return unicodedata.normalize('NFC',value).strip()

class Bridge:
    def __init__(self,config):
        self.config=config
        self.root=Path(config['nas_root'])
        self.configured_root=self.root
        self.recovery_info={}
        self.path_lock=threading.RLock()
        self.db=Path(config['database']);self.db.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as c:
            c.execute('CREATE TABLE IF NOT EXISTS mappings (site_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
            c.execute('CREATE TABLE IF NOT EXISTS mapping_history (site_id INTEGER NOT NULL, payload TEXT NOT NULL, changed_at REAL NOT NULL, reason TEXT NOT NULL)')
        self.root_state=self.db.parent/'nas-root-state.json'
        self.remembered_root=None
        try:
            state=json.loads(self.root_state.read_text(encoding='utf-8'))
            if state.get('configured_root')==str(self.configured_root):self.remembered_root=Path(state['effective_root'])
        except (OSError,ValueError,KeyError):pass
        self.lock=threading.BoundedSemaphore(4)
    def connect(self): return sqlite3.connect(self.db,timeout=10)
    def mapping(self,site_id):
        with self.connect() as c: row=c.execute('SELECT payload FROM mappings WHERE site_id=?',(site_id,)).fetchone()
        return json.loads(row[0]) if row else None
    def save(self,site_id,payload):
        with self.path_lock:return self._save(site_id,payload)
    def _save(self,site_id,payload):
        folder=relative_path(payload.get('folder',''));inside(self.root,self.root/folder)
        date=''
        preferred=str(payload.get('preferred_file','')).strip()
        if len(folder)>1500 or len(preferred)>500 or '/' in preferred or '\\' in preferred:
            raise Failure(400,'폴더 경로 또는 파일명을 확인하세요.')
        allowed=payload.get('allowed_files')
        if allowed is not None:
            if not isinstance(allowed,list) or len(allowed)>100:raise Failure(400,'조회 파일은 100개 이내로 선택하세요.')
            allowed=list(dict.fromkeys(relative_path(v) for v in allowed if str(v).strip()))
            if any(len(v)>1500 for v in allowed):raise Failure(400,'선택 파일 경로가 너무 깁니다.')
        result={'folder':folder,'reference_date':'','preferred_file':preferred}
        if allowed is not None:result['allowed_files']=allowed
        with self.connect() as c:c.execute('INSERT INTO mappings VALUES (?,?) ON CONFLICT(site_id) DO UPDATE SET payload=excluded.payload',(site_id,json.dumps(result,ensure_ascii=False)))
        return result
    def _report_anchor(self,folder):
        stage='root';last_error=None
        for attempt in range(3):
            try:
                stage='root';probe_directory(self.root)
                stage='folder';anchor=inside(self.root,self.root/relative_path(folder)) if folder else inside(self.root,self.root)
                probe_directory(anchor)
                return anchor
            except PermissionError:
                raise Failure(503,'NAS 폴더 접근 권한이 없습니다. 연결 프로그램을 실행한 계정의 NAS 접근 권한을 확인하세요.')
            except OSError as error:
                last_error=error
                if attempt<2:time.sleep((0.5,1.0)[attempt])
        if stage=='root':
            raise Failure(503,'NAS 기준 폴더에 접근할 수 없습니다. NAS 재부팅·재연결 상태와 연결 프로그램 PC의 NAS 연결을 확인하세요.')
        # A dropped connection between the root and folder checks is not a missing folder.
        try:probe_directory(self.root)
        except OSError:raise Failure(503,'NAS 연결이 일시적으로 끊겼습니다. 연결 복구 후 다시 조회하세요. 폴더 연결정보를 다시 등록할 필요는 없습니다.')
        if isinstance(last_error,(FileNotFoundError,NotADirectoryError)):
            raise Failure(404,'연결한 현장 폴더가 없습니다. 관리자에게 현장 폴더 위치 수정을 요청하세요.')
        raise Failure(503,'NAS 현장 폴더를 읽을 수 없습니다. 연결 프로그램 PC의 NAS 연결 상태와 접근 권한을 확인하세요.')
    def remember_root(self):
        effective=windows_unc(self.root) or str(self.root)
        if effective==str(self.configured_root):return
        temporary=self.root_state.with_suffix('.tmp')
        try:
            temporary.write_text(json.dumps({'configured_root':str(self.configured_root),'effective_root':effective},ensure_ascii=False),encoding='utf-8')
            os.replace(temporary,self.root_state)
            self.remembered_root=Path(effective)
        except OSError:pass  # A failed state write never invalidates existing mappings.
    def report_anchor(self,folder):
        configured=self.configured_root
        if os.name=='nt' and self.remembered_root and str(configured)!=str(self.remembered_root):
            # A reused drive letter must never redirect a known share to another NAS.
            if windows_unc(configured)!=str(self.remembered_root):configured=None
        candidates=[self.remembered_root,configured,*map(Path,self.config.get('nas_root_candidates',[]))]
        seen=set();last=None;missing_root=None;missing_error=None
        for root in candidates:
            if root is None or str(root) in seen:continue
            seen.add(str(root));self.root=root
            try:
                anchor=self._report_anchor(folder);self.remember_root();return anchor
            except Failure as error:
                if error.status not in (404,503):raise
                last=error
                if error.status==404 and missing_root is None:missing_root=root;missing_error=error
        self.root=missing_root or self.configured_root
        raise missing_error or last or Failure(503,'NAS 기준 폴더를 읽을 수 없습니다.')
    def recover_anchor(self,site_id,mapping):
        # Never search the NAS as a whole or match a site merely by a similar name.
        parts=PurePosixPath(relative_path(mapping['folder'])).parts
        try:probe_directory(self.root)
        except OSError:raise Failure(503,'NAS 재연결 대기 중입니다. 기존 폴더 연결정보는 유지됩니다.')
        anchor=self.root;matched=0
        for part in parts:
            exact=inside(self.root,anchor/part)
            try:probe_directory(exact);anchor=exact;matched+=1;continue
            except (FileNotFoundError,NotADirectoryError):pass
            except OSError:raise Failure(503,'NAS 폴더 접근이 불안정합니다. 잠시 후 다시 조회하세요.')
            try:
                choices=[x for x in anchor.iterdir() if not x.is_symlink() and x.is_dir() and folder_name(x.name)==folder_name(part)]
            except OSError:raise Failure(503,'NAS 폴더 목록을 읽을 수 없습니다.')
            if len(choices)>1:raise Failure(409,'동일하게 보이는 폴더가 여러 개입니다. 관리자 확인이 필요합니다. 기존 연결은 유지됩니다.')
            if len(choices)==1:anchor=inside(self.root,choices[0]);matched+=1;continue
            break
        if matched==len(parts):return anchor
        # At least three unchanged components must anchor the exact site's subtree.
        preferred=str(mapping.get('preferred_file','')).strip()
        if matched<int(self.config.get('recovery_min_anchor_depth',3)) or not preferred:
            raise Failure(404,'연결한 현장 폴더가 없습니다. 같은 현장 안에서 안전하게 복구할 근거가 부족합니다. 연결 상태 확인으로 NAS 기준 폴더와 저장 경로를 확인하세요.')
        tokens=[]
        if tokens and not any(t in re.sub(r'\D','',preferred) for t in tokens):
            raise Failure(404,'저장된 우선 파일명과 실시기준일이 달라 자동 복구하지 않았습니다.')
        matches=[];visited=0;deadline=time.monotonic()+8
        def walk_error(error):raise Failure(503,'NAS 재연결 또는 권한 문제로 복구 검색을 완료하지 못했습니다.')
        for current,dirs,names in os.walk(anchor,followlinks=False,onerror=walk_error):
            if time.monotonic()>deadline:raise Failure(503,'같은 현장 안의 복구 검색 시간이 초과되었습니다. 기존 연결은 유지됩니다.')
            base=Path(current);depth=len(base.relative_to(anchor).parts)
            dirs[:]=[v for v in dirs if not (base/v).is_symlink()] if depth<int(self.config.get('max_depth',10)) else []
            visited+=len(names)
            if visited>int(self.config.get('max_scan_files',10000)):raise Failure(413,'복구 검색 범위를 초과했습니다. 기존 연결은 유지됩니다.')
            if preferred in names:
                target=base/preferred
                if not target.is_symlink() and target.is_file():matches.append(inside(self.root,base))
                if len(matches)>1:raise Failure(409,'같은 우선 파일명이 여러 위치에 있습니다. 잘못된 보고서 연결을 막기 위해 자동 복구하지 않았습니다.')
        if len(matches)!=1:raise Failure(404,'연결한 현장 폴더가 없습니다. 기존 우선 파일명을 같은 현장 안에서 찾지 못했습니다. 기존 연결정보는 유지됩니다.')
        return matches[0]
    def resolve_mapping(self,site_id,mapping):
        try:return self.report_anchor(mapping['folder'])
        except Failure as error:
            if error.status!=404:raise
        anchor=self.recover_anchor(site_id,mapping)
        folder=anchor.relative_to(self.root.resolve()).as_posix()
        updated={**mapping,'folder':folder}
        probe_directory(anchor)
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            current=c.execute('SELECT payload FROM mappings WHERE site_id=?',(site_id,)).fetchone()
            if not current or json.loads(current[0])!=mapping:raise Failure(409,'다른 관리자가 연결정보를 변경했습니다. 다시 조회하세요.')
            c.execute('INSERT INTO mapping_history VALUES (?,?,?,?)',(site_id,current[0],time.time(),'verified-path-recovery'))
            c.execute('UPDATE mappings SET payload=? WHERE site_id=?',(json.dumps(updated,ensure_ascii=False),site_id))
        self.recovery_info[site_id]={'previous_folder':mapping['folder'],'folder':folder,'message':'같은 현장 안에서 기존 보고서 위치를 확인하여 연결 경로를 복구했습니다.'}
        mapping.update(updated);self.remember_root();return anchor
    def files(self,site_id):
        with self.path_lock:return self._files(site_id)
    def folders(self,folder=''):
        with self.path_lock:
            folder=relative_path(folder) if folder else ''
            anchor=self.report_anchor(folder)
            entries=[];count=0;deadline=time.monotonic()+8
            try:
                with os.scandir(anchor) as scan:
                    for entry in scan:
                        count+=1
                        if count>10000 or time.monotonic()>deadline:raise Failure(413,'폴더 목록 범위를 초과했습니다. 하위 경로를 입력하여 다시 선택하세요.')
                        if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):continue
                        child=inside(self.root,Path(entry.path))
                        entries.append({'name':entry.name,'path':child.relative_to(self.root.resolve()).as_posix()})
                        if len(entries)>1000:raise Failure(413,'폴더가 너무 많습니다. 하위 경로를 입력하여 다시 선택하세요.')
            except PermissionError:raise Failure(503,'이 폴더를 읽을 권한이 없습니다. 연결 PC의 NAS 접근 권한을 확인하세요.')
            except OSError:raise Failure(503,'NAS 폴더 목록을 읽을 수 없습니다. 연결 상태를 확인하세요.')
            return {'folder':folder,'parent':str(PurePosixPath(folder).parent) if '/' in folder else '', 'folders':sorted(entries,key=lambda x:x['name']), 'bridge_version':BRIDGE_VERSION}
    def candidates(self,site_id,folder):
        with self.path_lock:return self._files(site_id,True,folder)
    def _files(self,site_id,candidates=False,folder=None):
        mapping={'folder':relative_path(folder)} if candidates else self.mapping(site_id)
        if not mapping: return [],False
        preferred=unicodedata.normalize('NFC',str(mapping.get('preferred_file','')).strip())
        allowed=mapping.get('allowed_files')
        selectors=allowed if isinstance(allowed,list) else ([preferred] if preferred else [])
        selectors=[unicodedata.normalize('NFC',v) for v in selectors]
        if not candidates and not selectors:return [],True
        anchor=self.report_anchor(mapping['folder']) if candidates else self.resolve_mapping(site_id,mapping)
        tokens=[];found=[];visited=0;deadline=time.monotonic()+15
        def walk_error(error): raise Failure(503,'일부 보고서 폴더를 읽을 수 없습니다. NAS 권한을 확인하세요.')
        for current,dirs,names in os.walk(anchor,followlinks=False,onerror=walk_error):
            if time.monotonic()>deadline: raise Failure(503,'폴더 검색 시간이 초과되었습니다. 검색 범위를 현장 폴더로 좁혀 주세요.')
            base=Path(current);depth=len(base.relative_to(anchor).parts)
            dirs[:]=[d for d in dirs if not (base/d).is_symlink()] if depth<int(self.config.get('max_depth',10)) else []
            visited+=len(names)
            if visited>int(self.config.get('max_scan_files',10000)): raise Failure(413,'현장 폴더에 파일이 너무 많습니다. 검색 범위를 좁혀 주세요.')
            for name in names:
                relative_name=(base/name).relative_to(anchor).as_posix()
                if not candidates and not any(unicodedata.normalize('NFC',relative_name)==v or ('/' not in v and unicodedata.normalize('NFC',name)==v) for v in selectors):continue
                path=base/name
                if path.is_symlink() or path.suffix.lower() not in EXTENSIONS:continue
                if tokens and not any(t in re.sub(r'\D','',name) for t in tokens):continue
                path=inside(anchor,path)
                stat=path.stat();relative=path.relative_to(anchor).as_posix()
                file_id=hashlib.sha256(relative.encode('utf-8')).hexdigest()
                found.append({'id':file_id,'name':name,'relative_path':relative,'folder':path.parent.relative_to(anchor).as_posix(),'size':stat.st_size,'modified':stat.st_mtime,'pdf':path.suffix.lower()=='.pdf','preferred':name==mapping.get('preferred_file'),'_path':path})
                if len(found)>500:raise Failure(413,'보고서 후보가 너무 많습니다. 실시기준일을 설정하세요.')
        if not candidates and any('/' not in v and sum(unicodedata.normalize('NFC',f['name'])==v for f in found)>1 for v in selectors):raise Failure(409,'동일한 파일명이 여러 폴더에 있습니다. 관리자 파일 목록에서 정확한 파일을 선택하세요.')
        found.sort(key=lambda r:(not r['preferred'],r['name'],r['folder']))
        return found,True
    def mapping_count(self):
        with self.connect() as c:return c.execute('SELECT COUNT(*) FROM mappings').fetchone()[0]
    def diagnostics(self,site_id):
        mapping=self.mapping(site_id)
        result={'bridge_version':BRIDGE_VERSION,'process_id':os.getpid(),'nas_root':str(self.root),'source_file':str(Path(__file__).resolve()),'site_id':site_id,'mapping':mapping,'configured_nas_root':str(self.configured_root),'mapping_database':str(self.db.resolve()),'config_file':self.config.get('config_file',''),'mapping_count':self.mapping_count()}
        try:
            files,connected=self.files(site_id)
            result.update(connected=connected,http_status=200,file_count=len(files),message='실행 중인 연결 프로그램에서 보고서 검색 성공' if connected else '이 현장에 폴더 연결정보가 없습니다.')
        except Failure as error:
            result.update(connected=bool(mapping),http_status=error.status,file_count=0,message=error.message)
        except OSError:
            result.update(connected=bool(mapping),http_status=503,file_count=0,message='실행 중인 프로그램에서 NAS 파일을 읽을 수 없습니다.')
        result.update(nas_root=str(self.root),mapping=self.mapping(site_id),recovery=self.recovery_info.get(site_id))
        return result
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
    def authorize_admin(self,token):
        """Authorize administrator-only folder browsing without requiring a site row.

        Folder discovery is a bridge-PC operation.  Requiring the selected
        site's RLS-visible row here made the same admin account behave
        differently across browsers when that row was not visible through the
        portal query.  Actual report listing/download still uses authorize().
        """
        if not token:raise Failure(401,'포털 로그인이 필요합니다.')
        user=self.remote('/auth/v1/user',token)
        user_id=str(user.get('id',''))
        if not re.fullmatch(r'[0-9a-fA-F-]{36}',user_id):raise Failure(401,'사용자 확인 실패')
        profiles=self.remote('/rest/v1/pjt_profiles?'+urlencode({'id':'eq.'+user_id,'select':'role,approved,can_use_staff_portal'}),token)
        if not profiles:raise Failure(403,'사용자 권한이 없습니다.')
        p=profiles[0]
        if not p.get('approved') or not p.get('can_use_staff_portal') or p.get('role')!='admin':
            raise Failure(403,'관리자 권한이 필요합니다.')
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
            m=re.fullmatch(r'/api/sites/([1-9][0-9]*)/(reports|mapping|diagnostics|candidates|folders|files/([a-f0-9]{64}))',url.path)
            if not m:raise Failure(404,'존재하지 않는 요청입니다.')
            site_id=int(m[1]);operation=m[2];bridge=self.server.bridge
            auth=self.headers.get('Authorization','');token=auth[7:] if auth.startswith('Bearer ') else ''
            profile=None if operation in ('folders','candidates') else bridge.authorize(token,site_id)
            if operation=='diagnostics':
                if profile.get('role')!='admin':raise Failure(403,'연결 상태 확인은 관리자만 사용할 수 있습니다.')
                if self.command!='GET':raise Failure(405,'읽기 전용 기능입니다.')
                if not bridge.lock.acquire(blocking=False):raise Failure(503,'다른 보고서 검색을 처리 중입니다. 잠시 후 다시 확인하세요.')
                try:result=bridge.diagnostics(site_id)
                finally:bridge.lock.release()
                return self.json_reply(200,result,origin)
            if operation=='folders':
                profile=bridge.authorize_admin(token)
                if self.command!='GET':raise Failure(405,'읽기 전용 기능입니다.')
                if not bridge.lock.acquire(blocking=False):raise Failure(503,'다른 보고서 검색을 처리 중입니다. 잠시 후 다시 조회하세요.')
                try:result=bridge.folders(parse_qs(url.query).get('folder',[''])[0])
                finally:bridge.lock.release()
                return self.json_reply(200,result,origin)
            if operation=='candidates':
                profile=bridge.authorize_admin(token)
                if self.command!='GET':raise Failure(405,'읽기 전용 기능입니다.')
                folder=parse_qs(url.query).get('folder',[''])[0]
                if not bridge.lock.acquire(blocking=False):raise Failure(503,'다른 보고서 검색을 처리 중입니다. 잠시 후 다시 조회하세요.')
                try:items,connected=bridge.candidates(site_id,folder)
                finally:bridge.lock.release()
                return self.json_reply(200,{'files':[{k:v for k,v in item.items() if k!='_path'} for item in items],'bridge_version':BRIDGE_VERSION},origin)
            if operation=='mapping':
                if profile.get('role')!='admin':raise Failure(403,'폴더 연결 설정은 관리자만 변경할 수 있습니다.')
                if self.command=='GET':return self.json_reply(200,{'mapping':bridge.mapping(site_id)},origin)
                size=int(self.headers.get('Content-Length','0'))
                if size<=0 or size>131072:raise Failure(413,'설정 요청 크기를 확인하세요.')
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
                return self.json_reply(200,{'connected':connected,'files':clean,'bridge_version':BRIDGE_VERSION,'recovery_message':bridge.recovery_info.get(site_id,{}).get('message','')},origin)
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
    parser=argparse.ArgumentParser();parser.add_argument('--config',default=str(Path(__file__).resolve().with_name('config.json')));args=parser.parse_args()
    config=load_config(args.config)
    if not config.get('allowed_origins') or not config.get('nas_root') or not config.get('supabase_url','').startswith('https://'):raise SystemExit('config.json의 포털 주소, NAS 기준 폴더, 인증 설정을 확인하세요.')
    server=ThreadingHTTPServer(('127.0.0.1',int(config.get('port',8787))),Handler);server.bridge=Bridge(config)
    print('Config: '+config.get('config_file','')+' | Mapping DB: '+str(server.bridge.db)+' | Mappings: '+str(server.bridge.mapping_count())+' | NAS root: '+str(server.bridge.root),flush=True)
    print('Report bridge '+BRIDGE_VERSION+' listening on loopback. PID '+str(os.getpid())+'. HTTPS reverse proxy is required for portal access.',flush=True);server.serve_forever()
if __name__=='__main__':main()
