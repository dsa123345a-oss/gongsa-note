from pathlib import Path
from contextlib import closing
import copy
import hashlib
import io
import json
import os
import sqlite3
import zipfile
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import updater as u
import desktop as d


class Updates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.target = self.home / '공사노트.exe'
        self.target.write_bytes(b'MZold')
        self.exe_body = b'MZnew-application'
        content=io.BytesIO()
        with zipfile.ZipFile(content,'w') as package:
            package.writestr(u.APP_EXE,self.exe_body)
            package.writestr('_internal_0_6_0/release.json',json.dumps({'version':'0.6.0','distribution':'folder-v1'}))
            package.writestr('_internal_0_6_0/test.dll',b'runtime-data')
        self.body=content.getvalue()
        self.manifest = {'version':'0.6.0', 'asset':u.ASSET, 'size':len(self.body), 'sha256':hashlib.sha256(self.body).hexdigest()}
        self.release = {'tag_name':'v0.6.0', 'draft':False, 'prerelease':False, 'body':'업데이트 내용', 'assets':[{'name':u.ASSET,'size':len(self.body),'browser_download_url':u.asset_url('example/gongsa-note','v0.6.0',u.ASSET)}, {'name':'update.json','browser_download_url':u.asset_url('example/gongsa-note','v0.6.0','update.json')}]}
        self.manager = u.UpdateManager({'version':'0.5.0','repository':'example/gongsa-note'}, self.home, self.target)

    def stage(self):
        self.manager.candidate = u.validate_release(self.release,self.manifest,'example/gongsa-note','0.5.0')
        with patch.object(u,'open_url',return_value=io.BytesIO(self.body)):
            self.manager.download()
        return self.manager.ready

    def test_numeric_versions_and_no_prereleases(self):
        self.assertGreater(u.version_tuple('v0.10.0'),u.version_tuple('0.9.0'))
        for value in ('1.0','1.2.3-rc1','01.2.3','1.2.3/../../x',None):
            with self.assertRaises(ValueError):u.version_tuple(value)

    def test_unconfigured_makes_no_network_request(self):
        manager = u.UpdateManager({'version':'0.6.0','repository':''},self.home)
        with patch.object(u,'open_url') as network:
            with self.assertRaises(ValueError):manager.start('check')
            network.assert_not_called()
        self.assertEqual(manager.snapshot()['phase'],'unconfigured')

    def test_check_and_download_verified_release(self):
        with patch.object(u,'read_json',side_effect=[self.release,self.manifest]):self.manager.check()
        self.assertEqual(self.manager.snapshot()['phase'],'available')
        self.assertEqual(self.stage().read_bytes(),self.exe_body)
        self.assertEqual(self.manager.snapshot()['phase'],'ready')
        self.assertEqual(self.target.read_bytes(),b'MZold')

    def test_current_and_older_never_download(self):
        for tag in ('v0.5.0','v0.4.0'):
            release={**self.release,'tag_name':tag}
            with patch.object(u,'read_json',return_value=release) as fetch:self.manager.check()
            self.assertEqual(fetch.call_count,1)
            self.assertEqual(self.manager.snapshot()['phase'],'current')

    def test_manifest_mismatch_and_external_asset_rejected(self):
        for key,value in [('version','0.7.0'),('asset','evil.exe'),('size',True),('size',0),('size',u.MAX_EXE+1),('sha256','x'*64)]:
            with self.subTest(key=key,value=value):
                with self.assertRaises(ValueError):u.validate_release(self.release,{**self.manifest,key:value},'example/gongsa-note','0.5.0')
        for value in ['https://evil.example/app.exe',u.asset_url('other/repo','v0.6.0',u.ASSET)]:
            release=copy.deepcopy(self.release);release['assets'][0]['browser_download_url']=value
            with self.assertRaises(ValueError):u.validate_release(release,self.manifest,'example/gongsa-note','0.5.0')
        for key in ['draft','prerelease']:
            with self.assertRaises(ValueError):u.validate_release({**self.release,key:True},self.manifest,'example/gongsa-note','0.5.0')

    def test_redirect_rejects_http_foreign_host_and_credentials(self):
        handler=u.RestrictedRedirect();req=urllib.request.Request('https://github.com/example/gongsa-note')
        for url in ['http://github.com/file','https://evil.example/file','https://github.com:444/file','https://user@github.com/file']:
            with self.assertRaises(ValueError):handler.redirect_request(req,None,302,'',{},url)
        self.assertIsNotNone(handler.redirect_request(req,None,302,'',{},'https://release-assets.githubusercontent.com/file'))

    def test_corruption_truncation_oversize_leave_old_exe_intact(self):
        self.manager.candidate=u.validate_release(self.release,self.manifest,'example/gongsa-note','0.5.0')
        for body in [b'MZwrong-content!!',self.body[:-1],self.body+b'x']:
            with patch.object(u,'open_url',return_value=io.BytesIO(body)):
                with self.assertRaises(ValueError):self.manager.download()
            self.assertEqual(self.target.read_bytes(),b'MZold')
            self.assertIsNone(self.manager.ready)
            self.assertFalse(list(self.home.rglob('*.part')))

    def test_download_failure_has_recoverable_error_state(self):
        with patch.object(u,'read_json',side_effect=urllib.error.URLError('offline')):self.manager.run('check')
        self.assertEqual(self.manager.snapshot()['phase'],'error')
        self.assertEqual(self.target.read_bytes(),b'MZold')

    def test_replace_preserves_data_and_old_executable(self):
        stage=self.stage();data=self.home/'공사노트 자료'/'공사노트.sqlite3';data.write_bytes(b'USER-DATA')
        backup=u.replace_executable(stage,self.target,u.sha256(stage),u.sha256(self.target))
        self.assertEqual(backup.read_bytes(),b'MZold')
        self.assertEqual(self.target.read_bytes(),self.exe_body)
        self.assertEqual(data.read_bytes(),b'USER-DATA')

    def test_failed_replacement_rolls_back(self):
        stage=self.stage();real=u.os.replace
        def fail_once(source,target):
            if Path(source).name=='.gongsa-note-next.exe':raise OSError('disk failure')
            return real(source,target)
        with patch.object(u.os,'replace',side_effect=fail_once):
            with self.assertRaises(OSError):u.replace_executable(stage,self.target,u.sha256(stage),u.sha256(self.target))
        self.assertEqual(self.target.read_bytes(),b'MZold')

    def test_locked_exe_retries_and_keeps_original_on_timeout(self):
        stage=self.stage()
        real=u.os.replace
        def locked(source,target):
            if Path(source).name == '.gongsa-note-next.exe':raise PermissionError('running')
            return real(source,target)
        with patch.object(u.os,'replace',side_effect=locked) as rename:
            with self.assertRaises(ValueError):u.replace_executable(stage,self.target,u.sha256(stage),u.sha256(self.target),attempts=2,delay=0)
        self.assertEqual(rename.call_count,3)
        self.assertEqual(self.target.read_bytes(),b'MZold')

    def test_target_escape_and_modified_download_rejected(self):
        stage=self.stage();outside=self.home/'outside';outside.mkdir();target=outside/'공사노트.exe';target.write_bytes(b'MZold')
        with self.assertRaises(ValueError):u.replace_executable(stage,target,u.sha256(stage),u.sha256(target))
        expected=u.sha256(stage);stage.write_bytes(b'MZtampered')
        with self.assertRaises(ValueError):u.replace_executable(stage,self.target,expected,u.sha256(self.target))
        self.assertEqual(self.target.read_bytes(),b'MZold')

    def test_helper_launch_only_after_verified_install_request(self):
        with patch.object(u.subprocess,'Popen') as launch:
            self.manager.launch_helper();launch.assert_not_called()
            with self.assertRaises(ValueError):self.manager.request_install()
            stage=self.stage();self.manager.request_install();self.manager.launch_helper()
            args=launch.call_args
            self.assertEqual(args.args[0][0],str(stage))
            self.assertEqual(args.kwargs['env']['PYINSTALLER_RESET_ENVIRONMENT'],'1')
            plan=json.loads((stage.parent.parent/'install.json').read_text(encoding='utf-8'))
            self.assertEqual(plan['target'],str(self.target))
            self.assertEqual(plan['pid'],os.getpid())

    def test_tampered_ready_file_cannot_launch(self):
        stage=self.stage();self.manager.request_install();stage.write_bytes(b'tampered')
        with patch.object(u.subprocess,'Popen') as launch:
            with self.assertRaises(ValueError):self.manager.launch_helper()
            launch.assert_not_called()

    def test_network_retries_then_completes(self):
        with patch.object(self.manager,'check',side_effect=[urllib.error.URLError('offline'),TimeoutError(),None]) as check,patch.object(self.manager.cancelled,'wait',return_value=False):
            self.manager.run('check')
        self.assertEqual(check.call_count,3)

    def test_404_and_integrity_errors_are_not_retried(self):
        for error in [urllib.error.HTTPError('https://api.github.com',404,'missing',{},None),ValueError('bad checksum')]:
            with patch.object(self.manager,'check',side_effect=error) as check:
                self.manager.run('check')
                self.assertEqual(check.call_count,1)

    def test_download_cancel_removes_partial_and_can_retry(self):
        self.manager.candidate=u.validate_release(self.release,self.manifest,'example/gongsa-note','0.5.0')
        self.manager.set_state(phase='downloading');self.manager.cancel_download()
        self.manager.run('download')
        self.assertEqual(self.manager.snapshot()['phase'],'cancelled')
        self.assertTrue(self.manager.snapshot()['canDownload'])
        self.manager.cancelled.clear()
        self.assertEqual(self.stage().read_bytes(),self.exe_body)
        self.assertFalse(list(self.home.rglob('*.part')))

    def test_cancel_during_stream_does_not_publish_file(self):
        self.manager.candidate=u.validate_release(self.release,self.manifest,'example/gongsa-note','0.5.0')
        manager=self.manager
        class Stream(io.BytesIO):
            def read(self,size):
                manager.cancelled.set()
                return super().read(size)
        with patch.object(u,'open_url',return_value=Stream(self.body)):
            self.manager.run('download')
        self.assertEqual(self.manager.snapshot()['phase'],'cancelled')
        self.assertIsNone(self.manager.ready)
        self.assertFalse(list(self.home.rglob('*.part')))

    def test_finished_download_survives_restart_and_is_reverified(self):
        stage=self.stage()
        restarted=u.UpdateManager({'version':'0.5.0','repository':'example/gongsa-note'},self.home,self.target)
        with patch.object(u,'read_json',side_effect=[self.release,self.manifest]),patch.object(u,'open_url') as download:
            restarted.check();download.assert_not_called()
        self.assertEqual(restarted.snapshot()['phase'],'ready')
        stage.write_bytes(b'broken')
        with patch.object(u,'read_json',side_effect=[self.release,self.manifest]):restarted.check()
        self.assertEqual(restarted.snapshot()['phase'],'ready')
        self.assertEqual(restarted.ready.read_bytes(),self.exe_body)

    def test_low_disk_space_never_starts_download_or_closes_app(self):
        self.manager.candidate=u.validate_release(self.release,self.manifest,'example/gongsa-note','0.5.0')
        with patch.object(u.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()),patch.object(u,'open_url') as network:
            with self.assertRaisesRegex(ValueError,'공간'):self.manager.download()
            network.assert_not_called()
        self.stage();self.manager.request_install()
        with patch.object(u.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()),patch.object(u.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(ValueError,'공간'):self.manager.launch_helper()
            launch.assert_not_called()
        self.assertFalse(self.manager.install_requested)

    def test_double_install_and_save_cancellation(self):
        self.stage();self.manager.request_install()
        with self.assertRaises(ValueError):self.manager.request_install()
        self.assertEqual(self.manager.snapshot()['phase'],'preparing')
        self.manager.cancel_install()
        self.assertEqual(self.manager.snapshot()['phase'],'ready')
        self.manager.request_install()

    def test_backup_includes_committed_wal_data(self):
        stage=self.stage();path=self.home/'공사노트 자료'/'공사노트.sqlite3'
        db=sqlite3.connect(path)
        try:
            db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE test (value TEXT)');db.execute("INSERT INTO test VALUES ('saved project')");db.commit()
            backup=u.backup_database(self.home,stage.parent/'backup.sqlite3')
            with closing(sqlite3.connect(backup)) as copied:self.assertEqual(copied.execute('SELECT value FROM test').fetchone()[0],'saved project')
            self.assertEqual(db.execute('SELECT value FROM test').fetchone()[0],'saved project')
        finally:db.close()

    def test_backup_failure_keeps_app_open(self):
        self.stage();self.manager.request_install()
        with patch.object(u,'backup_database',side_effect=OSError('disk failure')),patch.object(u.subprocess,'Popen') as launch:
            with self.assertRaises(OSError):self.manager.launch_helper()
            launch.assert_not_called()
        self.assertFalse(self.manager.install_requested)

    def test_atomic_replacement_always_keeps_target_present(self):
        stage=self.stage();real=u.os.replace
        def observe(source,target):
            self.assertTrue(self.target.exists())
            result=real(source,target)
            self.assertTrue(self.target.exists())
            return result
        with patch.object(u.os,'replace',side_effect=observe):u.replace_executable(stage,self.target,u.sha256(stage),u.sha256(self.target))

    def test_failed_new_process_restores_and_reopens_previous(self):
        stage=self.stage();plan=stage.parent.parent/'install.json'
        plan.write_text(json.dumps({'target':str(self.target),'sha256':self.manifest['sha256'],'old_sha256':u.sha256(self.target),'pid':123}),encoding='utf-8')
        with patch.object(u.sys,'executable',str(stage)),patch.object(u,'wait_for_exit'),patch.object(u.subprocess,'Popen',side_effect=[OSError('launch failed'),None]) as launch:
            with self.assertRaises(OSError):u.apply_update(plan)
            self.assertEqual(launch.call_count,2)
        self.assertEqual(self.target.read_bytes(),b'MZold')

    def test_close_guard_requires_successful_save_and_helper(self):
        class Window:
            destroyed=False
            def destroy(self):self.destroyed=True
            def evaluate_js(self,script):pass
        window=Window()
        with patch.object(self.manager,'launch_helper') as launch:
            self.manager.install_requested=True
            guard=d.CloseGuard(window,launch,self.manager.cancel_install);guard.finished({'ok':False});launch.assert_not_called()
            self.assertFalse(self.manager.install_requested)
            launch.side_effect=OSError('launch failure');guard.finished({'ok':True});self.assertFalse(window.destroyed)
            launch.side_effect=None;guard.finished({'ok':True});self.assertTrue(window.destroyed)

    def test_http_origin_and_request_payload_protect_updater(self):
        server=d.ThreadingHTTPServer(('127.0.0.1',0),d.Handler);server.allowed_host=f'127.0.0.1:{server.server_port}';server.updater=self.manager
        threading.Thread(target=server.serve_forever,daemon=True).start()
        base=f'http://{server.allowed_host}/{d.TOKEN}/api/update/'
        try:
            self.assertEqual(json.load(urllib.request.urlopen(base+'status'))['current'],'0.5.0')
            for body,headers in [(b'{}',{'Content-Type':'application/json','Origin':'https://evil.example'}),(b'{}',{'Content-Type':'text/plain'}),(b'{"url":"https://evil.example"}',{'Content-Type':'application/json'})]:
                with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(urllib.request.Request(base+'check',data=body,headers=headers))
            with patch.object(self.manager,'start') as start:
                response=urllib.request.urlopen(urllib.request.Request(base+'check',data=b'{}',headers={'Content-Type':'application/json'}))
                self.assertTrue(json.load(response)['accepted']);start.assert_called_once_with('check')
        finally:server.shutdown();server.server_close()


if __name__=='__main__':unittest.main(verbosity=2)
