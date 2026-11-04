"""User-selected project files; never accept a write path from the page."""
from pathlib import Path
import base64
import hashlib
import io
import json
import os
import re
import secrets
import threading
import zipfile
from collections import deque


def safe_name(value):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(value)).strip(' .')[:120] or '새 내역서'


def project_filename(value):
    name = safe_name(value)
    name = re.sub(r'(?i)(?:\.gongsa)?\.json$|\.gongsa$', '', name)
    return (name or '새 내역서') + '.gongsa'


def excel_filename(value):
    name = re.sub(r'(?i)\.xlsx?$', '', str(value).strip(' .'))
    return safe_name(name) + '.xlsx'


def pdf_filename(value):
    return safe_name(re.sub(r'(?i)\.pdf$', '', str(value).strip(' .'))) + '.pdf'


def atomic_project_write(path, project):
    if not isinstance(project, dict) or project.get('schema') != 1 or not isinstance(project.get('lines'), list):
        raise ValueError('공사노트 작업 파일 형식을 확인하세요.')
    data = json.dumps(project, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
    atomic_bytes_write(path, data)


def atomic_bytes_write(path, data):
    temp = path.with_name('.' + path.name + '.' + secrets.token_hex(8) + '.tmp')
    try:
        with temp.open('xb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class ProjectFiles:
    def __init__(self, window, store, home, dialog=None):
        self.window, self.store, self.home = window, store, Path(home)
        self.current = None
        self.pending = {}
        self.open_queue = deque()
        self.lock = threading.Lock()
        self.dialog = dialog or self.native_dialog

    def native_dialog(self, mode, directory, filename=''):
        import webview
        types = ('공사노트 EST (*.gongsa;*.gongsa.json;*.json;*.estx;*.ebkx)', '공사노트 (*.gongsa;*.gongsa.json;*.json)', 'EST 공사 (*.estx;*.ebkx)') if mode == 'open' else ('공사노트 (*.gongsa)',)
        if mode == 'excel':
            types = ('Excel 통합 문서 (*.xlsx)',)
        elif mode == 'pdf':
            types = ('PDF 문서 (*.pdf)',)
        return self.window.create_file_dialog(webview.FileDialog.OPEN if mode == 'open' else webview.FileDialog.SAVE, directory=str(directory), save_filename=filename, allow_multiple=False, file_types=types)

    def recover_archives(self):
        archive = json.loads(self.store.get('workbench')) or {}
        folder = self.home / '저장된 공사'
        for project in archive.get('projects', []):
            data = dict(project)
            for key in ('archiveId', 'archivedAt'):
                data.pop(key, None)
            digest = hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / (safe_name(project.get('title')) + '-' + digest + '.gongsa')
            if not path.exists():
                atomic_project_write(path, data)
        return folder if folder.exists() else self.home

    def queue_open(self, selected):
        path = Path(selected).resolve(strict=True)
        if path.suffix.lower() not in ('.json', '.gongsa', '.estx', '.ebkx') or not path.is_file():
            raise ValueError('공사노트 또는 EST 작업 파일을 선택하세요.')
        if path.stat().st_size > 30 * 1024 * 1024:
            raise ValueError('작업 파일은 30MB 이하만 지원합니다.')
        with self.lock:
            if path not in self.open_queue:
                if len(self.open_queue) >= 20:
                    raise ValueError('열기 대기 중인 공사가 많습니다. 현재 창에서 먼저 확인하세요.')
                self.open_queue.append(path)

    def selected_file(self, path):
        if path.suffix.lower() not in ('.json', '.gongsa', '.estx', '.ebkx'):
            raise ValueError('공사노트 또는 EST 파일을 선택하세요.')
        if path.stat().st_size > 30 * 1024 * 1024:
            raise ValueError('작업 파일은 30MB 이하만 지원합니다.')
        data = path.read_bytes()
        token = secrets.token_urlsafe(24)
        self.pending = {token: path}
        return {'name': path.name, 'token': token, 'data': base64.b64encode(data).decode('ascii')}

    def command(self, action, payload):
        with self.lock:
            if action == 'export':
                format = payload.get('format', 'xlsx')
                if format not in ('xlsx', 'pdf'):
                    raise ValueError('지원하지 않는 내보내기 형식입니다.')
                label = 'PDF' if format == 'pdf' else '엑셀'
                encoded = payload.get('data')
                if not isinstance(encoded, str) or len(encoded) > 140 * 1024 * 1024:
                    raise ValueError(label + ' 파일 크기 또는 형식을 확인하세요.')
                data = base64.b64decode(encoded, validate=True)
                if format == 'pdf':
                    if not data.startswith(b'%PDF-') or b'%%EOF' not in data[-1024:]:
                        raise ValueError('PDF 문서 형식이 아닙니다.')
                else:
                    try:
                        with zipfile.ZipFile(io.BytesIO(data)) as workbook:
                            if not {'[Content_Types].xml', 'xl/workbook.xml'}.issubset(workbook.namelist()):
                                raise ValueError('엑셀 통합 문서 형식이 아닙니다.')
                    except zipfile.BadZipFile as exc:
                        raise ValueError('엑셀 통합 문서 형식이 아닙니다.') from exc
                filename = pdf_filename if format == 'pdf' else excel_filename
                paths = self.dialog('pdf' if format == 'pdf' else 'excel', self.current.parent if self.current else self.home,
                                    filename(payload.get('name') or '내역서'))
                if not paths:
                    return {'cancelled': True}
                selected = Path(paths[0] if isinstance(paths, (tuple, list)) else paths)
                target = selected.with_name(filename(selected.name))
                if target != selected and target.exists():
                    raise ValueError('같은 이름의 .' + format + ' 파일이 있습니다. 저장창에서 해당 파일을 선택하거나 다른 이름을 입력하세요.')
                atomic_bytes_write(target, data)
                return {'saved': True, 'name': target.name, 'path': str(target)}
            if action == 'next':
                return self.selected_file(self.open_queue.popleft()) if self.open_queue else {'empty': True}
            if action == 'reset':
                self.current = None
                self.pending.clear()
                return {'ok': True}
            if action == 'activate':
                selected = self.pending.pop(payload.get('token'), None)
                if selected is None:
                    raise ValueError('파일 선택이 만료되었습니다. 다시 여세요.')
                self.current = selected if selected.suffix.lower() in ('.json', '.gongsa') else None
                self.pending.clear()
                return {'ok': True}
            if action == 'open':
                folder = self.recover_archives()
                paths = self.dialog('open', self.current.parent if self.current else folder)
                if not paths:
                    return {'cancelled': True}
                path = Path(paths[0] if isinstance(paths, (tuple, list)) else paths)
                return self.selected_file(path)
            if action == 'save':
                target = self.current
                if payload.get('saveAs') or target is None or target.suffix.lower() != '.gongsa':
                    name = project_filename(payload.get('name') or (target.name if target else '새 내역서'))
                    paths = self.dialog('save', target.parent if target else self.home, name)
                    if not paths:
                        return {'cancelled': True}
                    target = Path(paths[0] if isinstance(paths, (tuple, list)) else paths)
                    normalized = target.with_name(project_filename(target.name))
                    if normalized != target and normalized.exists():
                        raise ValueError('같은 이름의 .gongsa 파일이 있습니다. 저장창에서 해당 파일을 선택하거나 다른 이름을 입력하세요.')
                    target = normalized
                atomic_project_write(target, payload.get('project'))
                self.current = target
                return {'saved': True, 'name': target.name, 'path': str(target)}
            raise ValueError('지원하지 않는 파일 작업입니다.')
