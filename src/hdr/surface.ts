/* eslint-disable no-await-in-loop -- Bound peak decoding memory and yield while validating large payloads. */
import {
    ADDRESS_CLAMP_TO_EDGE, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR,
    GraphicsDevice, Material, MeshInstance, PIXELFORMAT_RGBA16F, StandardMaterial, Texture
} from 'playcanvas';

import { transcodeHdrKtx } from './ktx2';

export interface SurfaceTexture {
    material: number;
    uri: string;
    width: number;
    height: number;
}

export interface SurfaceManifest {
    version: 1;
    format: 'rgba16f-le' | 'uastc-hdr-ktx2';
    transcodeTarget?: 'auto' | 'rgba16f';
    colorSpace: 'linear-srgb';
    range: 'hdr';
    textures: SurfaceTexture[];
}

const MAX_BYTES = 256 * 1024 * 1024;

// Complete mip chain, largest level first, tightly packed RGBA float16 words.
export const mipSizes = (width: number, height: number): Array<[number, number]> => {
    const levels: Array<[number, number]> = [];
    for (;;) {
        levels.push([width, height]);
        if (width === 1 && height === 1) return levels;
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
    }
};

export const parseSurfaceManifest = (value: unknown): SurfaceManifest => {
    const manifest = value as SurfaceManifest;
    if (!manifest || manifest.version !== 1 || !['rgba16f-le', 'uastc-hdr-ktx2'].includes(manifest.format) ||
        (manifest.transcodeTarget !== undefined && !['auto', 'rgba16f'].includes(manifest.transcodeTarget)) ||
        manifest.colorSpace !== 'linear-srgb' || manifest.range !== 'hdr' ||
        !Array.isArray(manifest.textures) || !manifest.textures.length || manifest.textures.length > 16) {
        throw new Error('HDR: expected a v1 rgba16f-le / linear-srgb surface manifest.');
    }
    const seen = new Set<number>();
    let bytes = 0;
    for (const entry of manifest.textures) {
        if (!entry || !Number.isInteger(entry.material) || entry.material < 0 || seen.has(entry.material) ||
            typeof entry.uri !== 'string' || !entry.uri ||
            ![entry.width, entry.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) {
            throw new Error('HDR: invalid dimensions, URI or duplicate material binding.');
        }
        seen.add(entry.material);
        bytes += mipSizes(entry.width, entry.height).reduce((sum, [w, h]) => sum + w * h * 8, 0);
    }
    if (bytes > MAX_BYTES) throw new Error('HDR: texture package exceeds the 256 MiB budget.');
    return manifest;
};

// Bound network allocations even when a server omits Content-Length.
export const fetchBytes = async (url: string, limit: number, signal: AbortSignal): Promise<Uint8Array> => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HDR: HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > limit) throw new Error('HDR: resource exceeds its size budget.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('HDR: response has no body.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) throw new Error('HDR: resource exceeds its size budget.');
            chunks.push(value);
        }
    } finally {
        await reader.cancel();
        reader.releaseLock();
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
};

/** Owns only HDR replacements. Original GLB materials and textures remain available. */
export class HdrSurface {
    readonly textures: Texture[] = [];

    readonly materials: StandardMaterial[] = [];

    private originals = new Map<MeshInstance, Material>();

    bytes = 0;

    static async load(device: GraphicsDevice, url: string, sourceMaterials: Material[], instances: MeshInstance[],
        signal: AbortSignal, resolveUri = (uri: string) => new URL(uri, url).href): Promise<HdrSurface> {
        const manifest = parseSurfaceManifest(JSON.parse(new TextDecoder().decode(await fetchBytes(url, 65536, signal))));
        return HdrSurface.loadData(device, manifest, sourceMaterials, instances, signal,
            (uri, limit) => fetchBytes(resolveUri(uri), limit, signal));
    }

