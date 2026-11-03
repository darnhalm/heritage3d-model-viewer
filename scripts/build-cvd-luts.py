#!/usr/bin/env python3
"""
build_cvd_luts.py — LUTs for colour vision deficiency (CVD): correction (daltonization)
and simulation, in the formats HERITAGE3D Viewer reads.

    python3 scripts/build-cvd-luts.py OUT_DIR

Simulation (what a viewer with the deficiency sees), as recommended by DaltonLens:
  * protan/deutan, severity < 1 — Machado, Oliveira & Fernandes (2009);
  * protanopia/deuteranopia      — Viénot, Brettel & Mollon (1999);
  * tritan                        — Brettel, Viénot & Mollon (1997).
Correction — lightness coding: the opponent axis the eye has lost (CIELAB a* for protan and
deutan, b* for tritan) is added to lightness L*, so that a colour difference the viewer cannot
see becomes a light/dark difference they can. See correct_lin().

Outputs per variant:
  * <name>.png  — 256×16 horizontal strip (16³, Unreal layout, sRGB). This is the size the
    PlayCanvas compose pass (CameraFrame colorLUT) samples, so it is the one to use.
  * <name>.cube — 33³ Adobe/IRIDAS cube, display sRGB in and out, for Photoshop, DaVinci
    Resolve, OBS and similar tools.
Simulation code: DaltonLens-Python (MIT), https://github.com/DaltonLens/DaltonLens-Python
"""
import contextlib
import io
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daltonlens import convert, simulate  # noqa: E402

D = simulate.Deficiency
SIM = simulate.Simulator_AutoSelect()

# sRGB (D65) ↔ CIELAB, for the correction.
M_XYZ = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
M_RGB = np.linalg.inv(M_XYZ)
WHITE = np.array([0.95047, 1.0, 1.08883])


def lab_from_linear(lin):
    x = (lin @ M_XYZ.T) / WHITE
    f = np.where(x > 0.008856, np.cbrt(x), 7.787 * x + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], -1)


def linear_from_lab(lab):
    fy = (lab[:, 0] + 16) / 116
    f = np.stack([fy + lab[:, 1] / 500, fy, fy - lab[:, 2] / 200], -1)
    x = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787)
    return np.clip((x * WHITE) @ M_RGB.T, 0, 1)


VARIANTS = [
    # file stem, deficiency, severity, correction strength, Russian title
    ('protanomaly', D.PROTAN, 0.6, -0.20, 'Протаномалия (слабое восприятие красного)'),
    ('protanopia', D.PROTAN, 1.0, -0.30, 'Протанопия (нет восприятия красного)'),
    ('deuteranomaly', D.DEUTAN, 0.6, -0.20, 'Дейтераномалия (слабое восприятие зелёного)'),
    ('deuteranopia', D.DEUTAN, 1.0, -0.30, 'Дейтеранопия (нет восприятия зелёного)'),
    ('tritanomaly', D.TRITAN, 0.6, 0.12, 'Тританомалия (слабое восприятие синего)'),
    ('tritanopia', D.TRITAN, 1.0, 0.20, 'Тританопия (нет восприятия синего)'),
]


def simulate_lin(lin, deficiency, severity):
    with contextlib.redirect_stdout(io.StringIO()):
        return SIM._simulate_cvd_linear_rgb(lin.astype(np.float32), deficiency, severity)


def correct_lin(lin, deficiency, strength):
    """Lightness coding of the lost opponent axis.

    A protan or deutan eye loses the red–green axis (CIELAB a*), a tritan eye the blue–yellow
    one (b*); lightness L* survives in every case. Adding strength·a* (or strength·b*) to L*
    turns a hue difference the viewer cannot see into a light/dark difference they can. Hue
    and chroma stay as they were, so the picture keeps its colours for everyone else, only
    slightly re-lit. The classic error redistribution of Fidaner et al. (2005) was tried
    first and rejected: on test palettes it made more colour pairs confusable, not fewer.
    """
    lab = lab_from_linear(lin)
    axis = 2 if deficiency == D.TRITAN else 1
    lab[:, 0] = lab[:, 0] + strength * lab[:, axis]
    return linear_from_lab(lab)


def grid(n):
    v = np.linspace(0, 1, n)
    b, g, r = np.meshgrid(v, v, v, indexing='ij')      # red fastest, then green, then blue
    return np.stack([r, g, b], -1).reshape(-1, 3)


def apply_srgb(srgb, fn):
    lin = convert.linearRGB_from_sRGB(srgb.astype(np.float32))
    return np.clip(convert.sRGB_from_linearRGB(fn(lin)), 0, 1)


def apply_strip_nodes(srgb, fn):
    """Strip nodes for the PlayCanvas compose pass, which looks the table up at pow(linear, 1/2.2),
    not at the sRGB curve: node i/15 therefore stands for linear (i/15)^2.2. Placing the nodes
    where the engine samples them cuts the error of a neutral strip from ~9 to ~3 levels."""
    return np.clip(convert.sRGB_from_linearRGB(fn(srgb ** 2.2).astype(np.float32)), 0, 1)


def write_strip(path, values, n=16):
    """values: n³ RGB in grid order (red fastest). Strip: x = b·n + r, y = g (top row g = 0)."""
    cube = values.reshape(n, n, n, 3)                    # [b, g, r]
    strip = np.zeros((n, n * n, 3))
    for b in range(n):
        strip[:, b * n:(b + 1) * n] = cube[b]           # rows g, columns r
    Image.fromarray(np.round(strip * 255).astype(np.uint8), 'RGB').save(path, optimize=True)


def write_cube(path, title, values, n):
    with open(path, 'w', newline='\n') as f:
        f.write(f'TITLE "{title}"\n# HERITAGE3D colour vision LUT. Input and output: display sRGB.\n')
        f.write(f'LUT_3D_SIZE {n}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n')
        for r, g, b in values:
            f.write(f'{r:.6f} {g:.6f} {b:.6f}\n')


def main(out):
    for kind in ('correction', 'simulation'):
        os.makedirs(os.path.join(out, kind), exist_ok=True)
    for stem, d, s, k, title in VARIANTS:
        for kind, label in (('correction', 'коррекция'), ('simulation', 'симуляция')):
            if kind == 'correction':
                f = (lambda lin: correct_lin(lin, d, k))
            else:
                f = (lambda lin: simulate_lin(lin, d, s))
            write_strip(os.path.join(out, kind, f'{kind}-{stem}-16.png'), apply_strip_nodes(grid(16), f))
            write_cube(os.path.join(out, kind, f'{kind}-{stem}-33.cube'), f'{title} — {label}', apply_srgb(grid(33), f), 33)
    # Achromatopsia cannot be corrected: simulation only (relative luminance, Rec. 709).
    lum = lambda lin: np.repeat((lin @ np.array([0.2126, 0.7152, 0.0722]))[:, None], 3, 1)
    write_strip(os.path.join(out, 'simulation', 'simulation-achromatopsia-16.png'), apply_strip_nodes(grid(16), lum))
    write_cube(os.path.join(out, 'simulation', 'simulation-achromatopsia-33.cube'), 'Ахроматопсия — симуляция', apply_srgb(grid(33), lum), 33)
    write_strip(os.path.join(out, 'neutral-16.png'), apply_strip_nodes(grid(16), lambda lin: lin))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'luts/color-vision')
