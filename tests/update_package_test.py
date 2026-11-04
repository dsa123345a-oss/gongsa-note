from pathlib import Path
import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import Mock, patch
import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
import update_package as p
import updater as u


class PackageChecks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)
        self.version='0.7.0'
        self.folder=self.home/'공사노트 자료'/'updates'/self.version
        self.folder.mkdir(parents=True)
        self.archive=self.folder/u.ASSET

    def write(self,extras=()):
        with zipfile.ZipFile(self.archive,'w') as z:
            z.writestr(p.APP_EXE,b'MZnew')
            z.writestr('_internal_0_7_0/release.json',json.dumps({'version':'0.7.0','distribution':'folder-v1'}))
            z.writestr('_internal_0_7_0/python313.dll',b'fake-runtime')
            for name,body in extras:
                if isinstance(name,str) and '\\' in name:
                    info=zipfile.ZipInfo(name);info.filename=name;name=info
                z.writestr(name,body)
        return p.prepare_package(self.archive,self.version,p.file_hash(self.archive))

    def test_extract_and_preserve_old_runtime_and_data(self):
        source=self.write();old=self.home/'_internal_0_6_0';old.mkdir();(old/'old.dll').write_bytes(b'old')
        data=self.home/'공사노트 자료'/'공사노트.sqlite3';data.write_bytes(b'user')
        runtime=p.install_runtime(source.parent,self.home,self.version)
        self.assertEqual((runtime/'python313.dll').read_bytes(),b'fake-runtime')
        self.assertEqual((old/'old.dll').read_bytes(),b'old')
        self.assertEqual(data.read_bytes(),b'user')
        self.assertEqual(p.install_runtime(source.parent,self.home,self.version),runtime)

    def test_traversal_absolute_device_paths_and_user_database_rejected(self):
        for path in ['../escape','/absolute','_internal_0_7_0/../escape','_internal_0_7_0/C:evil','_internal_0_7_0/x.','_internal_0_7_0/con.txt','공사노트 자료/공사노트.sqlite3','_internal_0_7_0/./x','_internal_0_7_0\\x']:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):self.write([(path,b'bad')])
        self.assertFalse((self.home/'escape').exists())

    def test_duplicate_case_and_symlink_rejected(self):
        with self.assertRaises(ValueError):self.write([('_internal_0_7_0/PYTHON313.DLL',b'different')])
        link=zipfile.ZipInfo('_internal_0_7_0/link');link.external_attr=0o120777<<16
        with self.assertRaises(ValueError):self.write([(link,b'outside')])

    def test_oversized_package_rejected_before_extraction(self):
        with patch.object(p,'MAX_EXPANDED',2):
            with self.assertRaises(ValueError):self.write()

    def test_damaged_cache_reconstructed_from_verified_archive(self):
        source=self.write();source.write_bytes(b'corrupt')
        restored=p.prepare_package(self.archive,self.version,p.file_hash(self.archive))
        self.assertEqual(restored.read_bytes(),b'MZnew')
        self.assertTrue(list(self.folder.glob('package-*-invalid-*')))

    def test_conflicting_existing_runtime_never_overwritten(self):
        source=self.write();runtime=p.install_runtime(source.parent,self.home,self.version)
        (runtime/'python313.dll').write_bytes(b'changed')
        with self.assertRaises(ValueError):p.install_runtime(source.parent,self.home,self.version)
        self.assertEqual((runtime/'python313.dll').read_bytes(),b'changed')

    def test_runtime_copy_failure_leaves_previous_exe_usable(self):
        source=self.write();exe=self.home/p.APP_EXE;exe.write_bytes(b'MZold')
        with patch.object(p.shutil,'copytree',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):p.install_runtime(source.parent,self.home,self.version)
        self.assertEqual(exe.read_bytes(),b'MZold')
        self.assertFalse((self.home/'_internal_0_7_0').exists())
        self.assertFalse(list(self.home.glob('_internal_0_7_0-install-*')))

    def test_screen_ready_requires_matching_version_and_nonce(self):
        receipt=self.folder/'started.json';process=Mock();process.poll.return_value=None
        receipt.write_text(json.dumps({'nonce':'correct','version':'0.7.0'}))
        self.assertTrue(u.wait_for_startup(process,receipt,'correct','0.7.0',timeout=.01))
        with patch.object(u.time,'sleep'):
            self.assertFalse(u.wait_for_startup(process,receipt,'wrong','0.7.0',timeout=.01))
            self.assertFalse(u.wait_for_startup(process,receipt,'correct','0.6.0',timeout=.01))
        process.terminate.assert_not_called();process.kill.assert_not_called()

    def test_failed_startup_restores_previous_runtime_binding(self):
        source=self.write();target=self.home/p.APP_EXE;target.write_bytes(b'MZold')
        plan=self.folder/'install.json';u.atomic_json(plan,{'target':str(target),'sha256':p.file_hash(self.archive),'old_sha256':p.file_hash(target),'pid':123})
        process=Mock();process.poll.return_value=1
        with patch.object(u.sys,'executable',str(source)),patch.object(u,'wait_for_exit'),patch.object(u.subprocess,'Popen',side_effect=[process,Mock()]) as launch:
            with self.assertRaises(RuntimeError):u.apply_update(plan)
        self.assertEqual(target.read_bytes(),b'MZold');self.assertEqual(launch.call_count,2)

    def test_ready_acknowledgment_written_only_after_ui_endpoint(self):
        manager=u.UpdateManager({'version':'0.7.0','repository':''},self.home)
        self.assertFalse((self.folder/'started.json').exists())
        with patch.dict(os.environ,{'GONGSA_UPDATE_NONCE':'a'*48}):manager.acknowledge_start()
        self.assertEqual(json.loads((self.folder/'started.json').read_text())['nonce'],'a'*48)


if __name__=='__main__':unittest.main()
