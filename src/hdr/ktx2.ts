import { GraphicsDevice, PIXELFORMAT_BC6UF, PIXELFORMAT_RGBA16F } from 'playcanvas';

export interface HdrTranscodedTexture {
    format: number;
    levels: Uint8Array[] | Uint16Array[];
    bytes: number;
}

// Validate allocations before handing an untrusted container to the WASM parser.
export const validateHdrKtx = (bytes: Uint8Array, width: number, height: number, levels: number) => {
    const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 80 + levels * 24 || !magic.every((value, i) => bytes[i] === value)) throw new Error('HDR: invalid KTX2 header.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(20, true) !== width || view.getUint32(24, true) !== height ||
        view.getUint32(28, true) !== 0 || view.getUint32(32, true) !== 0 ||
        view.getUint32(36, true) !== 1 || view.getUint32(40, true) !== levels) {
        throw new Error('HDR: KTX2 dimensions/mips must match the manifest; arrays, volumes and cubemaps are unsupported.');
    }
    const range = (offset: number, length: number) => {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
            throw new Error('HDR: KTX2 range exceeds the file.');
        }
    };
    const uint64 = (offset: number) => view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;
    let decodedBytes = 0;
    for (let mip = 0; mip < levels; mip++) {
        const offset = 80 + mip * 24;
        range(uint64(offset), uint64(offset + 8));
        decodedBytes += uint64(offset + 16);
    }
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 256 * 1024 * 1024) throw new Error('HDR: inflated KTX2 exceeds the memory budget.');
    range(view.getUint32(48, true), view.getUint32(52, true));
    const kvStart = view.getUint32(56, true), kvLength = view.getUint32(60, true);
    range(kvStart, kvLength);
    range(uint64(64), uint64(72));
    for (let offset = kvStart; offset < kvStart + kvLength;) {
        if (offset + 4 > kvStart + kvLength) throw new Error('HDR: truncated KTX2 metadata.');
        const length = view.getUint32(offset, true);
        offset += 4;
        if (offset + length > kvStart + kvLength) throw new Error('HDR: invalid KTX2 metadata size.');
        const entry = new TextDecoder().decode(bytes.subarray(offset, offset + length)).split('\0');
        // Range reconstruction and channel swizzling must never be silently dropped.
        if (entry[0] === 'KTXmapRange' || (entry[0] === 'KTXswizzle' && !['rgba', 'rgb1'].includes(entry[1]))) {
            throw new Error('HDR: prepare identity range and RGB channel order before loading this KTX2.');
        }
        offset += Math.ceil(length / 4) * 4;
    }
};

export const transcodeHdrKtx = async (device: GraphicsDevice, bytes: Uint8Array, width: number, height: number,
    levels: number, signal: AbortSignal, forceFloat = false): Promise<HdrTranscodedTexture> => {
    validateHdrKtx(bytes, width, height, levels);
    signal.throwIfAborted();
    // Engine 2.21.4 has native BC6UF mappings. Its ASTC enum is LDR and would apply
    // manual sRGB decoding, so ASTC HDR must NOT be uploaded under that enum.
    const caps = device as GraphicsDevice & { extTextureCompressionBPTC?: unknown; extCompressedTextureS3TC?: unknown };
    const bc6 = !forceFloat && (device.isWebGPU ? !!caps.extCompressedTextureS3TC : !!caps.extTextureCompressionBPTC);
    const worker = new Worker(new URL('static/lib/ktx-hdr/worker.js', document.baseURI));
    return await new Promise((resolve, reject) => {
        const state: { timer?: ReturnType<typeof setTimeout>; abort?: () => void } = {};
        const cleanup = () => {
            worker.terminate();
            clearTimeout(state.timer);
            signal.removeEventListener('abort', state.abort);
        };
        state.abort = () => {
            cleanup(); reject(new DOMException('HDR loading cancelled', 'AbortError'));
        };
        state.timer = setTimeout(() => {
            cleanup(); reject(new Error('HDR: transcoding timed out.'));
        }, 60000);
        signal.addEventListener('abort', state.abort, { once: true });
        worker.onerror = (event) => {
            cleanup(); reject(new Error(`HDR worker: ${event.message}`));
        };
        worker.onmessage = ({ data }) => {
            cleanup();
            if (data.error) {
                reject(new Error(data.error)); return;
            }
            const buffers = data.levels as ArrayBuffer[];
            const decoded = bc6 ? buffers.map(buffer => new Uint8Array(buffer)) : buffers.map(buffer => new Uint16Array(buffer));
            resolve({ format: bc6 ? PIXELFORMAT_BC6UF : PIXELFORMAT_RGBA16F,
                levels: decoded,
                bytes: decoded.reduce((sum, level) => sum + level.byteLength, 0) });
        };
        worker.postMessage({ bytes: bytes.buffer, width, height, levels, bc6 }, [bytes.buffer]);
    });
};
