import type { ParseCubeLutResult } from './parseCubeLut';
import { MAX_3D_LUT_SIZE, MAX_BINARY_LUT_FILE_BYTES } from './parseCubeLut';

/**
 * Some packs (e.g. CGDAO film stock) ship 3D LUT as raw float32 RGB triples with a small header,
 * not Iridas ASCII. Layout verified on typical files:
 * - 8 bytes: 0
 * - 4 bytes: float32 1.0
 * - 4 bytes: uint32 1
 * - 4 bytes: uint32 n (edge length, 2…128)
 * - 4 bytes: 0
 * - 4 bytes: float32 1.0
 * - then n³ × 3 float32 (R varies fastest, same as ASCII path / createLutTextureFromCubeData).
 */
const HEADER_BYTES = 28;

export function tryParseBinaryCubeLut(buf: ArrayBuffer): ParseCubeLutResult | null {
    const len = buf.byteLength;
    if (len > MAX_BINARY_LUT_FILE_BYTES) {
        return null;
    }
    if (len < HEADER_BYTES + 12) {
        return null;
    }
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0 || dv.getUint32(4, true) !== 0) {
        return null;
    }
    const f0 = dv.getFloat32(8, true);
    if (Math.abs(f0 - 1) > 1e-5) {
        return null;
    }
    if (dv.getUint32(12, true) !== 1) {
        return null;
    }
    const n = dv.getUint32(16, true);
    if (n < 2 || n > MAX_3D_LUT_SIZE) {
        return null;
    }
    if (dv.getUint32(20, true) !== 0) {
        return null;
    }
    const f1 = dv.getFloat32(24, true);
    if (Math.abs(f1 - 1) > 1e-5) {
        return null;
    }
    const dataBytes = len - HEADER_BYTES;
    const expected = n * n * n * 12;
    if (dataBytes !== expected) {
        return null;
    }
    if (HEADER_BYTES % 4 !== 0) {
        return null;
    }
    const view = new Float32Array(buf, HEADER_BYTES, n * n * n * 3);
    const rgb = view.slice();
    return { ok: true, lut: { kind: '3d', size: n, rgb } };
}
