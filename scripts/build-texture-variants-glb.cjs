#!/usr/bin/env node

/**
 * Build a self-contained GLB with KTX2 base-color alternatives exposed through
 * KHR_materials_variants. The source GLB supplies geometry; its materials and
 * textures are replaced by unlit capture layers.
 *
 * Usage:
 *   node scripts/build-texture-variants-glb.cjs input.glb output.glb \
 *     Visible=visible.ktx2 IRR=irr.ktx2
 */

const fs = require('node:fs');
const path = require('node:path');

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

const [, , inputPath, outputPath, ...layerArgs] = process.argv;
if (!inputPath || !outputPath || layerArgs.length < 2) {
    console.error('Usage: build-texture-variants-glb.cjs input.glb output.glb Name=texture.ktx2 [...]');
    process.exit(1);
}

const layers = layerArgs.map((arg) => {
    const equals = arg.indexOf('=');
    if (equals < 1 || equals === arg.length - 1) throw new Error(`Invalid layer: ${arg}`);
    return { name: arg.slice(0, equals), file: arg.slice(equals + 1) };
});

const align4 = (value) => (value + 3) & ~3;
const source = fs.readFileSync(inputPath);
if (source.readUInt32LE(0) !== GLB_MAGIC || source.readUInt32LE(4) !== 2) {
    throw new Error('Input must be a GLB 2.0 file');
}

let cursor = 12;
let document;
let binary = Buffer.alloc(0);
while (cursor < source.length) {
    const length = source.readUInt32LE(cursor);
    const type = source.readUInt32LE(cursor + 4);
    const contents = source.subarray(cursor + 8, cursor + 8 + length);
    if (type === JSON_CHUNK) document = JSON.parse(contents.toString('utf8').trimEnd());
    if (type === BIN_CHUNK) binary = Buffer.from(contents);
    cursor += 8 + length;
}
if (!document) throw new Error('Input GLB has no JSON chunk');

document.bufferViews ||= [];
document.buffers ||= [{}];
// Remove the source material images and compact their embedded byte ranges. The
// geometry bufferViews keep their original ordering, with accessor references
// remapped when an image bufferView appeared before them.
const sourceImageViews = new Set((document.images || [])
    .map((image) => image.bufferView)
    .filter(Number.isInteger));
if (sourceImageViews.size) {
    const remap = new Map();
    const compactViews = [];
    let compactBinary = Buffer.alloc(0);
    document.bufferViews.forEach((view, oldIndex) => {
        if (sourceImageViews.has(oldIndex)) return;
        const byteOffset = align4(compactBinary.length);
        const bytes = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
        compactBinary = Buffer.concat([compactBinary, Buffer.alloc(byteOffset - compactBinary.length), bytes]);
        remap.set(oldIndex, compactViews.length);
        compactViews.push({ ...view, byteOffset });
    });
    const remapView = (owner) => {
        if (owner && Number.isInteger(owner.bufferView)) owner.bufferView = remap.get(owner.bufferView);
    };
    for (const accessor of document.accessors || []) {
        remapView(accessor);
        remapView(accessor.sparse?.indices);
        remapView(accessor.sparse?.values);
    }
    document.bufferViews = compactViews;
    binary = compactBinary;
}
document.samplers = [{
    name: 'Capture layer sampler',
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497
}];
document.images = [];
document.textures = [];
document.materials = [];

for (const layer of layers) {
    const bytes = fs.readFileSync(layer.file);
    if (!bytes.subarray(0, KTX2_MAGIC.length).equals(KTX2_MAGIC)) {
        throw new Error(`${layer.file} is not a KTX2 file`);
    }
    const byteOffset = align4(binary.length);
    binary = Buffer.concat([binary, Buffer.alloc(byteOffset - binary.length), bytes]);
    const bufferView = document.bufferViews.push({
        name: `${layer.name} KTX2`,
        buffer: 0,
        byteOffset,
        byteLength: bytes.length
    }) - 1;
    const image = document.images.push({
        name: layer.name,
        mimeType: 'image/ktx2',
        bufferView
    }) - 1;
    const texture = document.textures.push({
        name: layer.name,
        sampler: 0,
        extensions: { KHR_texture_basisu: { source: image } }
    }) - 1;
    document.materials.push({
        name: layer.name === 'Visible' ? 'Visible (VIS)' : layer.name,
        doubleSided: true,
        pbrMetallicRoughness: {
            baseColorTexture: { index: texture },
            metallicFactor: 0,
            roughnessFactor: 1
        },
        extensions: { KHR_materials_unlit: {} }
    });
}

const mappings = layers.map((_, index) => ({ material: index, variants: [index] }));
for (const mesh of document.meshes || []) {
    for (const primitive of mesh.primitives || []) {
        primitive.material = 0;
        primitive.extensions ||= {};
        primitive.extensions.KHR_materials_variants = { mappings };
    }
}

document.extensions ||= {};
document.extensions.KHR_materials_variants = {
    variants: layers.map(({ name }) => ({ name }))
};
document.extensionsUsed = [...new Set([
    ...(document.extensionsUsed || []).filter((name) => !name.startsWith('KHR_texture_')),
    'KHR_materials_variants',
    'KHR_materials_unlit',
    'KHR_texture_basisu'
])];
document.extensionsRequired = [...new Set([
    ...(document.extensionsRequired || []).filter((name) => !name.startsWith('KHR_texture_')),
    'KHR_texture_basisu'
])];
document.asset ||= { version: '2.0' };
document.asset.generator = `${document.asset.generator || 'glTF'}; Heritage3D texture variants builder`;
if (process.env.CAPTURE_COPYRIGHT) document.asset.copyright = process.env.CAPTURE_COPYRIGHT;
document.extras ||= {};
document.extras.HERITAGE3D_captureLayers = {
    description: 'Multispectral capture layers represented as KHR_materials_variants',
    variants: layers.map(({ name }) => name),
    ...(process.env.CAPTURE_SOURCE_URL ? { source: process.env.CAPTURE_SOURCE_URL } : {}),
    ...(process.env.CAPTURE_LICENSE ? { license: process.env.CAPTURE_LICENSE } : {})
};
if (process.env.CAPTURE_Z_UP === '1') {
    document.nodes ||= [];
    for (const scene of document.scenes || []) {
        const roots = scene.nodes || [];
        const wrapper = document.nodes.push({
            name: 'Z-up to glTF Y-up',
            rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
            children: roots
        }) - 1;
        scene.nodes = [wrapper];
    }
    document.extras.HERITAGE3D_captureLayers.sourceUpAxis = 'Z';
}
binary = Buffer.concat([binary, Buffer.alloc(align4(binary.length) - binary.length)]);
document.buffers[0].byteLength = binary.length;

let json = Buffer.from(JSON.stringify(document));
json = Buffer.concat([json, Buffer.alloc(align4(json.length) - json.length, 0x20)]);
const totalLength = 12 + 8 + json.length + 8 + binary.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(GLB_MAGIC, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length, 0);
jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length, 0);
binHeader.writeUInt32LE(BIN_CHUNK, 4);

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat([header, jsonHeader, json, binHeader, binary]));
console.log(`Wrote ${outputPath} (${layers.length} variants, ${(totalLength / 1048576).toFixed(1)} MiB)`);
