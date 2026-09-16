#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the first offline macOS arm64 preview. Other targets must pass native CI before release."""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--ktx-prefix', required=True, type=Path)
parser.add_argument('--output', type=Path, default=ROOT / 'blender/releases/heritage3d_hdr-0.2.0-macos-arm64.zip')
args = parser.parse_args()
if (platform.system(), platform.machine()) != ('Darwin', 'arm64'):
    raise SystemExit('Only the macOS arm64 preview build is validated yet')
with tempfile.TemporaryDirectory() as directory:
    stage = Path(directory)
    shutil.copytree(ROOT / 'blender/heritage3d_hdr', stage, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', 'vendor', '.*'))
    vendor = stage / 'vendor'
    for relative in ('bin/ktx', 'lib/libktx.5.dylib'):
        destination = vendor / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.ktx_prefix / relative, destination)
    version = subprocess.check_output([str(vendor / 'bin/ktx'), '--version'], text=True).strip()
    if '5.0.0' not in version or 'rc2' not in version:
        raise SystemExit(f'Expected pinned KTX 5.0.0-rc2, got {version}')
    manifest = dict(platform='Darwin-arm64', version=version,
                    source='https://github.com/KhronosGroup/KTX-Software/releases/tag/v5.0.0-rc2',
                    executable='bin/ktx', sha256={str(p.relative_to(vendor)): hashlib.sha256(p.read_bytes()).hexdigest()
                                               for p in sorted(vendor.rglob('*')) if p.is_file()})
    (vendor / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    manifest_path = stage / 'blender_manifest.toml'
    manifest_path.write_text(manifest_path.read_text().replace('[permissions]', 'platforms = ["macos-arm64"]\n[permissions]'))
    if not (stage / 'LICENSE').exists() or not (stage / 'licenses/KTX/LICENSE.md').exists():
        raise SystemExit('Missing license bundle')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(stage))
    print(args.output)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix('.zip.sha256').write_text(f'{digest}  {args.output.name}\n')
    print(digest)
