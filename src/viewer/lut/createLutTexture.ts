import {
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_LINEAR,
    GraphicsDevice,
    PIXELFORMAT_RGBA8,
    Texture
} from 'playcanvas';

/**
 * Pack 3D LUT (R fastest index) into 2D texture: width = n², height = n, texel (r+b*n, g).
 */
export function createLutTextureFromCubeData(device: GraphicsDevice, rgb: Float32Array, size: number): Texture {
    const w = size * size;
    const h = size;
    const rgba = new Uint8Array(w * h * 4);

    for (let b = 0; b < size; b++) {
        for (let g = 0; g < size; g++) {
            for (let r = 0; r < size; r++) {
                const src = (r + g * size + b * size * size) * 3;
                const x = r + b * size;
                const y = g;
                const dst = (y * w + x) * 4;
                rgba[dst] = Math.min(255, Math.max(0, Math.round(rgb[src] * 255)));
                rgba[dst + 1] = Math.min(255, Math.max(0, Math.round(rgb[src + 1] * 255)));
                rgba[dst + 2] = Math.min(255, Math.max(0, Math.round(rgb[src + 2] * 255)));
                rgba[dst + 3] = 255;
            }
        }
    }

    const texture = new Texture(device, {
        name: 'lut-3d',
        width: w,
        height: h,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });

    const locked = texture.lock() as Uint8Array;
    locked.set(rgba);
    texture.unlock();

    return texture;
}

/**
 * Pack 1D LUT (N rows of RGB) into a W×1 texture; red channel holds normalized scalar curve (per-channel curve uses same table).
 */
export function createLut1DTextureFromCubeData(
    device: GraphicsDevice,
    rgb: Float32Array,
    size: number,
    outputMin: number,
    outputMax: number
): Texture {
    const w = size;
    const h = 1;
    const rgba = new Uint8Array(w * h * 4);
    const denom = outputMax > outputMin ? outputMax - outputMin : 1;

    for (let i = 0; i < size; i++) {
        const v = rgb[i * 3];
        const n = (v - outputMin) / denom;
        const b = Math.min(255, Math.max(0, Math.round(n * 255)));
        const dst = i * 4;
        rgba[dst] = b;
        rgba[dst + 1] = b;
        rgba[dst + 2] = b;
        rgba[dst + 3] = 255;
    }

    const texture = new Texture(device, {
        name: 'lut-1d',
        width: w,
        height: h,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });

    const locked = texture.lock() as Uint8Array;
    locked.set(rgba);
    texture.unlock();

    return texture;
}
