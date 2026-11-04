"""Prepare source, EXE and update manifest, allowing only declared default DBs."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from updater import ASSET, version_tuple
from update_package import APP_EXE, runtime_name, package_files


def verify_default_databases(folder, config):
    allowed = {}
    for entry in config.get('defaultDatabases', []):
        name = entry['name']
        if Path(name).name != name or '/' in name or '\\' in name or Path(name).suffix not in ('.estx', '.ebkx'):
            raise ValueError('기본 DB 파일명이 올바르지 않습니다.')
        relative = 'seed/' + name
        if relative in allowed:
            raise ValueError('기본 DB가 중복 지정되었습니다.')
        path = folder / relative
        if not path.is_file() or path.is_symlink() or path.stat().st_size != entry['bytes']:
            raise ValueError('기본 DB가 누락되었거나 크기가 다릅니다: ' + name)
        with path.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                raise ValueError('기본 DB의 내용이 배포 설정과 다릅니다: ' + name)
        allowed[relative] = path
    return allowed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('executable', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    config = json.loads((ROOT / 'release.json').read_text(encoding='utf-8'))
    version_tuple(config['version'])
    # Publish only the onedir executable and its version-specific runtime.
    folder = args.executable if args.executable.is_dir() else args.executable.parent
    executable = folder / APP_EXE
    runtime = folder / runtime_name(config['version'])
    from PyInstaller.archive.readers import CArchiveReader
    archive = CArchiveReader(str(executable))
    blocked = [name for name in archive.toc if Path(name).suffix.lower() in ('.estx','.ebkx','.sqlite3','.db','.xlsx','.hwp') or name.replace('\\','/').startswith('seed/')]
    if blocked:
        raise ValueError('개인 자료가 포함된 실행 파일은 배포할 수 없습니다.')
    bundled = json.loads((runtime / 'release.json').read_text(encoding='utf-8'))
    if bundled != config:
        raise ValueError('실행 파일과 소스의 배포 설정이 다릅니다. 다시 빌드하세요.')
    args.destination.mkdir(parents=True, exist_ok=True)
    asset = args.destination / ASSET
    runtime_files = sorted(p for p in runtime.rglob('*') if p.is_file())
    defaults = verify_default_databases(runtime, config)
    source_defaults = verify_default_databases(ROOT, config)
    if any((p.suffix.lower() in ('.estx','.ebkx','.sqlite3','.db','.xlsx','.xls','.xlsm','.hwp','.gongsa') and p.relative_to(runtime).as_posix() not in defaults) or p.is_symlink() or (p.relative_to(runtime).as_posix().startswith('seed/') and p.relative_to(runtime).as_posix() not in defaults) for p in runtime_files):
        raise ValueError('실행 자료 안에 배포할 수 없는 파일이 있습니다.')
    with zipfile.ZipFile(asset, 'w', zipfile.ZIP_DEFLATED) as output:
        for path in [executable, *runtime_files]:
            output.write(path, path.relative_to(folder).as_posix())
    with zipfile.ZipFile(asset) as package:
        package_files(package, config['version'])
    with asset.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    (args.destination / 'update.json').write_text(json.dumps({'version': config['version'], 'asset': ASSET, 'size': asset.stat().st_size, 'sha256': digest}, indent=2) + '\n', encoding='utf-8')
    files = [ROOT / name for name in ('desktop.py','desktop_launch.py','project_files.py','print_pdf.py','updater.py','update_package.py','release.json','gongsa-note.spec','requirements.txt','package.json','.gitignore','README.md','CHANGELOG.md')]
    files.extend(source_defaults.values())
    for folder, suffixes in [('dist',{'.js','.html','.css','.svg','.png','.ico'}),('tests',{'.py','.mjs'}),('tools',{'.py'})]:
        files.extend(p for p in (ROOT / folder).iterdir() if p.is_file() and p.suffix in suffixes)
    files.extend(p for p in (ROOT / 'tools' / 'quantity-bridge').iterdir() if p.is_file() and p.suffix in {'.py','.js','.mjs','.json'})
    with zipfile.ZipFile(args.destination / f'gongsa-note-{config["version"]}-source.zip', 'w', zipfile.ZIP_DEFLATED) as output:
        for path in sorted(files):
            output.write(path, 'gongsa-note/' + path.relative_to(ROOT).as_posix())
    print(f'Prepared v{config["version"]}: {len(files)} source files; {len(defaults)} declared default DBs; no customer project files.')


if __name__ == '__main__':
    main()
