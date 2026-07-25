/**
 * Parse Iridas/Adobe-style ASCII .cube / .lut (same text format).
 * - 3D: LUT_3D_SIZE n, R varies fastest in data rows (see createLutTextureFromCubeData).
 * - 1D: LUT_1D_SIZE n, n rows of RGB.
 *
 * Max 3D edge length 128: width = n² must stay within common GPU max texture width (~16384).
 * Max 1D samples 16384: same limit for 1D strip width.
 *
 * Max file size: keeps ArrayBuffer + decoded string + parsed triples within practical browser limits
 * (ASCII 128³ can be tens of MB; binary 128³ is ~24 MB).
 */

export type ParsedCubeLut3d = { kind: '3d'; size: number; rgb: Float32Array };

export type ParsedCubeLut1d = {
    kind: '1d';
    size: number;
    rgb: Float32Array;
    domainMin: [number, number, number];
    domainMax: [number, number, number];
    outputMin: number;
    outputMax: number;
};

export type ParseCubeLutResult =
    | { ok: true; lut: ParsedCubeLut3d | ParsedCubeLut1d }
    | { ok: false; reason: string };

/** n² must not exceed ~16384 on typical WebGL — n ≤ 128 */
export const MAX_3D_LUT_SIZE = 128;

/** 1D strip as W×1 texture */
export const MAX_1D_LUT_SIZE = 16384;

/** Hard cap on raw file size (bytes) before decode / parse. */
export const MAX_LUT_FILE_BYTES = 80 * 1024 * 1024;

/** Binary 3D payload: n³ × 3 × float32 */
export const MAX_BINARY_LUT_FILE_BYTES = 28 + MAX_3D_LUT_SIZE ** 3 * 12;

function stripBom(text: string): string {
    return text.replace(/^\uFEFF/, '');
}

/** Split on whitespace, commas, semicolons (some exporters use CSV-style). */
function splitTokens(line: string): string[] {
    return line
        .trim()
        .split(/[\s,;]+/)
        .filter(Boolean);
}

/** Try several header spellings used in the wild (Resolve, Nuke exports, etc.). */
function parseLut3dSizeFromLine(line: string): number {
    const patterns: RegExp[] = [
        /LUT\s*_?\s*3D\s*_?SIZE\s*[=:]?\s*(\d+)/i,
        /LUT3D\s*SIZE\s*[=:]?\s*(\d+)/i,
        /3D\s*LUT\s*SIZE\s*[=:]?\s*(\d+)/i
    ];
    for (const re of patterns) {
        const m = line.match(re);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n >= 2) {
                return n;
            }
        }
    }
    return 0;
}

function parseLut1dSizeFromLine(line: string): number {
    const patterns: RegExp[] = [
        /LUT\s*_?\s*1D\s*_?SIZE\s*[=:]?\s*(\d+)/i,
        /LUT1D\s*SIZE\s*[=:]?\s*(\d+)/i,
        /1D\s*LUT\s*SIZE\s*[=:]?\s*(\d+)/i
    ];
    for (const re of patterns) {
        const m = line.match(re);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n >= 2) {
                return n;
            }
        }
    }
    return 0;
}

function isPerfectCube(n: number): boolean {
    if (n < 8) return false;
    const r = Math.round(Math.cbrt(n));
    return r >= 2 && r <= MAX_3D_LUT_SIZE && r * r * r === n;
}

function build1dFromTriples(
    triples: Array<[number, number, number]>,
    size: number,
    domainMin: [number, number, number],
    domainMax: [number, number, number]
): ParsedCubeLut1d {
    const rgb = new Float32Array(size * 3);
    let o = 0;
    for (let i = 0; i < size; i++) {
        const t = triples[i];
        rgb[o++] = t[0];
        rgb[o++] = t[1];
        rgb[o++] = t[2];
    }
    let outputMin = Infinity;
    let outputMax = -Infinity;
    for (let i = 0; i < size; i++) {
        const r = rgb[i * 3];
        const g = rgb[i * 3 + 1];
        const b = rgb[i * 3 + 2];
        outputMin = Math.min(outputMin, r, g, b);
        outputMax = Math.max(outputMax, r, g, b);
    }
    if (!Number.isFinite(outputMin) || !Number.isFinite(outputMax) || outputMax <= outputMin) {
        outputMin = 0;
        outputMax = 1;
    }
    return {
        kind: '1d',
        size,
        rgb,
        domainMin,
        domainMax,
        outputMin,
        outputMax
    };
}

