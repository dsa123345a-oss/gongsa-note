"""Offline Windows workbench. Only serves bundled files on loopback.

The desktop store is independent of WebView origin/port and survives upgrades.
The optional updater contacts only the configured public release repository.
"""
from pathlib import Path
import ctypes
import json
import logging
import mimetypes
import os
import secrets
import sqlite3
import sys
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from project_files import ProjectFiles
from desktop_launch import LaunchEndpoint, launch_file, handoff, register_file_type
from updater import UpdateManager, apply_update

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
HOME = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
DATA = HOME / '공사노트 자료'
TOKEN = secrets.token_urlsafe(32)
CONFIG = json.loads((ROOT / 'release.json').read_text(encoding='utf-8'))
SEEDS = [d['name'] for d in CONFIG.get('defaultDatabases', [])]


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.revisions = {}
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS data (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, value TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            with db:
                yield db
        finally:
            db.close()

    def get(self, key):
        with self.connect() as db:
            row = db.execute('SELECT value FROM data WHERE key=?', (key,)).fetchone()
        return row[0] if row else 'null'

    def put(self, key, value, revision=None):
        parsed = json.loads(value)
        if key == 'project' and (not isinstance(parsed, dict) or parsed.get('schema') != 1):
            raise ValueError('작업 자료 형식이 올바르지 않습니다.')
        if key == 'libraries' and not isinstance(parsed, list):
            raise ValueError('단가 자료 형식이 올바르지 않습니다.')
        if key == 'workbench' and (not isinstance(parsed, dict) or any(not isinstance(parsed.get(k), list) for k in ('projects', 'templates', 'printStyles'))):
            raise ValueError('공사 보관함 형식이 올바르지 않습니다.')
        with self.lock:
            with self.connect() as db:
                if revision is not None and revision <= self.revisions.get(key, 0):
                    return
                if key == 'project':
                    db.execute("INSERT INTO history(value) SELECT value FROM data WHERE key='project' AND value<>?", (value,))
                    db.execute('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 20)')
                db.execute('INSERT OR REPLACE INTO data(key,value) VALUES (?,?)', (key, value))
            if revision is not None:
                self.revisions[key] = revision

    def price_update(self, payload, revision, restore=False):
        """Commit the two datasets and their restore point in one transaction."""
        with self.lock:
            if revision <= max(self.revisions.get('project', 0), self.revisions.get('libraries', 0)):
                raise ValueError('자료가 변경되었습니다. 업데이트 창을 다시 여세요.')
            with self.connect() as db:
                if restore:
                    row = db.execute("SELECT value FROM data WHERE key='priceUpdateBackup'").fetchone()
                    if not row:
                        raise ValueError('복원할 단가 업데이트가 없습니다.')
                    bundle = json.loads(row[0])
                else:
                    bundle = payload
                if not isinstance(bundle.get('project'), dict) or bundle['project'].get('schema') != 1 or not isinstance(bundle.get('libraries'), list):
                    raise ValueError('단가 업데이트 자료 형식이 올바르지 않습니다.')
                if not restore:
                    backup = {}
                    for key in ('project', 'libraries'):
                        row = db.execute('SELECT value FROM data WHERE key=?', (key,)).fetchone()
                        if not row:
                            raise ValueError('업데이트 전 자료를 먼저 저장하세요.')
                        backup[key] = json.loads(row[0])
                    db.execute('INSERT OR REPLACE INTO data(key,value) VALUES (?,?)', ('priceUpdateBackup', json.dumps(backup, ensure_ascii=False)))
                for key in ('project', 'libraries'):
                    db.execute('INSERT OR REPLACE INTO data(key,value) VALUES (?,?)', (key, json.dumps(bundle[key], ensure_ascii=False)))
                if restore:
                    db.execute("DELETE FROM data WHERE key='priceUpdateBackup'")
            self.revisions['project'] = self.revisions['libraries'] = revision


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, body, content_type='application/json; charset=utf-8', status=200):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def route(self):
        path = unquote(urlsplit(self.path).path)
        if self.headers.get('Host') != self.server.allowed_host or not path.startswith('/' + TOKEN + '/'):
            return None
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.server.allowed_host:
            return None
        return path[len(TOKEN) + 2:]

    def do_GET(self):
        path = self.route()
        if path is None:
            return self.respond('{}', status=403)
        if path == 'desktop.json':
            return self.respond(json.dumps({'desktop': True, 'version': CONFIG['version'], 'saveRevision': max(self.server.store.revisions.values(), default=0), 'seedNeeded': bool(SEEDS) and self.server.store.get('libraries') == 'null', 'seedFiles': SEEDS, 'seedManifest': CONFIG.get('defaultDatabases', []), 'storagePath': str(DATA)}, ensure_ascii=False))
        if path == 'api/update/status':
            return self.respond(json.dumps(self.server.updater.snapshot(), ensure_ascii=False))
        if path.startswith('api/data/'):
            key = path.removeprefix('api/data/')
            if key not in ('project', 'libraries', 'workbench', 'priceUpdateBackup', 'outputPreferences'):
                return self.respond('{}', status=404)
            return self.respond(self.server.store.get(key))
        if path.startswith('seed/'):
            name = path.removeprefix('seed/')
            file = ROOT / 'seed' / name if name in SEEDS else None
        else:
            file = (ROOT / 'dist' / (path or 'index.html')).resolve()
            if not file.is_relative_to((ROOT / 'dist').resolve()):
                file = None
        if not file or not file.is_file():
            return self.respond('{}', status=404)
        mime = 'text/javascript' if file.suffix == '.js' else mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        return self.respond(file.read_bytes(), mime)

    def do_POST(self):
        path = self.route()
        if path not in ('api/launch', 'api/files/next', 'api/files/open', 'api/files/save', 'api/files/export', 'api/files/reset', 'api/files/activate', 'api/data/outputPreferences', 'api/print/pdf', 'api/data/project', 'api/data/libraries', 'api/data/workbench', 'api/prices/apply', 'api/prices/restore', 'api/update/check', 'api/update/download', 'api/update/install', 'api/update/cancel', 'api/update/started'):
            return self.respond('{}', status=403)
        if path == 'api/launch':
            secret = getattr(self.server, 'launch_secret', None)
            if not secret or not secrets.compare_digest(self.headers.get('X-Gongsa-Launch', ''), secret):
                return self.respond('{}', status=403)
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.respond('{}', status=415)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 250 * 1024 * 1024:
                raise ValueError('저장 가능한 자료 크기를 초과했습니다.')
            payload = json.loads(self.rfile.read(size).decode('utf-8'))
            if path == 'api/launch':
                selected = payload.get('path')
                if selected is not None:
                    if not isinstance(selected, str):
                        raise ValueError('파일 경로가 올바르지 않습니다.')
                    self.server.project_files.queue_open(selected)
                self.server.bring_forward()
                return self.respond('{"accepted":true}')
            if path.startswith('api/files/'):
                return self.respond(json.dumps(self.server.project_files.command(path.rsplit('/', 1)[1], payload), ensure_ascii=False))
            if path.startswith('api/update/'):
                if payload != {}:
                    raise ValueError('업데이트 요청에 추가 자료를 포함할 수 없습니다.')
                action = path.rsplit('/', 1)[1]
                if action == 'started':
                    self.server.updater.acknowledge_start()
                    self.respond('{"accepted":true}')
                elif action == 'install':
                    self.server.updater.request_install()
                    self.respond('{"accepted":true}')
                    self.server.close_guard.closing()
                elif action == 'cancel':
                    self.server.updater.cancel_download()
                    self.respond('{"accepted":true}')
                else:
                    self.server.updater.start(action)
                    self.respond('{"accepted":true}')
                return
            if path == 'api/print/pdf':
                from print_pdf import print_pdf
                return self.respond(print_pdf(payload), 'application/pdf')
            revision = payload.get('revision')
            if not isinstance(revision, int) or revision <= 0:
                raise ValueError('저장 순서가 올바르지 않습니다.')
            if path.startswith('api/prices/'):
                self.server.store.price_update(payload.get('value', {}), revision, restore=path.endswith('/restore'))
            else:
                self.server.store.put(path.rsplit('/', 1)[1], json.dumps(payload['value'], ensure_ascii=False), revision)
            self.respond('{"saved":true}')
        except Exception as error:
            logging.exception('Save failed')
            self.respond(json.dumps({'error': str(error)}, ensure_ascii=False), status=400)


