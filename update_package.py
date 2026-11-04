"""Validated onedir packages with immutable, versioned runtime directories."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import re
import shutil
import stat
import secrets
import tempfile
import zipfile

APP_EXE = '공사노트.exe'
MAX_EXPANDED = 600 * 1024 * 1024


def runtime_name(version):
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version):
        raise ValueError('패키지 버전이 올바르지 않습니다.')
    return '_internal_' + version.replace('.', '_')


def file_hash(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def package_files(archive, version):
    runtime = runtime_name(version)
    files, seen, total = [], set(), 0
    for item in archive.infolist():
        name = item.orig_filename
        if name != item.filename:
            raise ValueError('배포 파일의 경로 표기가 올바르지 않습니다.')
        parts = PurePosixPath(name).parts
        if not parts or name.startswith('/') or '\\' in name or any(p in ('.', '..') or ':' in p or p.endswith((' ', '.')) or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', p) for p in name.rstrip('/').split('/')):
            raise ValueError('배포 파일에 허용되지 않는 경로가 있습니다.')
        if name.casefold() in seen or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1:
            raise ValueError('중복·링크·암호화 파일은 설치할 수 없습니다.')
        seen.add(name.casefold())
        if not (name == APP_EXE or (parts[0] == runtime and (len(parts) > 1 or item.is_dir()))):
            raise ValueError('프로그램 외의 파일이 배포 자료에 포함돼 있습니다.')
        if not item.is_dir():
            total += item.file_size
            files.append(item)
        if total > MAX_EXPANDED or len(seen) > 6000:
            raise ValueError('압축을 푼 배포 자료가 너무 큽니다.')
    required = {APP_EXE, runtime + '/release.json'}
    if not required.issubset({f.filename for f in files}):
        raise ValueError('필수 실행 파일이 누락됐습니다.')
    config = json.loads(archive.read(runtime + '/release.json'))
    if config.get('version') != version or config.get('distribution') != 'folder-v1':
        raise ValueError('프로그램과 패키지의 버전이 일치하지 않습니다.')
    with archive.open(APP_EXE) as stream:
        if stream.read(2) != b'MZ':
            raise ValueError('Windows 실행 파일이 아닙니다.')
    return files, total


def verify_package(archive_path, folder, version):
    folder = Path(folder).resolve()
    with zipfile.ZipFile(archive_path) as archive:
        files, total = package_files(archive, version)
        actual = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
        if actual != {f.filename for f in files}:
            raise ValueError('설치 자료의 파일 목록이 변경됐습니다.')
        for item in files:
            path = folder / item.filename
            if not path.resolve().is_relative_to(folder) or path.is_symlink() or path.stat().st_size != item.file_size:
                raise ValueError('설치 자료의 경로 또는 크기가 변경됐습니다.')
            with archive.open(item) as stream:
                expected = hashlib.file_digest(stream, 'sha256').hexdigest()
            if file_hash(path) != expected:
                raise ValueError('설치 자료가 변경됐습니다. 다시 내려받으세요.')
    return total


def prepare_package(archive_path, version, digest):
    archive_path = Path(archive_path).resolve()
    if file_hash(archive_path) != digest:
        raise ValueError('업데이트 압축 파일 검증에 실패했습니다.')
    destination = archive_path.parent / ('package-' + digest[:16])
    if destination.exists():
        if not destination.resolve().is_relative_to(archive_path.parent) or destination.is_symlink():
            raise ValueError('설치 자료의 저장 위치가 올바르지 않습니다.')
        try:
            verify_package(archive_path, destination, version)
            return destination / APP_EXE
        except (ValueError, OSError):
            # Preserve a damaged cache for inspection, then reconstruct it.
            os.replace(destination, destination.with_name(destination.name + '-invalid-' + secrets.token_hex(4)))
    with zipfile.ZipFile(archive_path) as archive:
        files, total = package_files(archive, version)
        if shutil.disk_usage(archive_path.parent).free < total + 10 * 1024 * 1024:
            raise ValueError('업데이트 자료를 준비할 저장 공간이 부족합니다.')
        temporary = Path(tempfile.mkdtemp(prefix='package-tmp-', dir=archive_path.parent)).resolve()
        try:
            for item in files:
                target = temporary / item.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
            verify_package(archive_path, temporary, version)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                assert temporary.parent == archive_path.parent and temporary.name.startswith('package-tmp-')
                shutil.rmtree(temporary)
    return destination / APP_EXE


def install_runtime(package, home, version):
    """Publish a complete runtime before replacing the EXE; keep old runtimes."""
    package, home = Path(package).resolve(), Path(home).resolve()
    name = runtime_name(version)
    source, target = package / name, home / name
    def inventory(folder):
        result = {}
        for path in folder.rglob('*'):
            if path.is_symlink() or not path.resolve().is_relative_to(folder):
                raise ValueError('실행 자료에 허용되지 않는 링크가 있습니다.')
            if path.is_file():
                result[path.relative_to(folder).as_posix()] = file_hash(path)
        return result
    expected = inventory(source)
    if not expected:
        raise ValueError('프로그램 실행 자료가 없습니다.')
    if target.exists():
        if inventory(target) != expected:
            raise ValueError('동일 버전의 실행 자료가 다릅니다. 기존 자료를 덮어쓰지 않았습니다.')
        return target
    temporary = Path(tempfile.mkdtemp(prefix=name + '-install-', dir=home)).resolve()
    try:
        shutil.copytree(source, temporary, dirs_exist_ok=True)
        if inventory(temporary) != expected:
            raise ValueError('실행 자료 복사 검증에 실패했습니다.')
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            assert temporary.parent == home and temporary.name.startswith(name + '-install-')
            shutil.rmtree(temporary)
    return target
