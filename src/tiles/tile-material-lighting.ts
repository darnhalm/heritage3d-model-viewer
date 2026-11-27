import { StandardMaterial, type Material } from 'playcanvas';

type OriginalLighting = Pick<StandardMaterial,
    'useLighting' | 'useSkybox' | 'diffuse' | 'diffuseMap' | 'diffuseVertexColor' | 'emissive' | 'emissiveIntensity' | 'emissiveMap' |
    'emissiveMapUv' | 'emissiveMapChannel' | 'emissiveMapTiling' | 'emissiveMapOffset' |
    'emissiveMapRotation' | 'emissiveVertexColor' | 'emissiveVertexColorChannel'>;

/** Reversible baked-colour display, including UV transforms, vertex colours and alpha. */
export class TileMaterialLighting {
    private readonly originals = new Map<StandardMaterial, OriginalLighting>();

    constructor(private unlit = false) {}

    setUnlit(enabled: boolean) {
        this.unlit = enabled;
        if (enabled) return;
        this.originals.forEach((original, material) => {
            material.useLighting = original.useLighting;
            material.useSkybox = original.useSkybox;
            material.diffuse.copy(original.diffuse);
            material.diffuseMap = original.diffuseMap;
            material.diffuseVertexColor = original.diffuseVertexColor;
            material.emissive.copy(original.emissive);
            material.emissiveIntensity = original.emissiveIntensity;
            material.emissiveMap = original.emissiveMap;
            material.emissiveMapUv = original.emissiveMapUv;
            material.emissiveMapChannel = original.emissiveMapChannel;
            material.emissiveMapTiling.copy(original.emissiveMapTiling);
            material.emissiveMapOffset.copy(original.emissiveMapOffset);
            material.emissiveMapRotation = original.emissiveMapRotation;
            material.emissiveVertexColor = original.emissiveVertexColor;
            material.emissiveVertexColorChannel = original.emissiveVertexColorChannel;
            material.update();
        });
        this.originals.clear();
    }

    apply(material: Material) {
        if (!this.unlit || !(material instanceof StandardMaterial) || !material.useLighting || this.originals.has(material)) return;
        this.originals.set(material, {
            useLighting: material.useLighting,
            useSkybox: material.useSkybox,
            diffuse: material.diffuse.clone(),
            diffuseMap: material.diffuseMap,
            diffuseVertexColor: material.diffuseVertexColor,
            emissive: material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity,
            emissiveMap: material.emissiveMap,
            emissiveMapUv: material.emissiveMapUv,
            emissiveMapChannel: material.emissiveMapChannel,
            emissiveMapTiling: material.emissiveMapTiling.clone(),
            emissiveMapOffset: material.emissiveMapOffset.clone(),
            emissiveMapRotation: material.emissiveMapRotation,
            emissiveVertexColor: material.emissiveVertexColor,
            emissiveVertexColorChannel: material.emissiveVertexColorChannel
        });
        material.useLighting = false;
        material.useSkybox = false;
        material.emissive.copy(material.diffuse);
        material.emissiveIntensity = 1;
        material.emissiveMap = material.diffuseMap;
        material.emissiveMapUv = material.diffuseMapUv;
        material.emissiveMapChannel = material.diffuseMapChannel;
        material.emissiveMapTiling.copy(material.diffuseMapTiling);
        material.emissiveMapOffset.copy(material.diffuseMapOffset);
        material.emissiveMapRotation = material.diffuseMapRotation;
        material.emissiveVertexColor = material.diffuseVertexColor;
        material.emissiveVertexColorChannel = material.diffuseVertexColorChannel;
        // Match PlayCanvas's KHR_materials_unlit mapping: the baked colour is emitted once.
        material.diffuse.set(1, 1, 1);
        material.diffuseMap = null;
        material.diffuseVertexColor = false;
        material.update();
    }

    forget(material: Material) {
        if (material instanceof StandardMaterial) this.originals.delete(material);
    }

    clear() {
        this.originals.clear();
    }
}