    static async loadData(device: GraphicsDevice, value: unknown, sourceMaterials: Material[], instances: MeshInstance[],
        signal: AbortSignal, read: (uri: string, limit: number) => Promise<Uint8Array>): Promise<HdrSurface> {
        if (!device.textureHalfFloatRenderable || !device.textureHalfFloatFilterable) {
            throw new Error('HDR: this device cannot filter and render float16 textures.');
        }
        const manifest = parseSurfaceManifest(value);
        const result = new HdrSurface();
        const replacements = new Map<Material, StandardMaterial>();
        try {
            for (const entry of manifest.textures) {
                const original = sourceMaterials[entry.material];
                if (!(original instanceof StandardMaterial)) {
                    throw new Error('HDR: bindings must reference standard materials in the loaded GLB.');
                }
                const matches = instances.filter(mi => mi.material === original);
                // Встроенный пакет может содержать HDR-карты сразу для нескольких
                // KHR_materials_variants. Декодируем лишь активные материалы.
                if (!matches.length) continue;
                const baseMap = original.useLighting ? original.diffuseMap : original.emissiveMap;
                if (!baseMap) throw new Error('HDR: the material needs a base-color texture and UV mapping.');
                if (entry.width > device.maxTextureSize || entry.height > device.maxTextureSize) {
                    throw new Error('HDR: texture exceeds the device dimension limit.');
                }
                const sizes = mipSizes(entry.width, entry.height);
                const size = sizes.reduce((sum, [w, h]) => sum + w * h * 8, 0);
                let levels: Uint8Array[] | Uint16Array[];
                let format: number = PIXELFORMAT_RGBA16F;
                let gpuBytes = size;
                if (manifest.format === 'uastc-hdr-ktx2') {
                    const encoded = await read(entry.uri, MAX_BYTES);
                    const decoded = await transcodeHdrKtx(device, encoded, entry.width, entry.height, sizes.length, signal, manifest.transcodeTarget === 'rgba16f');
                    levels = decoded.levels;
                    format = decoded.format;
                    gpuBytes = decoded.bytes;
                } else {
                    const raw = await read(entry.uri, size);
                    if (raw.byteLength !== size) throw new Error('HDR: truncated float16 mip chain.');
                    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
                    const words = new Uint16Array(size / 2);
                    for (let i = 0; i < words.length; i++) {
                        const word = view.getUint16(i * 2, true);
                        // v1 deliberately accepts only finite, nonnegative linear sRGB and alpha [0,1].
                        if ((word & 0x7c00) === 0x7c00 || (word & 0x8000) !== 0 || (i % 4 === 3 && word > 0x3c00)) {
                            throw new Error('HDR: invalid sample (NaN, infinity, negative RGB or alpha outside [0,1]).');
                        }
                        words[i] = word;
                        if (i > 0 && i % 262144 === 0) {
                            await new Promise((resolve) => {
                                setTimeout(resolve, 0);
                            });
                            signal.throwIfAborted();
                        }
                    }
                    let offset = 0;
                    levels = sizes.map(([w, h]) => {
                        const level = words.subarray(offset, offset + w * h * 4);
                        offset += w * h * 4;
                        return level;
                    });
                }
                const texture = new Texture(device, {
                    name: `HDR:${entry.uri}`,
                    width: entry.width,
                    height: entry.height,
                    format,
                    levels,
                    mipmaps: true,
                    minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
                    magFilter: FILTER_LINEAR,
                    addressU: baseMap.addressU ?? ADDRESS_CLAMP_TO_EDGE,
                    addressV: baseMap.addressV ?? ADDRESS_CLAMP_TO_EDGE
                });
                result.textures.push(texture);
                result.bytes += gpuBytes;
                const material = original.clone();
                material.name = original.name;
                // glTF Unlit stores base color in emissiveMap; Lit uses diffuseMap.
                // Cloning preserves factors, UV transforms, other maps and opacity.
                if (original.useLighting) material.diffuseMap = texture;
                else material.emissiveMap = texture;
                material.update();
                result.materials.push(material);
                replacements.set(original, material);
                for (const mi of matches) result.originals.set(mi, original);
            }
            signal.throwIfAborted();
            if (result.originals.size === 0) throw new Error('HDR: no texture is bound to the active material variant.');
            // Commit only after every binding and payload has passed validation.
            for (const [mi, original] of result.originals) mi.material = replacements.get(original) ?? original;
            return result;
        } catch (error) {
            result.destroy();
            throw error;
        }
    }

    destroy() {
        for (const [mi, original] of this.originals) mi.material = original;
        this.originals.clear();
        this.materials.forEach(material => material.destroy());
        this.textures.forEach(texture => texture.destroy());
    }
}