class CloseGuard:
    """Cancel the first close; destroy only after the UI reports a durable save."""
    def __init__(self, window, before_close=None, on_cancel=None):
        self.window = window
        self.allow = False
        self.pending = False
        self.before_close = before_close
        self.on_cancel = on_cancel

    def closing(self):
        if self.allow:
            return True
        if not self.pending:
            self.pending = True
            threading.Thread(target=self.prepare, daemon=True).start()
        return False

    def prepare(self):
        try:
            self.window.evaluate_js("typeof gongsaPrepareClose==='function' ? gongsaPrepareClose() : Promise.resolve({ok:true})", callback=self.finished)
        except Exception:
            self.pending = False
            if self.on_cancel:
                self.on_cancel()
            logging.exception('Could not prepare close')

    def finished(self, result):
        if isinstance(result, dict) and result.get('ok') is True:
            try:
                if self.before_close:
                    self.before_close()
                self.allow = True
                self.window.destroy()
            except Exception as error:
                logging.exception('Update could not start')
                self.window.evaluate_js('alert(' + json.dumps('업데이트를 시작하지 못했습니다. 기존 프로그램을 계속 사용할 수 있습니다.\n' + str(error)) + ')')
            finally:
                self.pending = False
        else:
            self.pending = False
            if self.on_cancel:
                self.on_cancel()


