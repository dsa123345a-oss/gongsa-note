"""Opt-in updates from one configured public GitHub repository.

No credentials, project contents or database files are sent to GitHub.
The downloaded EXE runs in helper mode to replace the closed application.
"""
from pathlib import Path
from contextlib import closing
import hashlib
import json
import os
import re
import shutil
import sqlite3
import socket
import http.client
import subprocess
import sys
import threading
import time
import secrets
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from update_package import APP_EXE, prepare_package, verify_package, install_runtime

ASSET = 'gongsa-note-windows-x64.zip'
MAX_EXE = 250 * 1024 * 1024


class DownloadCancelled(Exception):
    pass


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def backup_database(home, destination):
    source = Path(home) / '공사노트 자료' / '공사노트.sqlite3'
    if not source.exists():
        return None
    destination = Path(destination)
    temporary = destination.with_suffix('.tmp')
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as db, closing(sqlite3.connect(temporary)) as backup:
            db.backup(backup)
            if backup.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('자료 백업을 확인하지 못했습니다.')
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r'v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
        raise ValueError('정식 버전 번호가 올바르지 않습니다.')
    return tuple(map(int, value.removeprefix('v').split('.')))


def sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def repository_valid(repository):
    return isinstance(repository, str) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+', repository))


def asset_url(repository, tag, name):
    return f'https://github.com/{repository}/releases/download/{tag}/{name}'


class RestrictedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlsplit(newurl)
        if url.scheme != 'https' or url.hostname not in ('github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com') or url.username or url.port not in (None, 443):
            raise ValueError('허용되지 않은 업데이트 다운로드 주소입니다.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'GongsaNote-Updater', 'Accept': 'application/vnd.github+json' if url.startswith('https://api.github.com/') else 'application/octet-stream'})
    return urllib.request.build_opener(RestrictedRedirect()).open(req, timeout=30)


def read_json(url):
    with open_url(url) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('업데이트 안내 파일이 너무 큽니다.')
    return json.loads(data)


def validate_release(release, manifest, repository, current):
    tag = release.get('tag_name')
    version = version_tuple(tag)
    if release.get('draft') or release.get('prerelease') or version <= version_tuple(current):
        raise ValueError('설치할 수 있는 새 정식 버전이 아닙니다.')
    if manifest.get('version') != tag.removeprefix('v') or manifest.get('asset') != ASSET:
        raise ValueError('배포 버전과 파일 정보가 일치하지 않습니다.')
    digest, size = manifest.get('sha256'), manifest.get('size')
    if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest) or type(size) is not int or not 0 < size <= MAX_EXE:
        raise ValueError('배포 파일 검증 정보가 올바르지 않습니다.')
    assets = [a for a in release.get('assets', []) if a.get('name') == ASSET]
    if len(assets) != 1 or assets[0].get('size') != size or assets[0].get('browser_download_url') != asset_url(repository, tag, ASSET):
        raise ValueError('배포 파일의 주소 또는 크기가 일치하지 않습니다.')
    return {'version': manifest['version'], 'sha256': digest, 'size': size, 'url': assets[0]['browser_download_url'], 'notes': str(release.get('body') or '')[:12000]}


