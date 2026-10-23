import json, tempfile, threading, unittest
from unittest.mock import patch
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from server import Bridge,Failure,Handler,ThreadingHTTPServer,relative_path,load_config

class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.nas=self.root/'NAS';self.nas.mkdir()
  self.folder=self.nas/'학교'/'상록중학교'/'03 진행'/'제출용';self.folder.mkdir(parents=True)
  self.name='제5권 기계설비 성능점검 보고서-상록중학교(기준일 25.04.18).pdf'
  self.pdf=self.folder/self.name;self.pdf.write_bytes(b'%PDF-1.4\nreadonly test fixture\n%%EOF')
  (self.folder/'상록중학교(기준일 24.04.18).pdf').write_bytes(b'other year')
  self.config={'nas_root':str(self.nas),'database':str(self.root/'private'/'links.sqlite'),'allowed_origins':['https://portal.example.test'],'supabase_url':'https://example.supabase.co','supabase_key':'test'}
  self.b=Bridge(self.config);self.payload={'folder':'학교/상록중학교','reference_date':'','preferred_file':self.name};self.b.save(10,self.payload)
 def tearDown(self):self.temp.cleanup()
 def test_folder_rename(self):
  files,_=self.b.files(10);self.assertEqual(len(files),1);self.assertTrue(files[0]['preferred'])
  old_id=files[0]['id'];(self.nas/'학교'/'상록중학교'/'03 진행').rename(self.nas/'학교'/'상록중학교'/'04 완료')
  files,_=self.b.files(10);self.assertEqual(files[0]['name'],self.name);self.assertNotEqual(files[0]['id'],old_id)
  self.assertIn('04 완료',files[0]['folder'])
 def test_paths_and_symlinks(self):
  for p in ['../other','/etc','Z:\\VOL1','학교/../other','학교/./x']:
   with self.assertRaises(Failure):relative_path(p)
  (self.nas/'학교'/'상록중학교'/'outside.pdf').symlink_to(self.root/'outside.pdf')
  (self.root/'outside.pdf').write_bytes(b'secret');files,_=self.b.files(10);self.assertEqual(len(files),1)
  self.assertEqual(self.b.save(11,{'folder':'학교/상록중학교','reference_date':'2025-02-30'})['reference_date'],'')
 def test_multiple_files_and_no_date_filter(self):
  other=self.folder/'보고서(26.04.18).pdf';other.write_bytes(b'new year')
  selected=[self.pdf.relative_to(self.nas/'학교'/'상록중학교').as_posix(),other.relative_to(self.nas/'학교'/'상록중학교').as_posix()]
  self.b.save(10,{**self.payload,'reference_date':'','allowed_files':selected})
  self.assertEqual(len(self.b.files(10)[0]),2)
  self.assertEqual(self.b.mapping(10)['reference_date'],'')
  candidates,_=self.b.candidates(10,'학교/상록중학교')
  self.assertEqual(len(candidates),3)
  self.assertEqual(len(self.b.files(10)[0]),2)
  self.b.save(10,{**self.payload,'allowed_files':[]})
  self.assertEqual(self.b.files(10)[0],[])
  with self.assertRaises(Failure):self.b.save(10,{**self.payload,'allowed_files':['../outside.pdf']})
 def test_admin_folder_browser(self):
  before=self.b.mapping(10)
  root=self.b.folders();self.assertEqual(root['folder'],'');self.assertIn('학교',[x['name'] for x in root['folders']])
  actual=self.folder.relative_to(self.nas).as_posix()
  listing=self.b.folders(actual);self.assertEqual(listing['folder'],actual)
  self.assertEqual(self.b.mapping(10),before)
  with self.assertRaises(Failure):self.b.folders('../escape')
  with self.assertRaises(Failure):self.b.folders('missing')
  (self.nas/'외부').symlink_to(self.root,target_is_directory=True)
  self.assertNotIn('외부',[x['name'] for x in self.b.folders()['folders']])
  with self.assertRaises(Failure):self.b.folders('외부')
  candidate_root=self.root/'replacement';shutil=__import__('shutil');shutil.copytree(self.nas,candidate_root,symlinks=True)
  self.config['nas_root_candidates']=[str(candidate_root)];self.nas.rename(self.root/'offline')
  self.assertGreater(len(self.b.candidates(10,actual)[0]),0)
 def test_exact_file_restriction(self):
  (self.folder/'다른보고서(25.04.18).pdf').write_bytes(b'other')
  (self.folder/'자료.zip').write_bytes(b'zip')
  self.assertEqual([f['name'] for f in self.b.files(10)[0]],[self.name])
  self.b.save(10,{**self.payload,'preferred_file':'없는파일.pdf'})
  self.assertEqual(self.b.files(10)[0],[])
  self.b.save(10,{**self.payload,'preferred_file':''})
  self.assertEqual(self.b.files(10)[0],[])
  self.b.save(10,self.payload)
  sub=self.folder/'중복';sub.mkdir();(sub/self.name).write_bytes(b'duplicate')
  with self.assertRaises(Failure) as e:self.b.files(10)
  self.assertEqual(e.exception.status,409)
 def test_unmapped_and_missing(self):
  self.assertEqual(self.b.files(999),([],False))
  self.b.save(11,{'folder':'missing','preferred_file':self.name})
  with self.assertRaises(Failure):self.b.files(11)
 def test_transient_nas_reconnect(self):
  self.b.save(12,{'folder':'학교/상록중학교','reference_date':'','preferred_file':self.name})
  from server import probe_directory
  calls=[]
  def transient(path):
   calls.append(str(path))
   if len(calls)==2:raise FileNotFoundError('transient share reconnect')
   return probe_directory(path)
  with patch('server.probe_directory',side_effect=transient),patch('server.time.sleep') as delay:
   files,connected=self.b.files(12)
   self.assertTrue(connected);self.assertEqual(len(files),1)
   self.assertEqual(delay.call_count,1)
  self.assertEqual(self.b.mapping(12)['folder'],'학교/상록중학교')
 def test_nas_errors_are_not_missing_folders(self):
  with patch('server.probe_directory',side_effect=PermissionError('denied')),patch('server.time.sleep') as delay:
   with self.assertRaises(Failure) as e:self.b.files(10)
   self.assertEqual(e.exception.status,503);self.assertIn('권한',e.exception.message);delay.assert_not_called()
  with patch('server.probe_directory',side_effect=OSError('network unavailable')),patch('server.time.sleep') as delay:
   with self.assertRaises(Failure) as e:self.b.files(10)
   self.assertEqual(e.exception.status,503);self.assertEqual(delay.call_count,2)
 def test_diagnostic_content(self):
  result=self.b.diagnostics(10)
  self.assertEqual(result['bridge_version'],'R8');self.assertEqual(result['file_count'],1)
  self.assertEqual(result['nas_root'],str(self.nas));self.assertNotIn('supabase_key',result)
 def test_config_relative_paths_independent_of_working_directory(self):
  directory=self.root/'installation';directory.mkdir();config={**self.config,'database':'private/links.sqlite','nas_root':'NAS'}
  filename=directory/'config.json';filename.write_text(json.dumps(config))
  loaded=load_config(filename)
  self.assertEqual(loaded['database'],str(directory/'private'/'links.sqlite'))
  self.assertEqual(loaded['nas_root'],str(directory/'NAS'))
 def test_existing_mapping_survives_process_restart(self):
  second=Bridge(self.config);self.assertEqual(second.mapping(10),self.payload)
  self.assertEqual(second.files(10)[0][0]['name'],self.name)
 def test_remembered_unc_survives_drive_unavailable(self):
  import shutil
  unc=self.root/'unc-share';shutil.copytree(self.nas,unc)
  with patch('server.windows_unc',return_value=str(unc)):self.b.files(10)
  self.nas.rename(self.root/'drive-disconnected')
  second=Bridge(self.config)
  self.assertEqual(second.files(10)[0][0]['name'],self.name)
  self.assertEqual(second.root,unc)
 def recovery_fixture(self):
  folder=self.nas/'유지관리'/'학교'/'상록중학교'/'03 진행'/'제출용';folder.mkdir(parents=True)
  (folder/self.name).write_bytes(b'%PDF-test')
  payload={'folder':folder.relative_to(self.nas).as_posix(),'reference_date':'','preferred_file':self.name}
  self.b.save(20,payload);return folder,payload
 def test_unique_existing_file_recovers_stage_folder_and_keeps_backup(self):
  folder,old=self.recovery_fixture();folder.parent.rename(folder.parent.with_name('04 완료'))
  files,connected=self.b.files(20);self.assertTrue(connected);self.assertEqual(len(files),1)
  self.assertIn('04 완료',self.b.mapping(20)['folder'])
  self.assertEqual(self.b.mapping(20)['reference_date'],old['reference_date'])
  with self.b.connect() as c:history=c.execute('select payload from mapping_history where site_id=20').fetchall()
  self.assertEqual(json.loads(history[0][0]),old)
  self.assertEqual(Bridge(self.config).files(20)[0][0]['name'],self.name)
 def test_ambiguous_recovery_does_not_replace_mapping(self):
  folder,old=self.recovery_fixture();folder.parent.rename(folder.parent.with_name('04 완료'))
  other=folder.parent.parent/'05 보관';other.mkdir();(other/self.name).write_bytes(b'other')
  with self.assertRaises(Failure) as e:self.b.files(20)
  self.assertEqual(e.exception.status,409);self.assertEqual(self.b.mapping(20),old)
 def test_never_search_another_site(self):
  folder,old=self.recovery_fixture();import shutil;shutil.rmtree(folder.parent.parent)
  other=self.nas/'유지관리'/'학교'/'다른학교';other.mkdir();(other/self.name).write_bytes(b'other')
  with self.assertRaises(Failure):self.b.files(20)
  self.assertEqual(self.b.mapping(20),old)
 def test_unicode_directory_normalization_recovers_without_name_guessing(self):
  import unicodedata
  folder=self.nas/'유지관리'/'학교'/'상록중학교'/'제출용';folder.mkdir(parents=True)
  (folder/self.name).write_bytes(b'%PDF-test')
  path='/'.join(unicodedata.normalize('NFD',v) for v in folder.relative_to(self.nas).parts)
  self.b.save(30,{'folder':path,'reference_date':'','preferred_file':self.name})
  files,connected=self.b.files(30);self.assertTrue(connected);self.assertEqual(len(files),1)
  self.assertEqual(self.b.mapping(30)['folder'],folder.relative_to(self.nas).as_posix())
 def test_authorization(self):
  with self.assertRaises(Failure):self.b.authorize('',10)
  def remote(path,token):
   if path.startswith('/auth'):return {'id':'a'*8+'-'+'a'*4+'-'+'a'*4+'-'+'a'*4+'-'+'a'*12}
   if '/pjt_profiles?' in path:return [{'approved':True,'can_use_staff_portal':True,'can_view_staff_sites':token!='denied','role':'admin' if token=='admin' else 'viewer'}]
   return [{'source_id':10}]
  self.b.remote=remote
  with self.assertRaises(Failure):self.b.authorize('denied',10)
  self.assertEqual(self.b.authorize('viewer',10)['role'],'viewer')
  server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.bridge=self.b;thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  base='http://127.0.0.1:'+str(server.server_port)+'/api/sites/10/'
  def call(route,token='viewer',origin='https://portal.example.test',body=None):
   headers={'Origin':origin,'Authorization':'Bearer '+token}
   data=json.dumps(body).encode() if body is not None else None
   return urlopen(Request(base+route,data=data,headers=headers,method='PUT' if data else 'GET'),timeout=5)
  try:
   with self.assertRaises(HTTPError) as e:call('reports',token='');self.assertEqual(e.exception.code,401)
   with self.assertRaises(HTTPError) as e:call('reports',origin='https://evil.test');self.assertEqual(e.exception.code,403)
   with self.assertRaises(HTTPError) as e:call('mapping',body=self.payload);self.assertEqual(e.exception.code,403)
   with self.assertRaises(HTTPError) as e:call('diagnostics');self.assertEqual(e.exception.code,403)
   with call('diagnostics',token='admin') as r:
    result=json.load(r);self.assertEqual(result['bridge_version'],'R8');self.assertEqual(result['site_id'],10)
    self.assertEqual(result['file_count'],1);self.assertNotIn('supabase_key',result)
   with call('mapping',token='admin',body=self.payload) as r:self.assertEqual(r.status,200)
   with self.assertRaises(HTTPError) as denied:call('candidates?folder=%E5%AD%A6%E6%A0%A1')
   self.assertEqual(denied.exception.code,403)
   from urllib.parse import quote
   with call('candidates?folder='+quote('학교/상록중학교'),token='admin') as candidate_response:self.assertGreaterEqual(len(json.load(candidate_response)['files']),2)
   with self.assertRaises(HTTPError) as denied:call('folders')
   self.assertEqual(denied.exception.code,403)
   with call('folders',token='admin') as response:self.assertIn('학교',[x['name'] for x in json.load(response)['folders']])
   with call('reports') as r:
    result=json.load(r);self.assertTrue(result['connected']);self.assertNotIn('_path',result['files'][0]);file_id=result['files'][0]['id']
   with call('files/'+file_id+'?view=1') as r:
    self.assertEqual(r.headers['Content-Type'],'application/pdf');self.assertEqual(r.read(),self.pdf.read_bytes())
   import hashlib
   other=self.folder/'다른파일(25.04.18).pdf';other.write_bytes(b'not permitted')
   excluded_id=hashlib.sha256(other.relative_to(self.nas/'학교'/'상록중학교').as_posix().encode()).hexdigest()
   with self.assertRaises(HTTPError) as denied:call('files/'+excluded_id)
   self.assertEqual(denied.exception.code,404)
   with self.assertRaises(HTTPError) as e:call('files/'+'0'*64);self.assertEqual(e.exception.code,404)
  finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