def main():
    selected = launch_file(sys.argv[1:])
    DATA.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=DATA / '실행기록.log', level=logging.ERROR, encoding='utf-8')
    # Windows releases the mutex when this process ends, including unexpected exit.
    kernel = ctypes.windll.kernel32
    kernel.CreateMutexW.restype = ctypes.c_void_p
    mutex = kernel.CreateMutexW(None, False, 'Local\\GongsaNoteDesktopV1')
    if kernel.GetLastError() == 183:
        if not handoff(selected):
            ctypes.windll.user32.MessageBoxW(None, '공사노트가 이미 실행 중입니다. 실행 중인 공사노트에서 작업 열기를 사용하세요. 구버전이면 작업을 저장하고 종료한 뒤 새 버전을 실행하세요.', '공사노트', 64)
        kernel.CloseHandle(ctypes.c_void_p(mutex))
        return
    import webview
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.allowed_host = f'127.0.0.1:{server.server_port}'
    server.store = Store(DATA / '공사노트.sqlite3')
    server.updater = UpdateManager(CONFIG, HOME, sys.executable if getattr(sys, 'frozen', False) else None)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    webview.settings['ALLOW_DOWNLOADS'] = True
    webview.settings['ALLOW_FILE_URLS'] = False
    window = webview.create_window('공사노트 · 설계적산', f'http://{server.allowed_host}/{TOKEN}/', width=1480, height=940, min_size=(1024, 700), maximized=True, background_color='#eef2f7')
    server.project_files = ProjectFiles(window, server.store, DATA)
    if selected:
        server.project_files.queue_open(selected)
    window_state = {'minimized': False, 'maximized': True}
    def on_minimized():
        window_state['minimized'] = True
    def on_maximized():
        window_state.update(minimized=False, maximized=True)
    def on_restored():
        window_state.update(minimized=False, maximized=False)
    window.events.minimized += on_minimized
    window.events.maximized += on_maximized
    window.events.restored += on_restored
    def bring_forward():
        try:
            if window_state['minimized']:
                maximize = window_state['maximized']
                window.restore()
                if maximize:
                    window.maximize()
            window.show()
        except Exception:
            logging.exception('Could not bring the project window forward')
    server.bring_forward = bring_forward
    endpoint = LaunchEndpoint(server, TOKEN)
    server.launch_secret = endpoint.secret
    endpoint.publish()
    if getattr(sys, 'frozen', False):
        try:
            register_file_type(sys.executable)
        except OSError:
            logging.exception('Could not register the project file type')
    close_guard = CloseGuard(window, server.updater.launch_helper, server.updater.cancel_install)
    server.close_guard = close_guard
    window.events.closing += close_guard.closing
    try:
        webview.start(gui='edgechromium', private_mode=False, storage_path=str(DATA / '화면설정'), icon=str(ROOT / 'dist' / 'app-icon.ico'))
    finally:
        endpoint.close()
        server.shutdown()
        server.server_close()
        kernel.CloseHandle(ctypes.c_void_p(mutex))


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--apply-update':
            apply_update(sys.argv[2])
        else:
            main()
    except Exception as error:
        logging.exception('Application startup failed')
        if os.environ.get('GONGSA_UPDATE_NONCE'):
            sys.exit(1)
        ctypes.windll.user32.MessageBoxW(None, f'실행 중 문제가 발생했습니다.\n{error}\n\n실행기록: {DATA}', '공사노트', 16)
