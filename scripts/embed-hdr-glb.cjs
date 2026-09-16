const { readFileSync, writeFileSync } = require('node:fs');

// Private v1 HDR attachment. Ordinary glTF readers keep the embedded SDR base color.
// No KHR_texture_basisu claim: its ratified schema does not permit UASTC HDR.
exports.embedHdrGlb = (glb, ktx, materialIndex = 0) => {
    if (glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) throw Error('Expected GLB 2.0');
    const jsonLength = glb.readUInt32LE(12);
    const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
    const binHeader = 20 + jsonLength;
    if (glb.readUInt32LE(binHeader + 4) !== 0x004e4942 || binHeader + 8 + glb.readUInt32LE(binHeader) !== glb.length) throw Error('Expected one BIN chunk');
    if (gltf.buffers?.length !== 1 || gltf.buffers[0].uri !== undefined || gltf.images?.some(image => image.uri !== undefined)) throw Error('All resources must already be embedded');
    const material = gltf.materials?.[materialIndex];
    if (material?.pbrMetallicRoughness?.baseColorTexture === undefined) throw Error('v1 requires a base-color texture');
    if (gltf.extras?.HERITAGE3D_hdr_surface) throw Error('GLB already contains an HDR surface');
    const magic = Buffer.from([0xab,0x4b,0x54,0x58,0x20,0x32,0x30,0xbb,0x0d,0x0a,0x1a,0x0a]);
    if (ktx.length < 104 || !ktx.subarray(0, 12).equals(magic)) throw Error('Expected KTX2');
    const width = ktx.readUInt32LE(20), height = ktx.readUInt32LE(24);
    const dfd = ktx.readUInt32LE(48);
    if (dfd + 16 > ktx.length || ![167, 168].includes(ktx[dfd + 12]) || ktx[dfd + 13] !== 1 || ktx[dfd + 14] !== 1) throw Error('Expected linear BT.709 UASTC HDR 4x4 / 6x6');
    let budget = 0;
    for (let w = width, h = height; w && h; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
        budget += w * h * 8;
        if (w === 1 && h === 1) break;
    }
    if (!width || !height || width > 8192 || height > 8192 || budget > 256 * 1024 * 1024) throw Error('HDR texture exceeds viewer budget');
    const binary = glb.subarray(binHeader + 8);
    const bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: ktx.length });
    gltf.extras = { ...gltf.extras, HERITAGE3D_hdr_surface: {
        version: 1, format: 'uastc-hdr-ktx2', colorSpace: 'linear-srgb', range: 'hdr',
        textures: [{ material: materialIndex, bufferView, width, height }]
    } };
    const bin = Buffer.concat([binary, ktx, Buffer.alloc((4 - ktx.length % 4) % 4)]);
    gltf.buffers[0].byteLength = bin.length;
    let json = Buffer.from(JSON.stringify(gltf));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20), bh = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + bin.length, 8);
    header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    bh.writeUInt32LE(bin.length); bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, json, bh, bin]);
};

if (require.main === module) {
    const [input, texture, output, material = '0'] = process.argv.slice(2);
    if (!input || !texture || !output || input === output) throw Error('Usage: node scripts/embed-hdr-glb.cjs input.glb texture.ktx2 output.glb [material-index]');
    const result = exports.embedHdrGlb(readFileSync(input), readFileSync(texture), Number(material));
    writeFileSync(output, result, { flag: 'wx' });
    console.log(`${output}: ${result.length} bytes; all textures embedded`);
}
