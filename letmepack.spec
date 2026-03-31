# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for FlashCardApp — minimal macOS .app bundle.
Run: pyinstaller letmepack.spec
"""

import os
import re
from pathlib import Path

ROOT = Path(SPECPATH)

# Read APP_VERSION from version.py so the .app bundle version matches
_ver_text = (ROOT / 'version.py').read_text()
_APP_VERSION = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', _ver_text).group(1)

a = Analysis(
    [str(ROOT / 'main.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Web front-end
        (str(ROOT / 'gui' / 'web'), 'gui/web'),
        # Bundled data (DB schema seed, word lists)
        (str(ROOT / 'data'), 'data'),
    ],
    hiddenimports=[
        # pywebview macOS backend
        'webview.platforms.cocoa',
        # fsrs internals
        'fsrs',
        # sqlite3 is stdlib but sometimes missed
        'sqlite3',
        # openpyxl is lazily imported
        'openpyxl',
        'openpyxl.styles',
        'openpyxl.utils',
        # websockets (optional, gracefully degrades)
        'websockets',
        'websockets.server',
        'websockets.exceptions',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy unused packages
        'pandas', 'numpy', 'matplotlib', 'PIL', 'Pillow',
        'scipy', 'sklearn', 'torch', 'tensorflow',
        'IPython', 'jupyter', 'notebook',
        'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'wx',
        'gi', 'gtk',
        'test', 'unittest', 'doctest',
        'tkinter', '_tkinter',
    ],
    noarchive=False,
    optimize=2,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='FlashCardApp',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,          # compress binaries if upx available
    console=False,     # no terminal window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=True,
    upx=True,
    upx_exclude=[],
    name='FlashCardApp',
)

app = BUNDLE(
    coll,
    name='FlashCardApp.app',
    icon='AppIcon.icns',
    bundle_identifier='com.flashcardapp.app',
    info_plist={
        'NSHighResolutionCapable': True,
        'CFBundleShortVersionString': _APP_VERSION,
        'NSRequiresAquaSystemAppearance': False,   # dark mode support
    },
)

# ── Post-build: zip the .app for GitHub Release auto-update ──────────────────
import subprocess, sys
_dist = ROOT / 'dist'
_zip_name = f'FlashCardApp-mac-v{_APP_VERSION}.zip'
_zip_path = _dist / _zip_name
print(f'\n[post-build] Creating {_zip_name}...')
subprocess.run(
    ['zip', '-r', '--symlinks', str(_zip_path), 'FlashCardApp.app'],
    cwd=str(_dist), check=True,
)
# Also copy to 分发/
_fen_fa = ROOT / '分发'
if _fen_fa.exists():
    import shutil
    shutil.copy2(_zip_path, _fen_fa / _zip_name)
print(f'[post-build] {_zip_name} ready  →  dist/ and 分发/')
