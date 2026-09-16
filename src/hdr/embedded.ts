import { parseSurfaceManifest, SurfaceManifest } from './surface';

/** Private, versioned metadata. This is NOT KHR_texture_basisu HDR support. */
export interface EmbeddedHdrDocument {
    extras?: { HERITAGE3D_hdr_surface?: unknown };
    buffers?: Array<{ uri?: string }>;
    bufferViews?: object[];
}

export interface EmbeddedHdrSurface {
    manifest: SurfaceManifest;
    read: (uri: string, limit: number) => Promise<Uint8Array>;
}

export const readEmbeddedHdr = (gltf: EmbeddedHdrDocument, views: Map<object, Uint8Array>): EmbeddedHdrSurface | undefined => {
    const value = gltf.extras?.HERITAGE3D_hdr_surface as {
        textures?: Array<{ material: number; bufferView: number; width: number; height: number }>;
    } | undefined;
    if (!value) return undefined;
    if (gltf.buffers?.length !== 1 || gltf.buffers[0].uri !== undefined) {
        throw new Error('HDR: only textures embedded in a GLB binary buffer are supported.');
    }
    const manifest = parseSurfaceManifest({
        ...value,
        textures: value.textures?.map(entry => ({ ...entry, uri: `${entry.bufferView}.ktx2` }))
    });
    if (manifest.format !== 'uastc-hdr-ktx2') throw new Error('HDR: embedded surfaces require UASTC HDR KTX2.');
    const payloads = new Map<string, Uint8Array>();
    for (const entry of value.textures) {
        if (!Number.isInteger(entry.bufferView) || entry.bufferView < 0) throw new Error('HDR: invalid embedded bufferView.');
        const bytes = views.get(gltf.bufferViews?.[entry.bufferView]);
        if (!bytes || bytes.byteLength > 256 * 1024 * 1024) throw new Error('HDR: missing or oversized embedded texture.');
        payloads.set(`${entry.bufferView}.ktx2`, bytes);
    }
    return {
        manifest,
        read: (uri, limit) => {
            const bytes = payloads.get(uri);
            if (!bytes || bytes.byteLength > limit) throw new Error('HDR: invalid embedded texture range.');
            // The worker transfers ownership. Never detach the model's shared BIN buffer.
            return Promise.resolve(bytes.slice());
        }
    };
};