class UpdateManager:
    def __init__(self, config, home, executable=None):
        self.version = config['version']
        version_tuple(self.version)
        self.repository = config.get('repository', '')
        self.home = Path(home).resolve()
        self.executable = Path(executable).resolve() if executable else None
        self.folder = self.home / '공사노트 자료' / 'updates'
        self.lock = threading.RLock()
        self.candidate = None
        self.ready = None
        self.install_requested = False
        self.worker = None
        self.cancelled = threading.Event()
        self.state = {'phase': 'idle' if repository_valid(self.repository) else 'unconfigured', 'current': self.version, 'repository': self.repository, 'message': '새 버전을 확인할 수 있습니다.' if repository_valid(self.repository) else '배포 저장소 연결 전입니다. GitHub 등록 후 업데이트를 사용할 수 있습니다.'}

    def snapshot(self):
        with self.lock:
            return {**self.state, 'canDownload': bool(self.candidate) and self.state['phase'] in ('available', 'error', 'cancelled')}

    def set_state(self, **fields):
        with self.lock:
            self.state.update(fields)

    def start(self, action):
        if action not in ('check', 'download'):
            raise ValueError('지원하지 않는 업데이트 작업입니다.')
        with self.lock:
            if not repository_valid(self.repository):
                raise ValueError(self.state['message'])
            if self.install_requested or (self.worker and self.worker.is_alive()) or self.state['phase'] in ('checking', 'downloading', 'preparing', 'installing'):
                raise ValueError('업데이트 작업이 진행 중입니다.')
            if action == 'download' and (not self.snapshot()['canDownload']):
                raise ValueError('먼저 새 버전을 확인하세요.')
            if action == 'check':
                self.candidate = self.ready = None
                self.state.pop('available', None)
                self.state.pop('notes', None)
            self.cancelled.clear()
            self.set_state(phase='checking' if action == 'check' else 'downloading', progress=0, received=0, attempt=1, message='새 버전을 확인하고 있습니다.' if action == 'check' else '업데이트를 내려받고 있습니다. 이 창을 닫고 작업을 계속할 수 있습니다.')
            self.worker = threading.Thread(target=self.run, args=(action,), daemon=True)
            self.worker.start()

    def run(self, action):
        try:
            for attempt in range(1, 4):
                try:
                    if self.cancelled.is_set():
                        raise DownloadCancelled()
                    self.set_state(attempt=attempt)
                    self.check() if action == 'check' else self.download()
                    break
                except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, http.client.IncompleteRead) as error:
                    if isinstance(error, urllib.error.HTTPError) and error.code not in (408, 429, 500, 502, 503, 504):
                        raise
                    if attempt == 3:
                        raise
                    self.set_state(message=f'연결이 잠시 끊겼습니다. 다시 시도합니다. ({attempt + 1}/3)')
                    if self.cancelled.wait(attempt * 2):
                        raise DownloadCancelled()
        except DownloadCancelled:
            self.set_state(phase='cancelled', message='다운로드를 취소했습니다. 원할 때 다시 받을 수 있습니다.')
        except urllib.error.HTTPError as error:
            self.set_state(phase='error', message='아직 공개된 배포 버전이 없습니다.' if error.code == 404 else f'배포 서버에 연결하지 못했습니다. 잠시 후 다시 확인하세요. (HTTP {error.code})')
        except Exception as error:
            self.set_state(phase='error', message=f'업데이트를 완료하지 못했습니다. 기존 프로그램과 자료는 그대로 유지됩니다. {error}')

    def check(self):
        release = read_json(f'https://api.github.com/repos/{self.repository}/releases/latest')
        tag = release.get('tag_name')
        if release.get('draft') or release.get('prerelease'):
            raise ValueError('정식 배포 버전이 아닙니다.')
        if version_tuple(tag) <= version_tuple(self.version):
            return self.set_state(phase='current', message=f'최신 버전입니다. (v{self.version})')
        manifests = [a for a in release.get('assets', []) if a.get('name') == 'update.json']
        expected = asset_url(self.repository, tag, 'update.json')
        if len(manifests) != 1 or manifests[0].get('browser_download_url') != expected:
            raise ValueError('업데이트 검증 파일이 없습니다.')
        self.candidate = validate_release(release, read_json(expected), self.repository, self.version)
        self.set_state(phase='available', available=self.candidate['version'], notes=self.candidate['notes'], message=f"새 버전 v{self.candidate['version']}을 사용할 수 있습니다.")
        cached = self.folder / self.candidate['version'] / ASSET
        if cached.is_file() and cached.stat().st_size == self.candidate['size'] and sha256(cached) == self.candidate['sha256']:
            self.ready = prepare_package(cached, self.candidate['version'], self.candidate['sha256'])
            self.set_state(phase='ready', progress=100, message='이미 내려받은 업데이트를 확인했습니다. 저장 후 재시작하면 적용됩니다.')

    def cancel_download(self):
        with self.lock:
            if self.state['phase'] != 'downloading':
                raise ValueError('진행 중인 다운로드가 없습니다.')
            self.cancelled.set()
            self.set_state(message='다운로드를 취소하고 있습니다…')

    def download(self):
        candidate = dict(self.candidate)
        folder = self.folder / candidate['version']
        folder.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(folder).free < candidate['size'] * 2 + 10 * 1024 * 1024:
            raise ValueError('저장 공간이 부족합니다. 공간을 확보한 뒤 다시 시도하세요.')
        target, partial = folder / ASSET, folder / (ASSET + '.part')
        size, digest = 0, hashlib.sha256()
        try:
            with open_url(candidate['url']) as response, partial.open('wb') as output:
                while chunk := response.read(256 * 1024):
                    if self.cancelled.is_set():
                        raise DownloadCancelled()
                    size += len(chunk)
                    if size > candidate['size']:
                        raise ValueError('배포 파일 크기가 다릅니다.')
                    digest.update(chunk)
                    output.write(chunk)
                    self.set_state(progress=round(size / candidate['size'] * 100), received=size, total=candidate['size'], message='업데이트를 내려받고 있습니다. 이 창을 닫고 작업을 계속할 수 있습니다.')
                output.flush()
                os.fsync(output.fileno())
            if size != candidate['size'] or digest.hexdigest() != candidate['sha256']:
                raise ValueError('파일 검증에 실패했습니다. 다시 내려받으세요.')
            if self.cancelled.is_set():
                raise DownloadCancelled()
            os.replace(partial, target)
            self.set_state(message='실행에 필요한 파일을 준비하고 있습니다…')
            self.ready = prepare_package(target, candidate['version'], candidate['sha256'])
            if self.cancelled.is_set():
                self.ready = None
                raise DownloadCancelled()
            self.set_state(phase='ready', progress=100, message='다운로드와 파일 검증을 마쳤습니다. 저장 후 재시작하면 적용됩니다.')
        finally:
            partial.unlink(missing_ok=True)

    def request_install(self):
        with self.lock:
            if self.install_requested or self.state['phase'] != 'ready' or not self.ready or not self.executable:
                raise ValueError('EXE 프로그램에서 검증을 마친 업데이트만 설치할 수 있습니다.')
            self.install_requested = True
            self.set_state(phase='preparing', message='현재 작업을 저장하고 업데이트를 준비하고 있습니다…')

    def cancel_install(self):
        with self.lock:
            self.install_requested = False
            if self.state['phase'] == 'preparing':
                self.set_state(phase='ready', message='작업을 저장하지 못해 재시작을 중단했습니다. 저장 상태를 확인한 뒤 다시 시도하세요.')

    def launch_helper(self):
        if not self.install_requested:
            return
        try:
            folder = self.ready.parent.parent
            archive = folder / ASSET
            if sha256(archive) != self.candidate['sha256']:
                raise ValueError('다운로드 후 파일이 변경되었습니다. 다시 내려받으세요.')
            expanded = verify_package(archive, self.ready.parent, self.candidate['version'])
            database = self.home / '공사노트 자료' / '공사노트.sqlite3'
            required = expanded * 2 + (database.stat().st_size if database.exists() else 0) + 10 * 1024 * 1024
            if shutil.disk_usage(self.home).free < required:
                raise ValueError('설치와 자료 백업을 위한 저장 공간이 부족합니다.')
            self.set_state(message='작업 자료를 백업하고 있습니다…')
            backup_database(self.home, folder / '업데이트 전 자료.sqlite3')
            plan = folder / 'install.json'
            atomic_json(plan, {'target': str(self.executable), 'sha256': self.candidate['sha256'], 'old_sha256': sha256(self.executable), 'pid': os.getpid()})
            # The downloaded, verified EXE is a separate helper while the old EXE exits.
            subprocess.Popen([str(self.ready), '--apply-update', str(plan)], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=restart_environment())
            self.set_state(phase='installing', message='업데이트 후 다시 시작합니다.')
        except Exception as error:
            self.install_requested = False
            self.set_state(phase='error', message=f'업데이트를 시작하지 못했습니다. 기존 프로그램을 계속 사용할 수 있습니다. {error}')
            raise

    def acknowledge_start(self):
        nonce = os.environ.get('GONGSA_UPDATE_NONCE', '')
        if re.fullmatch('[a-f0-9]{48}', nonce):
            folder = self.folder / self.version
            if folder.is_dir():
                atomic_json(folder / 'started.json', {'nonce': nonce, 'version': self.version, 'pid': os.getpid()})
                atomic_json(folder / 'result.json', {'version': self.version, 'status': 'started'})