/**
 * Parse .cube / .lut text. Supports 3D and 1D ASCII LUTs.
 * Headers may use spaces, "=", alternate spellings; RGB rows may use spaces, commas, semicolons.
 * Without headers: infers 3D if triple count is n³ (2≤n≤MAX_3D_LUT_SIZE); else 1D if 2≤count≤MAX_1D_LUT_SIZE and not a full cube.
 */
export function parseCubeLut(text: string): ParseCubeLutResult {
    text = stripBom(text);
    if (text.length > MAX_LUT_FILE_BYTES) {
        return {
            ok: false,
            reason: `LUT file is too large (decoded text exceeds ${MAX_LUT_FILE_BYTES / (1024 * 1024)} MB). Export a smaller LUT or fewer decimal places.`
        };
    }
    const lines = text.split(/\r?\n/);

    let lut3dSize = 0;
    let lut1dSize = 0;
    let domainMin: [number, number, number] = [0, 0, 0];
    let domainMax: [number, number, number] = [1, 1, 1];

    const triples: Array<[number, number, number]> = [];

    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const lower = line.toLowerCase();
        if (lower.startsWith('title')) {
            continue;
        }

        const m3 = parseLut3dSizeFromLine(line);
        if (m3 >= 2) {
            lut3dSize = m3;
            continue;
        }
        const m1 = parseLut1dSizeFromLine(line);
        if (m1 >= 2) {
            lut1dSize = m1;
            continue;
        }

        if (lower.startsWith('domain_min')) {
            const parts = splitTokens(line);
            if (parts.length >= 4) {
                const a = parseFloat(parts[1]);
                const b = parseFloat(parts[2]);
                const c = parseFloat(parts[3]);
                if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
                    domainMin = [a, b, c];
                }
            }
            continue;
        }
        if (lower.startsWith('domain_max')) {
            const parts = splitTokens(line);
            if (parts.length >= 4) {
                const a = parseFloat(parts[1]);
                const b = parseFloat(parts[2]);
                const c = parseFloat(parts[3]);
                if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
                    domainMax = [a, b, c];
                }
            }
            continue;
        }

        const parts = splitTokens(line);
        if (parts.length >= 3) {
            const r = parseFloat(parts[0]);
            const g = parseFloat(parts[1]);
            const b = parseFloat(parts[2]);
            if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
                triples.push([r, g, b]);
            }
        }
    }

    const fail = (reason: string): ParseCubeLutResult => ({ ok: false, reason });

    const try3dFromHeader = (): ParsedCubeLut3d | null => {
        if (lut3dSize < 2 || lut3dSize > MAX_3D_LUT_SIZE) {
            return null;
        }
        const expected = lut3dSize * lut3dSize * lut3dSize;
        if (triples.length < expected) {
            return null;
        }
        const rgb = new Float32Array(expected * 3);
        let o = 0;
        for (let i = 0; i < expected; i++) {
            const t = triples[i];
            rgb[o++] = t[0];
            rgb[o++] = t[1];
            rgb[o++] = t[2];
        }
        return { kind: '3d', size: lut3dSize, rgb };
    };

    const try3dInfer = (): ParsedCubeLut3d | null => {
        if (triples.length === 0) {
            return null;
        }
        const n = Math.round(Math.cbrt(triples.length));
        if (n < 2 || n > MAX_3D_LUT_SIZE || n * n * n !== triples.length) {
            return null;
        }
        const expected = n * n * n;
        const rgb = new Float32Array(expected * 3);
        let o = 0;
        for (let i = 0; i < expected; i++) {
            const t = triples[i];
            rgb[o++] = t[0];
            rgb[o++] = t[1];
            rgb[o++] = t[2];
        }
        return { kind: '3d', size: n, rgb };
    };

    const try1dFromHeader = (): ParsedCubeLut1d | null => {
        if (lut1dSize < 2 || lut1dSize > MAX_1D_LUT_SIZE) {
            return null;
        }
        if (triples.length < lut1dSize) {
            return null;
        }
        return build1dFromTriples(triples, lut1dSize, domainMin, domainMax);
    };

    const try1dInfer = (): ParsedCubeLut1d | null => {
        const n = triples.length;
        if (n < 2 || n > MAX_1D_LUT_SIZE) {
            return null;
        }
        if (isPerfectCube(n)) {
            return null;
        }
        return build1dFromTriples(triples, n, domainMin, domainMax);
    };

    if (lut3dSize >= 2) {
        if (lut3dSize > MAX_3D_LUT_SIZE) {
            return fail(
                `LUT_3D_SIZE ${lut3dSize} is too large (max ${MAX_3D_LUT_SIZE} for this viewer). Re-export a smaller 3D LUT or use a standard size (17, 33, 65).`
            );
        }
        const t3 = try3dFromHeader();
        if (t3) {
            return { ok: true, lut: t3 };
        }
        const inferred3d = try3dInfer();
        if (inferred3d) {
            return { ok: true, lut: inferred3d };
        }
        return fail(
            `3D LUT: expected ${lut3dSize * lut3dSize * lut3dSize} RGB data rows (LUT_3D_SIZE ${lut3dSize}), found ${triples.length}. Check for extra text or wrong line breaks.`
        );
    }

    if (lut1dSize >= 2) {
        if (lut1dSize > MAX_1D_LUT_SIZE) {
            return fail(
                `LUT_1D_SIZE ${lut1dSize} is too large (max ${MAX_1D_LUT_SIZE}). Try a shorter 1D LUT.`
            );
        }
        const t1 = try1dFromHeader();
        if (t1) {
            return { ok: true, lut: t1 };
        }
        const inferred1d = try1dInfer();
        if (inferred1d) {
            return { ok: true, lut: inferred1d };
        }
        return fail(
            `1D LUT: expected at least ${lut1dSize} RGB rows (LUT_1D_SIZE ${lut1dSize}), found ${triples.length}.`
        );
    }

    const inferred3d = try3dInfer();
    if (inferred3d) {
        return { ok: true, lut: inferred3d };
    }

    const inferred1d = try1dInfer();
    if (inferred1d) {
        return { ok: true, lut: inferred1d };
    }

    if (lut1dSize > 0 && lut1dSize < 2) {
        return fail('LUT_1D_SIZE must be at least 2.');
    }
    if (lut3dSize > 0 && lut3dSize < 2) {
        return fail('LUT_3D_SIZE must be at least 2.');
    }

    if (triples.length === 0) {
        return fail(
            'No RGB data found. Use a text (ASCII) .cube or .lut file — binary LUT is not supported here.'
        );
    }

    const n = Math.round(Math.cbrt(triples.length));
    if (n * n * n === triples.length && n > MAX_3D_LUT_SIZE) {
        return fail(
            `This file looks like a ${n}×${n}×${n} 3D LUT, which is too large (max edge ${MAX_3D_LUT_SIZE}). Use a smaller LUT or a 1D/technical LUT.`
        );
    }

    if (triples.length > MAX_1D_LUT_SIZE && !isPerfectCube(triples.length)) {
        return fail(
            `Too many data rows (${triples.length}). Max ${MAX_1D_LUT_SIZE} for 1D or a cubic count for 3D (n≤${MAX_3D_LUT_SIZE}).`
        );
    }

    return fail(
        `Could not interpret this LUT (${triples.length} RGB rows). Expected LUT_3D_SIZE / LUT_1D_SIZE in the header, ` +
            `or a cubic row count n³ with 2≤n≤${MAX_3D_LUT_SIZE}, or a non-cubic row count between 2 and ${MAX_1D_LUT_SIZE} for 1D.`
    );
}
