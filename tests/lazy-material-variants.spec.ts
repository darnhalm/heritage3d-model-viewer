import { expect, test } from '@playwright/test';

import { createLazyMaterialVariantPlan } from '../src/lazy-material-variants';

test('only images exclusive to alternative materials are deferred', () => {
    const plan = createLazyMaterialVariantPlan({
        images: [{ bufferView: 0 }, { bufferView: 1 }, { bufferView: 2 }],
        textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
        materials: [
            { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
            { pbrMetallicRoughness: { baseColorTexture: { index: 1 } }, normalTexture: { index: 2 } },
            { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }
        ],
        extensions: { KHR_materials_variants: { variants: [{ name: 'IR' }, { name: 'Shared' }] } },
        meshes: [{ primitives: [{
            material: 0,
            extensions: { KHR_materials_variants: { mappings: [
                { material: 1, variants: [0] },
                { material: 2, variants: [1] }
            ] } }
        }] }]
    });

    expect([...plan?.lazyImages ?? []]).toEqual([1, 2]);
    expect([...plan?.variantTextures.get('IR') ?? []]).toEqual([1, 2]);
    expect([...plan?.variantTextures.get('Shared') ?? []]).toEqual([]);
    expect([...plan?.srgbTextures ?? []]).toEqual([0, 1]);
});

test('external variant images stay eager because their bytes are not embedded', () => {
    expect(createLazyMaterialVariantPlan({
        images: [{ bufferView: 0 }, { uri: 'ir.ktx2' }],
        textures: [{ source: 0 }, { source: 1 }],
        materials: [
            { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
            { pbrMetallicRoughness: { baseColorTexture: { index: 1 } } }
        ],
        extensions: { KHR_materials_variants: { variants: [{ name: 'IR' }] } },
        meshes: [{ primitives: [{
            material: 0,
            extensions: { KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] } }
        }] }]
    })).toBeNull();
});
