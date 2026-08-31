import { Material, MeshInstance } from 'playcanvas';

/**
 * Попиксельная раскраска тайлов по разрешению.
 *
 * Отношение экранной ошибки к целевой равно `K / расстояние`, где всё постоянное для тайла
 * свёрнуто в `K`. Расстояние во фрагментном шейдере есть даром, поэтому цвет получается
 * непрерывным по поверхности — и заодно точнее CPU-версии: та берёт одно расстояние на весь
 * блок, хотя блок может тянуться вглубь.
 *
 * Соседние тайлы одного уровня сходятся на общей границе без шва: расстояние непрерывно, а `K`
 * у них одинаков. Ступенька остаётся там, где меняется уровень детализации, — и это не
 * артефакт, а сам предмет измерения.
 *
 * Палитра и логарифмическая ось повторяют `resolution-palette.ts`; менять надо в обоих местах,
 * шейдеру константы не передать без лишней униформы. Множитель 0.5 у логарифма — это деление
 * на две октавы полушкалы (`RESOLUTION_LOG_RANGE`).
 */
const TINT_UNIFORMS_GLSL = `
uniform float tileResolutionK;
`;

const TINT_UNIFORMS_WGSL = `
uniform tileResolutionK: f32;
`;

// Только forward-проход: в pick/prepass/shadow цель кадра другая, туда писать нельзя.
// Ноль в униформе выключает раскраску прямо в шейдере, без пересборки материала.
const TINT_GLSL = `
#ifdef FORWARD_PASS
    if (tileResolutionK > 0.0) {
        float tileResDistance = distance(vPositionW, view_position);
        float tileResRatio = tileResDistance > 1e-4 ? tileResolutionK / tileResDistance : 4.0;
        // Ось в октавах: уровни детализации идут вдвое, и только в логарифме шаг между
        // соседними уровнями одинаков по всей сцене. Половина шкалы — две октавы.
        float tileResT = clamp(log2(tileResRatio) * 0.5, -1.0, 1.0);
        vec3 tileResColor = tileResT <= 0.0 ?
            mix(vec3(0.93, 0.93, 0.93), vec3(0.2, 0.45, 1.0), -tileResT) :
            mix(vec3(0.93, 0.93, 0.93), vec3(1.0, 0.24, 0.16), tileResT);
        gl_FragColor = vec4(gl_FragColor.rgb * tileResColor, gl_FragColor.a);
    }
#endif
`;

const TINT_WGSL = `
#ifdef FORWARD_PASS
    if (uniform.tileResolutionK > 0.0) {
        let tileResDistance: f32 = distance(vPositionW, uniform.view_position);
        let tileResRatio: f32 = select(4.0, uniform.tileResolutionK / tileResDistance, tileResDistance > 1e-4);
        // Ось в октавах — см. пояснение у версии на GLSL.
        let tileResT: f32 = clamp(log2(tileResRatio) * 0.5, -1.0, 1.0);
        let tileResColor: vec3f = select(
            mix(vec3f(0.93, 0.93, 0.93), vec3f(1.0, 0.24, 0.16), tileResT),
            mix(vec3f(0.93, 0.93, 0.93), vec3f(0.2, 0.45, 1.0), -tileResT),
            tileResT <= 0.0
        );
        output.color = vec4f(output.color.rgb * tileResColor, output.color.a);
    }
#endif
`;

/** Чанк ядра по умолчанию: его отсутствие означает, что движок берёт свой. */
const DEFAULT_CORE_GLSL = `
    #if LIT_NONE_SLICE_MODE == TILED
        const float textureBias = -1000.0;
    #else
        uniform float textureBias;
    #endif
    #include "litShaderArgsPS"
`;

const DEFAULT_CORE_WGSL = `
    #if LIT_NONE_SLICE_MODE == TILED
        var<private> textureBias: f32 = -1000.0;
    #else
        uniform textureBias: f32;
    #endif
    #include "litShaderArgsPS"
`;

/** Попиксельная раскраска материалов тайлов по отношению ошибки к целевой. */
export class TileResolutionTint {
    private readonly materials = new Set<Material>();

    private readonly meshes = new Set<MeshInstance>();

    /**
     * Дописать наш код к чанку, если его там ещё нет.
     *
     * Проверяем по содержимому, а не по списку уже обработанных материалов: соседняя правка
     * шейдеров (обрезка фрагмента) восстанавливает свою резервную копию и может унести наш
     * кусок с собой. Проверка по тексту делает установку самовосстанавливающейся.
     *
     * @param chunks - Карта чанков одного языка.
     * @param key - Имя чанка.
     * @param code - Наш код.
     * @param fallback - Чем заменить отсутствующий чанк ядра.
     */
    private static append(chunks: Map<string, string>, key: string, code: string, fallback = '') {
        const current = chunks.get(key) ?? fallback;
        if (current.indexOf(code) !== -1) return;
        chunks.set(key, `${current}\n${code}`);
    }

    private install(material: Material) {
        const glsl = material.shaderChunks.glsl;
        const wgsl = material.shaderChunks.wgsl;
        const before = glsl.get('litUserMainEndPS');
        TileResolutionTint.append(glsl, 'litShaderCorePS', TINT_UNIFORMS_GLSL, DEFAULT_CORE_GLSL);
        TileResolutionTint.append(wgsl, 'litShaderCorePS', TINT_UNIFORMS_WGSL, DEFAULT_CORE_WGSL);
        TileResolutionTint.append(glsl, 'litUserMainEndPS', TINT_GLSL);
        TileResolutionTint.append(wgsl, 'litUserMainEndPS', TINT_WGSL);
        this.materials.add(material);
        // Пересобираем шейдер только когда что-то действительно дописали.
        if (before !== glsl.get('litUserMainEndPS')) {
            material.update();
        }
    }

    /**
     * Включить раскраску у меша и задать ему свёрнутый множитель.
     *
     * @param meshInstance - Меш тайла.
     * @param k - `геометрическая_ошибка × высота_экрана / (знаменатель × целевая_ошибка)`.
     */
    apply(meshInstance: MeshInstance, k: number) {
        const material = meshInstance.material;
        if (!material) return;
        this.install(material);
        meshInstance.setParameter('tileResolutionK', k);
        this.meshes.add(meshInstance);
    }

    /**
     * Есть ли что снимать.
     *
     * @returns `true`, если раскраска где-то проставлена.
     */
    get active(): boolean {
        return this.meshes.size > 0 || this.materials.size > 0;
    }

    /** Снять раскраску: вырезать код из чанков и убрать униформу у мешей. */
    clear() {
        this.meshes.forEach(meshInstance => meshInstance.deleteParameter('tileResolutionK'));
        this.meshes.clear();
        this.materials.forEach((material) => {
            const glsl = material.shaderChunks.glsl;
            const wgsl = material.shaderChunks.wgsl;
            const strip = (chunks: Map<string, string>, key: string, code: string) => {
                const current = chunks.get(key);
                if (current === undefined || current.indexOf(code) === -1) return;
                chunks.set(key, current.split(`\n${code}`).join(''));
            };
            strip(glsl, 'litShaderCorePS', TINT_UNIFORMS_GLSL);
            strip(wgsl, 'litShaderCorePS', TINT_UNIFORMS_WGSL);
            strip(glsl, 'litUserMainEndPS', TINT_GLSL);
            strip(wgsl, 'litUserMainEndPS', TINT_WGSL);
            material.update();
        });
        this.materials.clear();
    }
}
