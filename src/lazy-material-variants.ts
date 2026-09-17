type GltfTextureInfo = { index?: number };

type GltfTexture = { source?: number; extensions?: Record<string, { source?: number }> };

export type LazyVariantGltfDocument = {
    images?: Array<{ bufferView?: number; mimeType?: string; name?: string; uri?: string }>;
    textures?: GltfTexture[];
    materials?: unknown[];
    meshes?: Array<{ primitives?: Array<{
        material?: number;
        extensions?: { KHR_materials_variants?: { mappings?: Array<{ material?: number; variants?: number[] }> } };
    }> }>;
    extensions?: { KHR_materials_variants?: { variants?: Array<{ name?: string }> } };
};

export type LazyMaterialVariantPlan = {
    lazyImages: Set<number>;
    variantTextures: Map<string, Set<number>>;
    textureImages: number[];
    srgbTextures: Set<number>;
};

const textureSource = (texture?: GltfTexture): number => {
    if (!texture) return -1;
    const extensions = texture.extensions ?? {};
    return extensions.KHR_texture_basisu?.source ??
        extensions.EXT_texture_webp?.source ??
        extensions.EXT_texture_avif?.source ??
        texture.source ?? -1;
};

const collectTextureIndices = (value: unknown, result = new Set<number>(), key = ''): Set<number> => {
    if (!value || typeof value !== 'object') return result;
    if (/Texture$/.test(key) && Number.isInteger((value as GltfTextureInfo).index)) {
        result.add((value as GltfTextureInfo).index as number);
        return result;
    }
    if (Array.isArray(value)) {
        value.forEach(entry => collectTextureIndices(entry, result));
    } else {
        Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => collectTextureIndices(child, result, childKey));
    }
    return result;
};

const collectSrgbTextureIndices = (materials: unknown[]): Set<number> => {
    const result = new Set<number>();
    const colorKeys = new Set(['baseColorTexture', 'diffuseTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture']);
    const visit = (value: unknown, key = '') => {
        if (!value || typeof value !== 'object') return;
        if (colorKeys.has(key) && Number.isInteger((value as GltfTextureInfo).index)) {
            result.add((value as GltfTextureInfo).index as number);
            return;
        }
        if (Array.isArray(value)) value.forEach(entry => visit(entry));
        else Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
    };
    materials.forEach(material => visit(material));
    return result;
};

/**
 * Finds images used exclusively by KHR_materials_variants alternatives. The default
 * primitive materials remain eager, and any image shared with them also remains eager.
 *
 * @param gltf - Parsed glTF document before PlayCanvas creates materials.
 * @returns Deferred image/texture associations, or null when there is nothing to defer.
 */
export const createLazyMaterialVariantPlan = (gltf: LazyVariantGltfDocument): LazyMaterialVariantPlan | null => {
    const variantDefinitions = gltf.extensions?.KHR_materials_variants?.variants ?? [];
    if (!variantDefinitions.length || !gltf.images?.length || !gltf.textures?.length || !gltf.materials?.length) return null;

    const baseMaterials = new Set<number>();
    const variantMaterials = new Map<string, Set<number>>();
    (gltf.meshes ?? []).forEach(mesh => (mesh.primitives ?? []).forEach((primitive) => {
        if (Number.isInteger(primitive.material)) baseMaterials.add(primitive.material as number);
        (primitive.extensions?.KHR_materials_variants?.mappings ?? []).forEach((mapping) => {
            if (!Number.isInteger(mapping.material)) return;
            (mapping.variants ?? []).forEach((variantIndex) => {
                const name = variantDefinitions[variantIndex]?.name;
                if (!name) return;
                const materials = variantMaterials.get(name) ?? new Set<number>();
                materials.add(mapping.material as number);
                variantMaterials.set(name, materials);
            });
        });
    }));

    const textureImages = gltf.textures.map(textureSource);
    const eagerImages = new Set<number>();
    baseMaterials.forEach((materialIndex) => {
        collectTextureIndices(gltf.materials?.[materialIndex]).forEach((textureIndex) => {
            const imageIndex = textureImages[textureIndex];
            if (imageIndex >= 0) eagerImages.add(imageIndex);
        });
    });

    const variantTextures = new Map<string, Set<number>>();
    const candidateImages = new Set<number>();
    variantMaterials.forEach((materialIndices, name) => {
        const textures = new Set<number>();
        materialIndices.forEach(materialIndex => collectTextureIndices(gltf.materials?.[materialIndex], textures));
        variantTextures.set(name, textures);
        textures.forEach((textureIndex) => {
            const imageIndex = textureImages[textureIndex];
            if (imageIndex >= 0) candidateImages.add(imageIndex);
        });
    });

    const lazyImages = new Set([...candidateImages].filter((imageIndex) => {
        return !eagerImages.has(imageIndex) && Number.isInteger(gltf.images?.[imageIndex]?.bufferView);
    }));
    if (!lazyImages.size) return null;
    variantTextures.forEach((textures, name) => {
        variantTextures.set(name, new Set([...textures].filter(textureIndex => lazyImages.has(textureImages[textureIndex]))));
    });
    return { lazyImages, variantTextures, textureImages, srgbTextures: collectSrgbTextureIndices(gltf.materials) };
};
