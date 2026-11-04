import importlib.util,json,sqlite3,threading,unittest,urllib.request,urllib.error,tempfile,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
spec=importlib.util.spec_from_file_location('desktop',Path(__file__).parents[1]/'desktop.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Checks(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.path=Path(self.temp.name)/'test.sqlite3';self.store=m.Store(self.path)
  with self.store.connect() as db:db.execute('DELETE FROM data');db.execute('DELETE FROM history')
 def test_persistence_and_order(self):
  self.store.put('project',json.dumps({'schema':1,'title':'new'}),2);self.store.put('project',json.dumps({'schema':1,'title':'old'}),1)
  self.assertEqual(json.loads(m.Store(self.path).get('project'))['title'],'new')
  with self.assertRaises(ValueError):self.store.put('project','[]',3)
  self.assertEqual(self.store.revisions['project'],2)
 def test_history(self):
  for i in range(30):self.store.put('project',json.dumps({'schema':1,'n':i}),i+1)
  value=self.store.get('project');self.store.put('project',value,31)
  with self.store.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM history').fetchone()[0],20)
 def test_price_update_and_restore(self):
  old={'schema':1,'title':'before'};libs=[{'name':'old'}]
  self.store.put('project',json.dumps(old),1);self.store.put('libraries',json.dumps(libs),2)
  self.store.price_update({'project':{'schema':1,'title':'after'},'libraries':[{'name':'new'}]},3)
  self.assertEqual(json.loads(self.store.get('project'))['title'],'after')
  self.assertEqual(json.loads(self.store.get('priceUpdateBackup')),{'project':old,'libraries':libs})
  self.store.price_update({},4,restore=True)
  self.assertEqual(json.loads(self.store.get('project')),old);self.assertEqual(json.loads(self.store.get('libraries')),libs)
  self.assertEqual(self.store.get('priceUpdateBackup'),'null')
 def test_price_update_failure_rolls_back_everything(self):
  old={'schema':1,'title':'before'};self.store.put('project',json.dumps(old),1);self.store.put('libraries','[]',2)
  with self.store.connect() as db:
   db.execute("CREATE TRIGGER reject_library_update BEFORE INSERT ON data WHEN NEW.key='libraries' BEGIN SELECT RAISE(ABORT,'test failure'); END")
  with self.assertRaises(sqlite3.IntegrityError):self.store.price_update({'project':{'schema':1,'title':'after'},'libraries':[]},3)
  self.assertEqual(json.loads(self.store.get('project')),old);self.assertEqual(self.store.get('priceUpdateBackup'),'null')
  self.assertEqual(self.store.revisions['project'],1)
 def test_workbench_archive(self):
  archive={'projects':[{'schema':1,'title':'보관 공사','lines':[]}],'templates':[],'printStyles':[]}
  self.store.put('workbench',json.dumps(archive),1)
  self.assertEqual(json.loads(m.Store(self.path).get('workbench'))['projects'][0]['title'],'보관 공사')
  with self.assertRaises(ValueError):self.store.put('workbench','{"projects":[]}',2)
 def test_http(self):
  server=m.ThreadingHTTPServer(('127.0.0.1',0),m.Handler);server.allowed_host=f'127.0.0.1:{server.server_port}';server.store=self.store
  threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://{server.allowed_host}/{m.TOKEN}/'
  try:
   fresh=json.load(urllib.request.urlopen(base+'desktop.json'));self.assertEqual(fresh['seedNeeded'],bool(m.SEEDS));self.assertEqual(fresh['seedFiles'],m.SEEDS)
   self.store.put('libraries','[]',1)
   self.assertFalse(json.load(urllib.request.urlopen(base+'desktop.json'))['seedNeeded'])
   req=urllib.request.Request(base+'api/data/project',data=json.dumps({'revision':2,'value':{'schema':1,'title':'roundtrip'}}).encode(),headers={'Content-Type':'application/json'})
   self.assertTrue(json.load(urllib.request.urlopen(req))['saved'])
   self.assertEqual(json.load(urllib.request.urlopen(base+'api/data/project'))['title'],'roundtrip')
   req=urllib.request.Request(base+'api/prices/apply',data=json.dumps({'revision':3,'value':{'project':{'schema':1,'title':'updated'},'libraries':[{'name':'updated DB'}]}}).encode(),headers={'Content-Type':'application/json'})
   self.assertTrue(json.load(urllib.request.urlopen(req))['saved'])
   self.assertEqual(json.load(urllib.request.urlopen(base+'api/data/priceUpdateBackup'))['project']['title'],'roundtrip')
   req=urllib.request.Request(base+'api/prices/restore',data=json.dumps({'revision':4,'value':{}}).encode(),headers={'Content-Type':'application/json'})
   self.assertTrue(json.load(urllib.request.urlopen(req))['saved'])
   self.assertEqual(json.load(urllib.request.urlopen(base+'api/data/project'))['title'],'roundtrip')
   for url,headers in [(base+'api/data/project',{'Origin':'https://example.com'}),(f'http://{server.allowed_host}/api/data/project',{}),(base+'../desktop.py',{})]:
    with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(urllib.request.Request(url,headers=headers))
    self.assertIn(e.exception.code,[403,404])
  finally:server.shutdown();server.server_close()
 def test_close_guard(self):
  class Window:
   destroyed=False
   def evaluate_js(self,script,callback):self.callback=callback;ready.set()
   def destroy(self):self.destroyed=True
  ready=threading.Event();window=Window();g=m.CloseGuard(window)
  self.assertFalse(g.closing());self.assertTrue(ready.wait(2));window.callback({'ok':False});self.assertFalse(window.destroyed)
  g.finished({'ok':True});self.assertTrue(window.destroyed);self.assertTrue(g.closing())
if __name__=='__main__':unittest.main(verbosity=2)
