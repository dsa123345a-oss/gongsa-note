import json
import base64
import io
import zipfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from project_files import ProjectFiles, atomic_project_write, excel_filename


class Files(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.choices = []
        self.calls = []
        class Store:
            def get(self, key):
                return '{"projects":[]}'
        def choose(*args):
            self.calls.append(args)
            return self.choices.pop(0)
        self.files = ProjectFiles(None, Store(), self.home, choose)
        self.project = {'schema': 1, 'title': '한글 공사', 'lines': []}

    def test_save_overwrite_and_save_as_cancel(self):
        a, b = self.home/'첫 파일.gongsa', self.home/'다른 파일.gongsa'
        self.choices.append([str(a)])
        self.files.command('save', {'project': self.project})
        self.project['title'] = '수정'
        self.files.command('save', {'project': self.project})
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(json.loads(a.read_text(encoding='utf8'))['title'], '수정')
        self.choices.append(None)
        self.assertTrue(self.files.command('save', {'project': self.project, 'saveAs': True})['cancelled'])
        self.assertEqual(self.files.current, a)
        self.choices.append([str(b)])
        self.files.command('save', {'project': self.project, 'saveAs': True})
        self.assertEqual(self.files.current, b)
        self.assertTrue(a.exists())

    def test_open_activation_est_and_reset(self):
        path = self.home/'원본.estx'
        path.write_bytes(b'original')
        self.choices.append([str(path)])
        opened = self.files.command('open', {})
        self.files.command('activate', {'token': opened['token']})
        self.assertIsNone(self.files.current)
        new = self.home/'변환.gongsa'
        self.choices.append([str(new)])
        self.files.command('save', {'project': self.project})
        self.assertEqual(path.read_bytes(), b'original')
        self.files.command('reset', {})
        self.choices.append([str(new)])
        opened = self.files.command('open', {})
        self.files.command('activate', {'token': opened['token']})
        self.assertEqual(self.files.current, new)

    def test_failed_atomic_write_retains_old_file(self):
        path = self.home/'old.gongsa.json'
        atomic_project_write(path, self.project)
        before = path.read_bytes()
        with patch('project_files.os.replace', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                atomic_project_write(path, {**self.project, 'title': 'changed'})
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.home.glob('*.tmp')), [])

    def test_legacy_json_opens_and_saves_as_gongsa_without_overwriting_original(self):
        old = self.home/'기존 공사.gongsa.json'
        atomic_project_write(old, self.project)
        original = old.read_bytes()
        self.files.queue_open(old)
        self.files.queue_open(old)
        opened = self.files.command('next', {})
        self.assertEqual(opened['name'], old.name)
        self.files.command('activate', {'token': opened['token']})
        self.assertTrue(self.files.command('next', {})['empty'])
        new = self.home/'기존 공사.gongsa'
        self.choices.append([str(new)])
        result = self.files.command('save', {'project': {**self.project, 'title': '수정'}})
        self.assertEqual(result['name'], new.name)
        self.assertEqual(old.read_bytes(), original)
        self.assertEqual(json.loads(new.read_text(encoding='utf8'))['title'], '수정')

    def test_invalid_launch_file_and_cancelled_conversion(self):
        bad = self.home/'not-a-project.exe'
        bad.write_bytes(b'no')
        with self.assertRaises(ValueError):
            self.files.queue_open(bad)
        old = self.home/'old.gongsa.json'
        atomic_project_write(old, self.project)
        self.files.queue_open(old)
        self.files.command('activate', {'token': self.files.command('next', {})['token']})
        self.choices.append(None)
        self.assertTrue(self.files.command('save', {'project': self.project})['cancelled'])
        self.assertEqual(self.files.current, old)
        self.assertFalse((self.home/'old.gongsa').exists())

    def test_archive_migration_is_repeatable(self):
        self.files.store.get = lambda key: json.dumps({'projects': [{**self.project, 'archiveId': 'one', 'archivedAt': 'today'}]})
        folder = self.files.recover_archives()
        self.files.recover_archives()
        self.assertEqual(len(list(folder.glob('*.gongsa'))), 1)

    def workbook_payload(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            z.writestr('[Content_Types].xml', '<Types/>')
            z.writestr('xl/workbook.xml', '<workbook/>')
        return {'name': '한글 공사(내역서).xlsx', 'data': base64.b64encode(stream.getvalue()).decode()}

    def test_excel_without_extension_and_cancel_does_not_change_current_project(self):
        project = self.home/'작업.gongsa'
        self.files.current = project
        payload = self.workbook_payload()
        target = self.home/'새 이름(내역서)'
        self.choices.append([str(target)])
        result = self.files.command('export', payload)
        self.assertEqual(result['name'], target.name + '.xlsx')
        self.assertEqual(Path(result['path']).read_bytes(), base64.b64decode(payload['data']))
        self.assertEqual(self.files.current, project)
        self.assertEqual(self.calls[-1], ('excel', self.home, payload['name']))
        self.choices.append(None)
        self.assertTrue(self.files.command('export', payload)['cancelled'])
        self.assertEqual(self.files.current, project)
        self.assertEqual(excel_filename('한글.XLSX'), '한글.xlsx')
        self.assertTrue(excel_filename('가'*200+'.xlsx').endswith('.xlsx'))

    def test_excel_normalized_existing_file_is_not_silently_overwritten(self):
        target = self.home/'기존.xlsx'
        target.write_bytes(b'keep')
        self.choices.append([str(target.with_suffix(''))])
        with self.assertRaises(ValueError):
            self.files.command('export', self.workbook_payload())
        self.assertEqual(target.read_bytes(), b'keep')
        self.choices.append([str(target)])
        self.assertTrue(self.files.command('export', self.workbook_payload())['saved'])

    def test_excel_bad_data_and_failed_write_preserve_original(self):
        with self.assertRaises(ValueError):
            self.files.command('export', {'data': base64.b64encode(b'not excel').decode()})
        self.assertEqual(self.calls, [])
        target = self.home/'원본.xlsx'
        target.write_bytes(b'keep')
        self.choices.append([str(target)])
        with patch('project_files.os.replace', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.files.command('export', self.workbook_payload())
        self.assertEqual(target.read_bytes(), b'keep')
        self.assertEqual(list(self.home.glob('*.tmp')), [])

    def test_pdf_extension_cancel_and_invalid_format(self):
        payload = {'name': '공사명(내역서).pdf', 'format': 'pdf', 'data': base64.b64encode(b'%PDF-1.7\n%%EOF').decode()}
        target = self.home/'변경 공사명(내역서)'
        self.choices.append([str(target)])
        result = self.files.command('export', payload)
        self.assertEqual(result['name'], '변경 공사명(내역서).pdf')
        self.assertEqual(Path(result['path']).read_bytes(), b'%PDF-1.7\n%%EOF')
        self.assertEqual(self.calls[-1][0], 'pdf')
        self.choices.append(None)
        self.assertTrue(self.files.command('export', payload)['cancelled'])
        with self.assertRaises(ValueError):
            self.files.command('export', {**payload, 'data': self.workbook_payload()['data']})
        with self.assertRaises(ValueError):
            self.files.command('export', {**payload, 'format': 'exe'})


if __name__ == '__main__':
    unittest.main()
