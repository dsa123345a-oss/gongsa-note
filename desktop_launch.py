"""Per-user project association and authenticated handoff to the running app."""
from pathlib import Path
import ctypes
import json
import os
import secrets
import time
import urllib.request

PROG_ID = 'GongsaNote.Project'


def association_values(executable):
    executable = str(Path(executable).resolve())
    return [
        (r'Software\Classes\.gongsa', '', PROG_ID),
        (r'Software\Classes\.gongsa', 'Content Type', 'application/vnd.gongsa-note+json'),
        (rf'Software\Classes\{PROG_ID}', '', '공사노트 설계내역서'),
        (rf'Software\Classes\{PROG_ID}\DefaultIcon', '', f'"{executable}",0'),
        (rf'Software\Classes\{PROG_ID}\shell\open\command', '', f'"{executable}" --open "%1"'),
    ]


def register_file_type(executable):
    import winreg
    for path, name, value in association_values(executable):
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)


def launch_file(arguments):
    if not arguments:
        return None
    if len(arguments) == 2 and arguments[0] == '--open':
        arguments = arguments[1:]
    if len(arguments) != 1:
        raise ValueError('열 공사 파일 하나를 지정하세요.')
    path = Path(arguments[0]).resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in ('.gongsa', '.json', '.estx', '.ebkx'):
        raise ValueError('공사노트 또는 EST 작업 파일을 선택하세요.')
    return path


def endpoint_file():
    return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local')) / '공사노트' / '실행연결.json'


class LaunchEndpoint:
    def __init__(self, server, token, path=None):
        self.path = Path(path) if path else endpoint_file()
        self.secret = secrets.token_urlsafe(32)
        self.data = {'port': server.server_port, 'token': token, 'secret': self.secret, 'pid': os.getpid()}

    def publish(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.' + secrets.token_hex(8) + '.tmp')
        try:
            temporary.write_text(json.dumps(self.data), encoding='utf8')
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def close(self):
        try:
            if json.loads(self.path.read_text(encoding='utf8')).get('secret') == self.secret:
                self.path.unlink()
        except (OSError, ValueError):
            pass


def handoff(selected, path=None, attempts=12):
    """Never follow a metadata URL, proxy, or redirect outside loopback."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    path = Path(path) if path else endpoint_file()
    for _ in range(attempts):
        try:
            data = json.loads(path.read_text(encoding='utf8'))
            port, token, secret = data['port'], data['token'], data['secret']
            if not isinstance(port, int) or not 0 < port < 65536 or not all(isinstance(s, str) and 20 <= len(s) <= 100 and all(c.isalnum() or c in '_-' for c in s) for s in (token, secret)):
                return False
            request = urllib.request.Request(f'http://127.0.0.1:{port}/{token}/api/launch',
                data=json.dumps({'path': str(selected) if selected else None}).encode(),
                headers={'Content-Type': 'application/json', 'X-Gongsa-Launch': secret}, method='POST')
            with opener.open(request, timeout=1) as response:
                return json.load(response).get('accepted') is True
        except (OSError, ValueError, KeyError):
            time.sleep(.25)
    return False
