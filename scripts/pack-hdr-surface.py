#!/usr/bin/env python3
"""Pack an explicitly described sRGB-primary EXR/TIFF into the viewer's float16 surface format.
Requires numpy, tifffile (TIFF) or OpenEXR (EXR). No automatic ICC or camera-profile conversion.
"""
import argparse
import hashlib
import json
from pathlib import Path


def pack(source, output, material, transfer):
    import numpy as np
    suffix = source.suffix.lower()
    if suffix in ('.tif', '.tiff'):
        import tifffile
        rgb = tifffile.imread(source)
    elif suffix == '.exr':
        import OpenEXR
        with OpenEXR.File(str(source)) as image:
            if len(image.parts) != 1:
                raise ValueError('Only a single image part is supported; select the intended EXR part first.')
            channels = image.channels()
            key = 'RGB' if 'RGB' in channels else 'RGBA'
            if key not in channels:
                raise ValueError('EXR must contain RGB or RGBA channels.')
            rgb = channels[key].pixels.copy()
    else:
        raise ValueError('Expected .exr, .tif or .tiff')
    if rgb.ndim != 3 or rgb.shape[2] not in (3, 4):
        raise ValueError('Expected interleaved RGB or RGBA pixels.')
    if rgb.shape[2] == 4 and not np.all(rgb[..., 3] == (np.iinfo(rgb.dtype).max if rgb.dtype.kind == 'u' else 1)):
        raise ValueError('v1 packer requires opaque input; GLB retains its original alpha behavior.')
    if rgb.dtype.kind == 'u' and rgb.dtype.itemsize in (1, 2):
        rgb = rgb[..., :3].astype(np.float32) / np.iinfo(rgb.dtype).max
    elif rgb.dtype.kind == 'f':
        rgb = rgb[..., :3].astype(np.float32)
    else:
        raise ValueError('Expected uint8, uint16, float16 or float32 samples.')
    if not np.isfinite(rgb).all() or np.any(rgb < 0):
        raise ValueError('Nonfinite or negative values require explicit preparation, not silent clipping.')
    if transfer == 'srgb':
        rgb = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    if np.any(rgb > 65504):
        raise ValueError('Samples exceed finite float16; choose an explicit exposure normalization before packing.')
    height, width, _ = rgb.shape
    # Even power-of-two dimensions keep the box-filtered mip footprint exact in this first packer.
    if any(n <= 0 or n > 8192 or n & (n - 1) for n in (width, height)):
        raise ValueError('Use power-of-two dimensions up to 8192 for this packer.')
    levels = []
    while True:
        rgba = np.ones((*rgb.shape[:2], 4), dtype='<f2')
        rgba[..., :3] = rgb
        levels.append(rgba.tobytes())
        h, w, _ = rgb.shape
        if h == w == 1:
            break
        if h > 1:
            rgb = (rgb[0::2] + rgb[1::2]) * .5
        if w > 1:
            rgb = (rgb[:, 0::2] + rgb[:, 1::2]) * .5
    payload = b''.join(levels)
    if len(payload) > 256 * 1024 * 1024:
        raise ValueError('Payload exceeds the viewer v1 256 MiB budget; prepare a smaller derivative.')
    output.mkdir(parents=True, exist_ok=True)
    texture_name = source.stem + '.rgba16f.bin'
    manifest_name = source.stem + '.surface.json'
    manifest = dict(version=1, format='rgba16f-le', colorSpace='linear-srgb', range='hdr',
                    textures=[dict(material=material, uri=texture_name, width=width, height=height)])
    provenance = dict(source=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                      inputTransfer=transfer, primaries='srgb', whitePoint='D65',
                      mipFilter='linear box', payloadSha256=hashlib.sha256(payload).hexdigest())
    (output / texture_name).write_bytes(payload)
    (output / manifest_name).write_text(json.dumps(manifest, indent=2) + '\n')
    (output / (source.stem + '.provenance.json')).write_text(json.dumps(provenance, indent=2) + '\n')
    print(output / manifest_name)
    print(f'{width} x {height}; {len(levels)} mips; {len(payload)} bytes. Source unchanged.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--material', type=int, required=True, help='Zero-based material index in the GLB')
    parser.add_argument('--transfer', choices=('linear', 'srgb'), required=True,
                        help='Explicit input transfer; prepare sRGB primaries/D65 before using this tool')
    args = parser.parse_args()
    if args.material < 0:
        parser.error('--material must be nonnegative')
    pack(args.source, args.output, args.material, args.transfer)
