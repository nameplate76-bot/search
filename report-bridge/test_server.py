import json, tempfile, threading, unittest
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from server import Bridge,Failure,Handler,ThreadingHTTPServer,relative_path

class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.nas=self.root/'NAS';self.nas.mkdir()
  self.folder=self.nas/'학교'/'상록중학교'/'03 진행'/'제출용';self.folder.mkdir(parents=True)
  self.name='제5권 기계설비 성능점검 보고서-상록중학교(기준일 25.04.18).pdf'
  self.pdf=self.folder/self.name;self.pdf.write_bytes(b'%PDF-1.4\nreadonly test fixture\n%%EOF')
  (self.folder/'상록중학교(기준일 24.04.18).pdf').write_bytes(b'other year')
  self.config={'nas_root':str(self.nas),'database':str(self.root/'private'/'links.sqlite'),'allowed_origins':['https://portal.example.test'],'supabase_url':'https://example.supabase.co','supabase_key':'test'}
  self.b=Bridge(self.config);self.payload={'folder':'학교/상록중학교','reference_date':'2025-04-18','preferred_file':self.name};self.b.save(10,self.payload)
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
  with self.assertRaises(Failure):self.b.save(11,{'folder':'학교/상록중학교','reference_date':'2025-02-30'})
 def test_unmapped_and_missing(self):
  self.assertEqual(self.b.files(999),([],False))
  self.b.save(11,{'folder':'missing'})
  with self.assertRaises(Failure):self.b.files(11)
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
   with call('mapping',token='admin',body=self.payload) as r:self.assertEqual(r.status,200)
   with call('reports') as r:
    result=json.load(r);self.assertTrue(result['connected']);self.assertNotIn('_path',result['files'][0]);file_id=result['files'][0]['id']
   with call('files/'+file_id+'?view=1') as r:
    self.assertEqual(r.headers['Content-Type'],'application/pdf');self.assertEqual(r.read(),self.pdf.read_bytes())
   with self.assertRaises(HTTPError) as e:call('files/'+'0'*64);self.assertEqual(e.exception.code,404)
  finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
