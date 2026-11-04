import json
import secrets
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
import desktop as m
from desktop_launch import association_values, LaunchEndpoint, handoff, launch_file
from project_files import ProjectFiles, atomic_project_write


class LaunchTests(unittest.TestCase):
    def test_association_only_claims_gongsa_and_quotes_paths(self):
        exe = Path('C:/Program Files/공사노트/공사노트.exe')
        values = association_values(exe)
        self.assertTrue(any(k.endswith('.gongsa') for k, _, _ in values))
        self.assertFalse(any('.json' in k for k, _, _ in values))
        self.assertEqual(values[-1][2], f'"{exe.resolve()}" --open "%1"')
        self.assertTrue(values[-2][2].endswith('.exe",0'))

    def test_startup_and_existing_instance_handoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            project = home/'한글 공사.gongsa'
            atomic_project_write(project, {'schema': 1, 'title': '한글', 'lines': []})
            self.assertEqual(launch_file(['--open', str(project)]), project)
            self.assertIsNone(launch_file([]))
            with self.assertRaises(ValueError):
                launch_file(['--open', str(project), 'extra'])
            server = m.ThreadingHTTPServer(('127.0.0.1', 0), m.Handler)
            server.allowed_host = f'127.0.0.1:{server.server_port}'
            server.project_files = ProjectFiles(None, None, home)
            shown = []
            server.bring_forward = lambda: shown.append(True)
            endpoint = LaunchEndpoint(server, m.TOKEN, home/'endpoint.json')
            server.launch_secret = endpoint.secret
            endpoint.publish()
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                url = f'http://{server.allowed_host}/{m.TOKEN}/api/launch'
                req = urllib.request.Request(url, data=json.dumps({'path': str(project)}).encode(), headers={'Content-Type': 'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(req)
                self.assertEqual(error.exception.code, 403)
                self.assertTrue(server.project_files.command('next', {})['empty'])
                self.assertTrue(handoff(project, endpoint.path, attempts=1))
                self.assertEqual(server.project_files.command('next', {})['name'], project.name)
                self.assertEqual(shown, [True])
                self.assertTrue(handoff(None, endpoint.path, attempts=1))
                self.assertTrue(server.project_files.command('next', {})['empty'])
                # A different instance must not have its endpoint removed.
                changed = {**endpoint.data, 'secret': secrets.token_urlsafe(32)}
                endpoint.path.write_text(json.dumps(changed), encoding='utf8')
                endpoint.close()
                self.assertTrue(endpoint.path.exists())
            finally:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
