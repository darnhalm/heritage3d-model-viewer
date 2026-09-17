const { readFileSync } = require('node:fs');
const path = require('node:path');

const variantDocument = (embeddedHdr = false, variantName = 'Infrared', separateVariantTexture = false) => {
    const source = readFileSync(path.join(__dirname, '../static/test-assets/BoxTextured.glb'));
    const jsonLength = source.readUInt32LE(12);
    const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
    const binOffset = 20 + jsonLength;
    const binLength = source.readUInt32LE(binOffset);
    let bin = Buffer.from(source.subarray(binOffset + 8, binOffset + 8 + binLength));
    gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'KHR_materials_variants', 'KHR_materials_unlit'])];
    gltf.extensions = {
        ...gltf.extensions,
        KHR_materials_variants: { variants: [{ name: variantName }] }
    };
    let variantTexture = gltf.materials[0].pbrMetallicRoughness.baseColorTexture.index;
    if (separateVariantTexture) {
        const sourceImage = gltf.images[gltf.textures[variantTexture].source];
        const bufferView = gltf.bufferViews.length;
        gltf.bufferViews.push({ ...gltf.bufferViews[sourceImage.bufferView] });
        const image = gltf.images.length;
        gltf.images.push({ ...sourceImage, bufferView });
        variantTexture = gltf.textures.length;
        gltf.textures.push({ ...gltf.textures[0], source: image });
    }
    gltf.materials.push({
        ...gltf.materials[0],
        name: 'Infrared Unlit',
        pbrMetallicRoughness: {
            ...gltf.materials[0].pbrMetallicRoughness,
            baseColorTexture: { index: variantTexture }
        },
        extensions: { ...gltf.materials[0].extensions, KHR_materials_unlit: {} }
    });
    for (const mesh of gltf.meshes) {
        for (const primitive of mesh.primitives) {
            primitive.extensions = {
                ...primitive.extensions,
                KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] }
            };
        }
    }
    if (embeddedHdr) {
        const payload = readFileSync(path.join(__dirname, '../static/test-assets/hdr-uastc-4x4.ktx2'));
        const byteOffset = (bin.length + 3) & ~3;
        bin = Buffer.concat([bin, Buffer.alloc(byteOffset - bin.length), payload, Buffer.alloc((4 - payload.length % 4) % 4)]);
        const bufferView = gltf.bufferViews.length;
        gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: payload.length });
        gltf.buffers[0].byteLength = bin.length;
        gltf.extras = {
            ...gltf.extras,
            HERITAGE3D_hdr_surface: {
                version: 1,
                format: 'uastc-hdr-ktx2',
                colorSpace: 'linear-srgb',
                range: 'hdr',
                textures: [{ material: 1, bufferView, width: 16, height: 16 }]
            }
        };
    }
    let json = Buffer.from(JSON.stringify(gltf));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(json.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHeader, json, binHeader, bin]);
};

exports.materialVariantsFixture = variantDocument;

// Synthetic constant-radiance fixture: independent of a display or photographic calibration.
exports.hdrFixture = (size = 64) => {
    const glb = readFileSync(path.join(__dirname, '../static/test-assets/BoxTextured.glb'));
    const jsonLength = glb.readUInt32LE(12);
    const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
    gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'KHR_materials_unlit'])];
    for (const material of gltf.materials) {
        material.extensions = { ...material.extensions, KHR_materials_unlit: {} };
    }
    let json = Buffer.from(JSON.stringify(gltf));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const rest = glb.subarray(20 + jsonLength);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + json.length + rest.length, 8);
    header.writeUInt32LE(json.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    const levels = [];
    for (let dimension = size;; dimension = Math.max(1, Math.floor(dimension / 2))) {
        const level = Buffer.alloc(dimension * dimension * 8);
        for (let offset = 0; offset < level.length; offset += 8) {
            level.writeUInt16LE(0x4400, offset); // 4.0 in float16, not uint16-normalized
            level.writeUInt16LE(0x4400, offset + 2);
            level.writeUInt16LE(0x4400, offset + 4);
            level.writeUInt16LE(0x3c00, offset + 6);
        }
        levels.push(level);
        if (dimension === 1) break;
    }
    return {
        model: Buffer.concat([header, json, rest]),
        texture: Buffer.concat(levels),
        manifest: { version: 1, format: 'rgba16f-le', colorSpace: 'linear-srgb', range: 'hdr',
            textures: [{ material: 0, uri: 'texture.bin', width: size, height: size }] }
    };
};