def restart_environment():
    env = os.environ.copy()
    env.pop('GONGSA_UPDATE_NONCE', None)
    # PyInstaller children must extract their own (new) bundle.
    env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
    return env


def replace_executable(source, target, expected, old_expected, attempts=120, delay=.5):
    source, target = Path(source).resolve(), Path(target).resolve()
    home = source.parents[4]
    if source.name != APP_EXE or source.parent.parent.parent != home / '공사노트 자료' / 'updates' or target.parent != home or target.suffix.lower() != '.exe' or target == source:
        raise ValueError('업데이트 파일 경로가 올바르지 않습니다.')
    version_tuple(source.parent.parent.name)
    if not re.fullmatch('[a-f0-9]{64}', expected) or not re.fullmatch('[a-f0-9]{64}', old_expected):
        raise ValueError('업데이트 파일 검증 정보가 올바르지 않습니다.')
    if sha256(source) != expected or sha256(target) != old_expected:
        raise ValueError('업데이트 전 파일이 변경되었습니다.')
    replacement = home / '.gongsa-note-next.exe'
    backup = target.with_suffix('.previous.exe')
    if target in (replacement, backup):
        raise ValueError('업데이트 대상 파일 이름을 확인하세요.')
    shutil.copyfile(source, replacement)
    if sha256(replacement) != expected:
        raise ValueError('업데이트 파일 복사 검증에 실패했습니다.')
    # Keep target present throughout: interruption can leave an extra backup,
    # but never a missing application between two renames.
    backup_partial = home / '.gongsa-note-backup.exe'
    shutil.copyfile(target, backup_partial)
    if sha256(backup_partial) != old_expected:
        raise ValueError('기존 프로그램 백업 검증에 실패했습니다.')
    os.replace(backup_partial, backup)
    for attempt in range(attempts):
        try:
            os.replace(replacement, target)
            break
        except PermissionError:
            if attempt + 1 == attempts:
                raise ValueError('기존 프로그램이 종료되지 않았습니다. 다시 실행한 뒤 업데이트하세요.')
            time.sleep(delay)
    return backup


