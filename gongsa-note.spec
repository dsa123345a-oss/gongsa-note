# Build with: python -m PyInstaller --noconfirm gongsa-note.spec
from pathlib import Path
import json
from PyInstaller.utils.hooks import collect_data_files

root = Path(SPECPATH)
version = json.loads((root / 'release.json').read_text(encoding='utf-8'))['version']
datas = [(str(root / 'dist'), 'dist'), (str(root / 'release.json'), '.')]
config = json.loads((root / 'release.json').read_text(encoding='utf-8'))
for entry in config.get('defaultDatabases', []):
    datas.append((str(root / 'seed' / entry['name']), 'seed'))
for package in ('webview', 'pythonnet', 'clr_loader', 'reportlab'):
    datas += collect_data_files(package)
a = Analysis([str(root / 'desktop.py')], pathex=[str(root)], binaries=[], datas=datas,
    hiddenimports=['webview.platforms.edgechromium'],
    excludes=['PyQt5','PyQt6','PySide2','PySide6','matplotlib','pandas'], noarchive=True)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], name='공사노트', console=False, exclude_binaries=True,
    contents_directory='_internal_' + version.replace('.', '_'), upx=False, icon=str(root / 'dist' / 'app-icon.ico'))
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='공사노트')
