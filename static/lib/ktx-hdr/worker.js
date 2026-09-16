/* HERITAGE3D HDR-only adapter. Upstream libktx files are unmodified. */
/* global createKtxReadModule */
self.onmessage = async ({ data }) => {
    let texture;
    try {
        importScripts('libktx_read.js');
        const ktx = await createKtxReadModule({ locateFile: name => new URL(name, self.location.href).href });
        texture = new ktx.texture(new Uint8Array(data.bytes));
        const value = enumValue => enumValue?.value ?? enumValue;
        if (!texture.isHDR || !texture.isTranscodable ||
            ![ktx.khr_df_model.KHR_DF_MODEL_UASTC_HDR_4x4, ktx.khr_df_model.KHR_DF_MODEL_UASTC_HDR_6x6]
                .some(model => value(model) === value(texture.colorModel))) {
            throw new Error('Expected UASTC HDR 4x4 or 6x6 KTX2; ordinary KTX2 uses the standard loader.');
        }
        if (value(texture.transferFunction) !== value(ktx.khr_df_transfer.LINEAR) ||
            value(texture.primaries) !== value(ktx.khr_df_primaries.BT709) || texture.isPremultiplied) {
            throw new Error('HDR KTX2 must use linear BT.709/sRGB primaries and straight color.');
        }
        if (value(texture.orientation.x) !== value(ktx.OrientationX.RIGHT) ||
            value(texture.orientation.y) !== value(ktx.OrientationY.DOWN)) {
            throw new Error('HDR KTX2 must use right/down texture orientation.');
        }
        const target = data.bc6 ? ktx.transcode_fmt.BC6HU_RGB : ktx.transcode_fmt.RGBA16F;
        const result = texture.transcodeBasis(target, 0);
        if (value(result) !== value(ktx.error_code.SUCCESS)) throw new Error(`HDR transcoding failed (${value(result)}).`);
        const levels = [];
        for (let mip = 0; mip < data.levels; mip++) {
            const image = texture.getImage(mip, 0, 0);
            if (!image) throw new Error(`Missing HDR mip ${mip}.`);
            const width = Math.max(1, data.width >> mip), height = Math.max(1, data.height >> mip);
            const expected = data.bc6 ? Math.ceil(width / 4) * Math.ceil(height / 4) * 16 : width * height * 8;
            if (image.byteLength !== expected) throw new Error('Unexpected HDR mip length.');
            const copy = new Uint8Array(image);
            if (!data.bc6) {
                const samples = new Uint16Array(copy.buffer);
                for (const word of samples) {
                    if ((word & 0x7c00) === 0x7c00 || (word & 0x8000) !== 0) throw new Error('Invalid float16 sample after transcoding.');
                }
            }
            levels.push(copy.buffer);
        }
        self.postMessage({ levels, format: data.bc6 ? 'bc6hu' : 'rgba16f' }, levels);
    } catch (error) {
        self.postMessage({ error: String(error) });
    } finally {
        texture?.delete();
    }
};