def apply_update(plan_path):
    source = Path(sys.executable).resolve()
    plan_path = Path(plan_path).resolve()
    if plan_path != source.parent.parent / 'install.json':
        raise ValueError('업데이트 설치 정보의 위치가 올바르지 않습니다.')
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    target = Path(plan['target']).resolve()
    home = source.parents[4]
    version = source.parent.parent.name
    version_tuple(version)
    if target.parent != home or target.suffix.lower() != '.exe' or source.parent.parent.parent != home / '공사노트 자료' / 'updates':
        raise ValueError('업데이트 파일 경로가 올바르지 않습니다.')
    archive = source.parent.parent / ASSET
    if sha256(archive) != plan['sha256']:
        raise ValueError('배포 파일이 변경됐습니다.')
    verify_package(archive, source.parent, version)
    wait_for_exit(plan['pid'])
    backup = None
    try:
        install_runtime(source.parent, home, version)
        backup = replace_executable(source, target, sha256(source), plan['old_sha256'])
        nonce = secrets.token_hex(24)
        env = restart_environment()
        env['GONGSA_UPDATE_NONCE'] = nonce
        process = subprocess.Popen([str(target)], cwd=target.parent, env=env)
        ready = wait_for_startup(process, source.parent.parent / 'started.json', nonce, version)
        atomic_json(source.parent.parent / 'result.json', {'version': version, 'status': 'started' if ready else 'startup-pending'})
    except Exception as error:
        if backup:
            os.replace(backup, target)
        atomic_json(source.parent.parent / 'result.json', {'version': version, 'status': 'failed', 'message': str(error), 'restored': bool(backup)})
        # If the replacement failed, re-open the old application automatically.
        if target.is_file() and sha256(target) == plan['old_sha256']:
            subprocess.Popen([str(target)], cwd=target.parent, env=restart_environment())
        raise


def wait_for_startup(process, receipt, nonce, version, timeout=45):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        try:
            result = json.loads(Path(receipt).read_text(encoding='utf-8'))
            if result.get('nonce') == nonce and result.get('version') == version:
                return True
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        if process.poll() is not None:
            raise RuntimeError('새 버전이 시작되기 전에 종료됐습니다. 이전 버전으로 복구합니다.')
        time.sleep(.25)
    # Never kill a live application: a slow machine may still be loading data.
    return False


def wait_for_exit(pid):
    import ctypes
    from ctypes import wintypes
    if type(pid) is not int or pid <= 0 or pid == os.getpid():
        raise ValueError('종료할 프로그램 정보가 올바르지 않습니다.')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:  # Process already exited.
            return
        raise ValueError('프로그램 종료 여부를 확인하지 못했습니다.')
    try:
        if kernel.WaitForSingleObject(handle, 60000) != 0:
            raise ValueError('프로그램이 종료되지 않아 업데이트를 중단했습니다.')
    finally:
        kernel.CloseHandle(handle)
