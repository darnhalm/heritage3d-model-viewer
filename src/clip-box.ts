import { Mat4, Material, MeshInstance } from 'playcanvas';

// StandardMaterial's core chunk with two extra per-material uniforms. Keeping the
// clipping test in litUserMainStartPS makes it apply to color, depth, picking and
// shadow passes on both WebGL and WebGPU.
const CLIP_UNIFORMS_GLSL = `
uniform mat4 clipBoxWorldToLocal;
uniform float clipBoxInvert;
`;

const CLIP_UNIFORMS_WGSL = `
uniform clipBoxWorldToLocal: mat4x4f;
uniform clipBoxInvert: f32;
`;

const CLIP_TEST_GLSL = `
    vec3 clipBoxPosition = (clipBoxWorldToLocal * vec4(vPositionW, 1.0)).xyz;
    bool clipBoxInside = all(lessThanEqual(abs(clipBoxPosition), vec3(0.50001)));
    if ((clipBoxInvert < 0.5 && !clipBoxInside) || (clipBoxInvert >= 0.5 && clipBoxInside)) discard;
`;

const CLIP_TEST_WGSL = `
    let clipBoxPosition: vec3f = (uniform.clipBoxWorldToLocal * vec4f(vPositionW, 1.0)).xyz;
    let clipBoxInside: bool = all(abs(clipBoxPosition) <= vec3f(0.50001));
    if ((uniform.clipBoxInvert < 0.5 && !clipBoxInside) || (uniform.clipBoxInvert >= 0.5 && clipBoxInside)) { discard; }
`;

type ChunkBackup = {
    glslCore?: string;
    glslStart?: string;
    wgslCore?: string;
    wgslStart?: string;
};

/** Adds a reversible exact oriented clipping box to lit model materials. */
export class ClipBoxMaterials {
    private readonly materials = new Map<Material, ChunkBackup>();

    private install(material: Material) {
        if (this.materials.has(material)) return;

        const glsl = material.shaderChunks.glsl;
        const wgsl = material.shaderChunks.wgsl;
        const backup: ChunkBackup = {
            glslCore: glsl.get('litShaderCorePS'),
            glslStart: glsl.get('litUserMainStartPS'),
            wgslCore: wgsl.get('litShaderCorePS'),
            wgslStart: wgsl.get('litUserMainStartPS')
        };
        this.materials.set(material, backup);

        // An absent core chunk means the engine default is used. Recreate that small
        // stable chunk here, then append our uniforms. Existing custom chunks are kept.
        const defaultCoreGlsl = `
    #if LIT_NONE_SLICE_MODE == TILED
        const float textureBias = -1000.0;
    #else
        uniform float textureBias;
    #endif
    #include "litShaderArgsPS"
`;
        const defaultCoreWgsl = `
    #if LIT_NONE_SLICE_MODE == TILED
        var<private> textureBias: f32 = -1000.0;
    #else
        uniform textureBias: f32;
    #endif
    #include "litShaderArgsPS"
`;
        glsl.set('litShaderCorePS', `${backup.glslCore ?? defaultCoreGlsl}\n${CLIP_UNIFORMS_GLSL}`);
        wgsl.set('litShaderCorePS', `${backup.wgslCore ?? defaultCoreWgsl}\n${CLIP_UNIFORMS_WGSL}`);
        glsl.set('litUserMainStartPS', `${backup.glslStart ?? ''}\n${CLIP_TEST_GLSL}`);
        wgsl.set('litUserMainStartPS', `${backup.wgslStart ?? ''}\n${CLIP_TEST_WGSL}`);
        material.update();
    }

    apply(meshInstances: MeshInstance[], worldToLocal: Mat4, invert: boolean) {
        const matrix = worldToLocal.data;
        const seen = new Set<Material>();
        meshInstances.forEach((meshInstance) => {
            const material = meshInstance.material;
            if (!material || seen.has(material)) return;
            seen.add(material);
            this.install(material);
            material.setParameter('clipBoxWorldToLocal', matrix);
            material.setParameter('clipBoxInvert', invert ? 1 : 0);
        });
    }

    clear() {
        this.materials.forEach((backup, material) => {
            const restore = (map: Map<string, string>, key: string, value?: string) => {
                if (value === undefined) map.delete(key);
                else map.set(key, value);
            };
            restore(material.shaderChunks.glsl, 'litShaderCorePS', backup.glslCore);
            restore(material.shaderChunks.glsl, 'litUserMainStartPS', backup.glslStart);
            restore(material.shaderChunks.wgsl, 'litShaderCorePS', backup.wgslCore);
            restore(material.shaderChunks.wgsl, 'litUserMainStartPS', backup.wgslStart);
            material.deleteParameter('clipBoxWorldToLocal');
            material.deleteParameter('clipBoxInvert');
            material.update();
        });
        this.materials.clear();
    }
}
