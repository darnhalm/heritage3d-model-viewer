import { Mat4, Material, MeshInstance } from 'playcanvas';

// StandardMaterial's core chunk with two extra per-material uniforms. Keeping the
// clipping test in litUserMainStartPS makes it apply to color, depth, picking and
// shadow passes on both WebGL and WebGPU.
const CLIP_UNIFORMS_GLSL = `
uniform mat4 clipBoxWorldToLocal;
uniform float clipBoxInvert;
uniform vec4 clipBoxEdge;
`;

const CLIP_UNIFORMS_WGSL = `
uniform clipBoxWorldToLocal: mat4x4f;
uniform clipBoxInvert: f32;
uniform clipBoxEdge: vec4f;
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

// Подсветка контура сечения: линия там, где поверхность модели пересекает грань бокса.
// Толщина задаётся в пикселях через производные (`fwidth`), поэтому линия одинаково
// заметна на любом зуме. Проверка соседних осей нужна, чтобы не светилась плоскость
// грани, продлённая за пределы бокса (важно в инвертированном режиме).
// Только forward-проход: в pick/prepass/shadow цель кадра другая, туда писать нельзя.
const CLIP_EDGE_GLSL = `
#ifdef FORWARD_PASS
    if (clipBoxEdge.w > 0.0) {
        vec3 clipEdgeLocal = (clipBoxWorldToLocal * vec4(vPositionW, 1.0)).xyz;
        vec3 clipEdgeAbs = abs(clipEdgeLocal);
        vec3 clipEdgeDist = abs(vec3(0.5) - clipEdgeAbs);
        vec3 clipEdgeBand = fwidth(clipEdgeLocal) * clipBoxEdge.w;
        bool clipEdgeHit =
            (clipEdgeDist.x < clipEdgeBand.x && clipEdgeAbs.y <= 0.5 && clipEdgeAbs.z <= 0.5) ||
            (clipEdgeDist.y < clipEdgeBand.y && clipEdgeAbs.x <= 0.5 && clipEdgeAbs.z <= 0.5) ||
            (clipEdgeDist.z < clipEdgeBand.z && clipEdgeAbs.x <= 0.5 && clipEdgeAbs.y <= 0.5);
        if (clipEdgeHit) {
            gl_FragColor = vec4(clipBoxEdge.rgb, gl_FragColor.a);
        }
    }
#endif
`;

const CLIP_EDGE_WGSL = `
#ifdef FORWARD_PASS
    if (uniform.clipBoxEdge.w > 0.0) {
        let clipEdgeLocal: vec3f = (uniform.clipBoxWorldToLocal * vec4f(vPositionW, 1.0)).xyz;
        let clipEdgeAbs: vec3f = abs(clipEdgeLocal);
        let clipEdgeDist: vec3f = abs(vec3f(0.5) - clipEdgeAbs);
        let clipEdgeBand: vec3f = fwidth(clipEdgeLocal) * uniform.clipBoxEdge.w;
        let clipEdgeHit: bool =
            (clipEdgeDist.x < clipEdgeBand.x && clipEdgeAbs.y <= 0.5 && clipEdgeAbs.z <= 0.5) ||
            (clipEdgeDist.y < clipEdgeBand.y && clipEdgeAbs.x <= 0.5 && clipEdgeAbs.z <= 0.5) ||
            (clipEdgeDist.z < clipEdgeBand.z && clipEdgeAbs.x <= 0.5 && clipEdgeAbs.y <= 0.5);
        if (clipEdgeHit) {
            output.color = vec4f(uniform.clipBoxEdge.xyz, output.color.a);
        }
    }
#endif
`;

type ChunkBackup = {
    glslCore?: string;
    glslStart?: string;
    glslEnd?: string;
    wgslCore?: string;
    wgslStart?: string;
    wgslEnd?: string;
};

/** Подсветка контура сечения: цвет линии 0..1 и её толщина в пикселях. */
type ClipBoxEdge = {
    color: [number, number, number];
    widthPx: number;
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
            glslEnd: glsl.get('litUserMainEndPS'),
            wgslCore: wgsl.get('litShaderCorePS'),
            wgslStart: wgsl.get('litUserMainStartPS'),
            wgslEnd: wgsl.get('litUserMainEndPS')
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
        glsl.set('litUserMainEndPS', `${backup.glslEnd ?? ''}\n${CLIP_EDGE_GLSL}`);
        wgsl.set('litUserMainEndPS', `${backup.wgslEnd ?? ''}\n${CLIP_EDGE_WGSL}`);
        material.update();
    }

    apply(meshInstances: MeshInstance[], worldToLocal: Mat4, invert: boolean, edge: ClipBoxEdge | null = null) {
        const matrix = worldToLocal.data;
        // Нулевая толщина выключает подсветку прямо в шейдере, без пересборки материала.
        const edgeParam = edge ?
            [edge.color[0], edge.color[1], edge.color[2], edge.widthPx] :
            [0, 0, 0, 0];
        const seen = new Set<Material>();
        meshInstances.forEach((meshInstance) => {
            const material = meshInstance.material;
            if (!material || seen.has(material)) return;
            seen.add(material);
            this.install(material);
            material.setParameter('clipBoxWorldToLocal', matrix);
            material.setParameter('clipBoxInvert', invert ? 1 : 0);
            material.setParameter('clipBoxEdge', edgeParam);
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
            restore(material.shaderChunks.glsl, 'litUserMainEndPS', backup.glslEnd);
            restore(material.shaderChunks.wgsl, 'litShaderCorePS', backup.wgslCore);
            restore(material.shaderChunks.wgsl, 'litUserMainStartPS', backup.wgslStart);
            restore(material.shaderChunks.wgsl, 'litUserMainEndPS', backup.wgslEnd);
            material.deleteParameter('clipBoxWorldToLocal');
            material.deleteParameter('clipBoxInvert');
            material.deleteParameter('clipBoxEdge');
            material.update();
        });
        this.materials.clear();
    }
}
