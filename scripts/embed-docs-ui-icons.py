#!/usr/bin/env python3
"""
1. Re-save docs/icons/*.png as RGBA PNG with opaque pixels forced to black (alpha preserved).
2. Embed base64 data URIs into docs/UI-ELEMENTS.html and docs/UI-ELEMENTS.md.

HTML may already contain data: URIs; each is matched to a source file by pixel bytes, then replaced.
"""
from __future__ import annotations

import base64
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "docs" / "icons"
HTML_PATH = ROOT / "docs" / "UI-ELEMENTS.html"
MD_PATH = ROOT / "docs" / "UI-ELEMENTS.md"


def to_black_rgba(im):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (0, 0, 0, a)
    return im


def png_bytes(im) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def fingerprint(im) -> tuple[tuple[int, int], bytes]:
    im = im.convert("RGBA")
    return (im.size, im.tobytes())


def main() -> int:
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: pip install Pillow", file=sys.stderr)
        return 1

    if not ICONS.is_dir():
        print(f"Missing {ICONS}", file=sys.stderr)
        return 1

    data_uris: dict[str, str] = {}
    fp_before_to_name: dict[tuple[tuple[int, int], bytes], str] = {}
    fp_black_to_name: dict[tuple[tuple[int, int], bytes], str] = {}

    for path in sorted(ICONS.glob("*.png")):
        with Image.open(path) as src:
            orig = src.convert("RGBA").copy()
        fp0 = fingerprint(orig)
        if fp0 in fp_before_to_name:
            print(f"Warning: duplicate pixels {fp_before_to_name[fp0]} vs {path.name}", file=sys.stderr)
        fp_before_to_name[fp0] = path.name

        black = to_black_rgba(orig)
        fp1 = fingerprint(black)
        if fp1 in fp_black_to_name and fp_black_to_name[fp1] != path.name:
            print(f"Warning: duplicate black pixels {fp_black_to_name[fp1]} vs {path.name}", file=sys.stderr)
        fp_black_to_name[fp1] = path.name

        raw = png_bytes(black)
        path.write_bytes(raw)
        name = path.name
        data_uris[name] = f"data:image/png;base64,{base64.standard_b64encode(raw).decode('ascii')}"
        print(f"OK {name} (black, {len(raw)} bytes)")

    def replace_data_uris(html: str) -> str:
        def repl(m: re.Match[str]) -> str:
            b64 = m.group(1)
            try:
                dec = base64.standard_b64decode(b64)
            except Exception:
                return m.group(0)
            from PIL import Image

            try:
                with Image.open(io.BytesIO(dec)) as emb:
                    fp = fingerprint(emb)
            except Exception:
                return m.group(0)
            fname = fp_before_to_name.get(fp) or fp_black_to_name.get(fp)
            if not fname:
                print(f"Warning: embedded image {fp[0]} no file match, left unchanged", file=sys.stderr)
                return m.group(0)
            return f'src="{data_uris[fname]}"'

        return re.sub(r'src="data:image/png;base64,([^"]+)"', repl, html)

    def sub_icons_path(html: str, pattern: str) -> str:
        def sub(m: re.Match[str]) -> str:
            name = m.group(1)
            if name not in data_uris:
                raise SystemExit(f"Missing icon file: {name}")
            return f'src="{data_uris[name]}"'

        return re.sub(pattern, sub, html)

    html = HTML_PATH.read_text(encoding="utf-8")
    html_new = replace_data_uris(html)
    html_new = sub_icons_path(html_new, r'src="icons/([^"]+)"')
    HTML_PATH.write_text(html_new, encoding="utf-8")

    md = MD_PATH.read_text(encoding="utf-8")
    md_new = replace_data_uris(md)
    md_new = sub_icons_path(md_new, r'src="\./icons/([^"]+)"')
    MD_PATH.write_text(md_new, encoding="utf-8")

    print("Updated", HTML_PATH.relative_to(ROOT), MD_PATH.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
