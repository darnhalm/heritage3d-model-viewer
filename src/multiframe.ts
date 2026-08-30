import {
    BLENDEQUATION_ADD,
    BLENDMODE_CONSTANT,
    BLENDMODE_ONE_MINUS_CONSTANT,
    EVENT_POSTRENDER,
    EVENT_PRERENDER,
    FILTER_LINEAR,
    PIXELFORMAT_RGBA8,
    PIXELFORMAT_RGBA16F,
    PIXELFORMAT_RGBA32F,
    PROJECTION_ORTHOGRAPHIC,
    SEMANTIC_POSITION,
    BlendState,
    CameraComponent,
    RenderPassShaderQuad,
    RenderTarget,
    ScopeSpace,
    Shader,
    ShaderUtils,
    Texture,
    Vec3,
    GraphicsDevice,
    EventHandler
} from 'playcanvas';

const gamma = 2.2;

const vertexGLSL = `
    attribute vec2 vertex_position;
    varying vec2 texcoord;
    uniform vec4 texcoordMod;
    void main(void) {
        gl_Position = vec4(vertex_position, 0.5, 1.0);
        texcoord = (vertex_position.xy * 0.5 + 0.5) * texcoordMod.xy + texcoordMod.zw;
    }
`;

const fragmentGLSL = `
    varying vec2 texcoord;
    uniform sampler2D multiframeTex;
    uniform float power;
    uniform float sharpness;
    uniform float easuEnabled;
    uniform vec2 srcSize;
    uniform vec2 outputTexel;

    vec3 tap(vec2 uv) {
        return pow(texture2D(multiframeTex, uv).rgb, vec3(power));
    }

    // --- EASU из FSR 1.0 -------------------------------------------------------------------
    // Растяжка с восстановлением кромок: по крестовине яркостей вокруг пикселя определяется
    // направление и выраженность кромки, из них строится вытянутое вдоль неё ядро Ланцоша, и
    // двенадцать отсчётов складываются с его весами. Билинейная выборка так не умеет — она
    // усредняет по квадрату и кромку размазывает.

    vec3 easuTapColor(vec2 uv) {
        return pow(texture2D(multiframeTex, uv).rgb, vec3(power));
    }

    void easuSet(inout vec2 dir, inout float len, float w,
                 float lA, float lB, float lC, float lD, float lE) {
        float dc = lD - lC;
        float cb = lC - lB;
        float lenX = 1.0 / max(max(abs(dc), abs(cb)), 1e-5);
        float dirX = lD - lB;
        dir.x += dirX * w;
        lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
        len += lenX * lenX * w;

        float ec = lE - lC;
        float ca = lC - lA;
        float lenY = 1.0 / max(max(abs(ec), abs(ca)), 1e-5);
        float dirY = lE - lA;
        dir.y += dirY * w;
        lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
        len += lenY * lenY * w;
    }

    void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2,
                 float lob, float clp, vec3 c) {
        vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * (-dir.y) + off.y * dir.x) * len2;
        float d2 = min(v.x * v.x + v.y * v.y, clp);
        float wB = 0.4 * d2 - 1.0;
        float wA = lob * d2 - 1.0;
        wB *= wB;
        wA *= wA;
        wB = 1.5625 * wB - 0.5625;
        float w = wB * wA;
        aC += c * w;
        aW += w;
    }

    vec3 easu(vec2 uv) {
        vec2 pp = uv * srcSize - 0.5;
        vec2 fp = floor(pp);
        pp -= fp;
        vec2 t = (fp + 0.5) / srcSize;
        vec2 sp = 1.0 / srcSize;

        vec3 cb = easuTapColor(t + vec2(0.0, -1.0) * sp);
        vec3 cc = easuTapColor(t + vec2(1.0, -1.0) * sp);
        vec3 ce = easuTapColor(t + vec2(-1.0, 0.0) * sp);
        vec3 cf = easuTapColor(t);
        vec3 cg = easuTapColor(t + vec2(1.0, 0.0) * sp);
        vec3 ch = easuTapColor(t + vec2(2.0, 0.0) * sp);
        vec3 ci = easuTapColor(t + vec2(-1.0, 1.0) * sp);
        vec3 cj = easuTapColor(t + vec2(0.0, 1.0) * sp);
        vec3 ck = easuTapColor(t + vec2(1.0, 1.0) * sp);
        vec3 cl = easuTapColor(t + vec2(2.0, 1.0) * sp);
        vec3 cn = easuTapColor(t + vec2(0.0, 2.0) * sp);
        vec3 co = easuTapColor(t + vec2(1.0, 2.0) * sp);

        // Яркость берём по зелёному каналу, как в эталонной реализации: он ближе всего к
        // светлоте и не требует лишних умножений на каждый из двенадцати отсчётов.
        vec2 dir = vec2(0.0);
        float len = 0.0;
        easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), cb.g, ce.g, cf.g, cg.g, cj.g);
        easuSet(dir, len, pp.x * (1.0 - pp.y), cc.g, cf.g, cg.g, ch.g, ck.g);
        easuSet(dir, len, (1.0 - pp.x) * pp.y, cf.g, ci.g, cj.g, ck.g, cn.g);
        easuSet(dir, len, pp.x * pp.y, cg.g, cj.g, ck.g, cl.g, co.g);

        vec2 dir2 = dir * dir;
        float dirR = dir2.x + dir2.y;
        bool zro = dirR < (1.0 / 32768.0);
        dirR = inversesqrt(max(dirR, 1e-8));
        dirR = zro ? 1.0 : dirR;
        dir.x = zro ? 1.0 : dir.x;
        dir *= dirR;

        len = len * 0.5;
        len *= len;

        // Ядро вытягивается вдоль кромки: по диагонали до корня из двух, поперёк — сжимается.
        float stretch = (dir.x * dir.x + dir.y * dir.y) / max(max(abs(dir.x), abs(dir.y)), 1e-5);
        vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
        float lob = 0.5 - 0.29 * len;
        float clp = 1.0 / lob;

        vec3 aC = vec3(0.0);
        float aW = 0.0;
        easuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, cb);
        easuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, cc);
        easuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, ci);
        easuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, cj);
        easuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, cf);
        easuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, ce);
        easuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, ck);
        easuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, cl);
        easuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, ch);
        easuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, cg);
        easuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, co);
        easuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, cn);

        return max(aC / max(aW, 1e-5), vec3(0.0));
    }

    void main(void) {
        vec4 centerTexel = texture2D(multiframeTex, texcoord);
        vec3 e = pow(centerTexel.rgb, vec3(power));
        float alpha = pow(centerTexel.a, power);

        // При растяжке кромки восстанавливает EASU, и подрезчивать поверх нечего: RCAS работает
        // по соседям выхода, а их у нас нет — эталонный FSR ставит его отдельным проходом.
        if (easuEnabled > 0.5) {
            gl_FragColor = vec4(easu(texcoord), alpha);
            return;
        }

        if (sharpness <= 0.0) {
            gl_FragColor = vec4(e, alpha);
            return;
        }

        vec3 b = tap(texcoord + vec2(0.0, -outputTexel.y));
        vec3 h = tap(texcoord + vec2(0.0, outputTexel.y));
        vec3 d = tap(texcoord + vec2(-outputTexel.x, 0.0));
        vec3 f = tap(texcoord + vec2(outputTexel.x, 0.0));

        vec3 mn4 = min(min(b, d), min(f, h));
        vec3 mx4 = max(max(b, d), max(f, h));
        vec3 hitMin = mn4 / (4.0 * mx4 + 1e-5);
        vec3 hitMax = (1.0 - mx4) / (4.0 * mn4 - 4.0 - 1e-5);
        vec3 lobeRGB = max(-hitMin, hitMax);
        float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * sharpness;

        vec3 color = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
        gl_FragColor = vec4(clamp(color, min(mn4, e), max(mx4, e)), alpha);
    }
`;

// Апскейл: билинейная растяжка плюс адаптивная резкость.
//
// Растянутая картинка мягкая — билинейная выборка съедает контраст кромок. Классический
// unsharp mask возвращает его, но одинаковой силы для всего кадра он не годится: на почти
// плоском небе он вытащит шум, а на контрастной кромке выбьет пиксель за пределы диапазона
// и оставит светлую кайму.
//
// Поэтому сила усиления считается на каждый пиксель из запаса яркости в его окрестности:
// сколько есть места вниз (`mn`) и вверх (`1 - mx`). Там, где пиксель у края диапазона,
// запаса нет и резкость гасится сама. Корень смягчает переход. Итог дополнительно зажат в
// [mn, mx] — это не даёт появиться ореолу вокруг кромок.
//
// Ядро записано в форме (c + w·сумма_соседей) / (1 + 4w) с отрицательным w: на однородном
// участке оно даёт ровно исходный цвет, то есть плоские области не трогаются вообще.
//
// Это НЕ порт FSR или SGSR. Те дают лучшую реконструкцию кромок за счёт направленного
// анализа, но их надо переносить с исходников, а не по памяти. Здесь простая и проверяемая
// вещь; если качества не хватит, EASU встанет на это же место.
const vertexWGSL = /* wgsl */`
    attribute vertex_position: vec2f;

    varying texcoord: vec2f;

    uniform texcoordMod: vec4f;

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;

        output.position = vec4f(vertex_position, 0.5, 1.0);
        output.texcoord = (vertex_position.xy * 0.5 + 0.5) * uniform.texcoordMod.xy + uniform.texcoordMod.zw;

        return output;
    }
`;

const fragmentWGSL = /* wgsl */`
    varying texcoord: vec2f;

    var multiframeTex: texture_2d<f32>;
    var multiframeSampler: sampler;

    uniform power: f32;
    uniform sharpness: f32;
    uniform easuEnabled: f32;
    uniform srcSize: vec2f;
    uniform outputTexel: vec2f;

    fn tap(uv: vec2f) -> vec3f {
        let t: vec4f = textureSample(multiframeTex, multiframeSampler, uv);
        return pow(t.rgb, vec3f(uniform.power));
    }

    // --- EASU из FSR 1.0 (см. пояснение у версии на GLSL) ---
    fn easuTapColor(uv: vec2f) -> vec3f {
        let t: vec4f = textureSample(multiframeTex, multiframeSampler, uv);
        return pow(t.rgb, vec3f(uniform.power));
    }

    fn easuSet(dir: ptr<function, vec2f>, len: ptr<function, f32>, w: f32,
               lA: f32, lB: f32, lC: f32, lD: f32, lE: f32) {
        let dc: f32 = lD - lC;
        let cb: f32 = lC - lB;
        let lenXr: f32 = 1.0 / max(max(abs(dc), abs(cb)), 1e-5);
        let dirX: f32 = lD - lB;
        (*dir).x = (*dir).x + dirX * w;
        let lenX: f32 = clamp(abs(dirX) * lenXr, 0.0, 1.0);
        *len = *len + lenX * lenX * w;

        let ec: f32 = lE - lC;
        let ca: f32 = lC - lA;
        let lenYr: f32 = 1.0 / max(max(abs(ec), abs(ca)), 1e-5);
        let dirY: f32 = lE - lA;
        (*dir).y = (*dir).y + dirY * w;
        let lenY: f32 = clamp(abs(dirY) * lenYr, 0.0, 1.0);
        *len = *len + lenY * lenY * w;
    }

    fn easuTap(aC: ptr<function, vec3f>, aW: ptr<function, f32>, off: vec2f, dir: vec2f,
               len2: vec2f, lob: f32, clp: f32, c: vec3f) {
        let v: vec2f = vec2f(off.x * dir.x + off.y * dir.y, off.x * (-dir.y) + off.y * dir.x) * len2;
        let d2: f32 = min(v.x * v.x + v.y * v.y, clp);
        var wB: f32 = 0.4 * d2 - 1.0;
        var wA: f32 = lob * d2 - 1.0;
        wB = wB * wB;
        wA = wA * wA;
        wB = 1.5625 * wB - 0.5625;
        let w: f32 = wB * wA;
        *aC = *aC + c * w;
        *aW = *aW + w;
    }

    fn easu(uv: vec2f) -> vec3f {
        var pp: vec2f = uv * uniform.srcSize - 0.5;
        let fp: vec2f = floor(pp);
        pp = pp - fp;
        let t: vec2f = (fp + 0.5) / uniform.srcSize;
        let sp: vec2f = 1.0 / uniform.srcSize;

        let cb: vec3f = easuTapColor(t + vec2f(0.0, -1.0) * sp);
        let cc: vec3f = easuTapColor(t + vec2f(1.0, -1.0) * sp);
        let ce: vec3f = easuTapColor(t + vec2f(-1.0, 0.0) * sp);
        let cf: vec3f = easuTapColor(t);
        let cg: vec3f = easuTapColor(t + vec2f(1.0, 0.0) * sp);
        let ch: vec3f = easuTapColor(t + vec2f(2.0, 0.0) * sp);
        let ci: vec3f = easuTapColor(t + vec2f(-1.0, 1.0) * sp);
        let cj: vec3f = easuTapColor(t + vec2f(0.0, 1.0) * sp);
        let ck: vec3f = easuTapColor(t + vec2f(1.0, 1.0) * sp);
        let cl: vec3f = easuTapColor(t + vec2f(2.0, 1.0) * sp);
        let cn: vec3f = easuTapColor(t + vec2f(0.0, 2.0) * sp);
        let co: vec3f = easuTapColor(t + vec2f(1.0, 2.0) * sp);

        var dir: vec2f = vec2f(0.0);
        var len: f32 = 0.0;
        easuSet(&dir, &len, (1.0 - pp.x) * (1.0 - pp.y), cb.g, ce.g, cf.g, cg.g, cj.g);
        easuSet(&dir, &len, pp.x * (1.0 - pp.y), cc.g, cf.g, cg.g, ch.g, ck.g);
        easuSet(&dir, &len, (1.0 - pp.x) * pp.y, cf.g, ci.g, cj.g, ck.g, cn.g);
        easuSet(&dir, &len, pp.x * pp.y, cg.g, cj.g, ck.g, cl.g, co.g);

        let dir2: vec2f = dir * dir;
        var dirR: f32 = dir2.x + dir2.y;
        let zro: bool = dirR < (1.0 / 32768.0);
        dirR = inverseSqrt(max(dirR, 1e-8));
        dirR = select(dirR, 1.0, zro);
        dir.x = select(dir.x, 1.0, zro);
        dir = dir * dirR;

        var lenS: f32 = len * 0.5;
        lenS = lenS * lenS;

        let stretch: f32 = (dir.x * dir.x + dir.y * dir.y) / max(max(abs(dir.x), abs(dir.y)), 1e-5);
        let len2: vec2f = vec2f(1.0 + (stretch - 1.0) * lenS, 1.0 - 0.5 * lenS);
        let lob: f32 = 0.5 - 0.29 * lenS;
        let clp: f32 = 1.0 / lob;

        var aC: vec3f = vec3f(0.0);
        var aW: f32 = 0.0;
        easuTap(&aC, &aW, vec2f(0.0, -1.0) - pp, dir, len2, lob, clp, cb);
        easuTap(&aC, &aW, vec2f(1.0, -1.0) - pp, dir, len2, lob, clp, cc);
        easuTap(&aC, &aW, vec2f(-1.0, 1.0) - pp, dir, len2, lob, clp, ci);
        easuTap(&aC, &aW, vec2f(0.0, 1.0) - pp, dir, len2, lob, clp, cj);
        easuTap(&aC, &aW, vec2f(0.0, 0.0) - pp, dir, len2, lob, clp, cf);
        easuTap(&aC, &aW, vec2f(-1.0, 0.0) - pp, dir, len2, lob, clp, ce);
        easuTap(&aC, &aW, vec2f(1.0, 1.0) - pp, dir, len2, lob, clp, ck);
        easuTap(&aC, &aW, vec2f(2.0, 1.0) - pp, dir, len2, lob, clp, cl);
        easuTap(&aC, &aW, vec2f(2.0, 0.0) - pp, dir, len2, lob, clp, ch);
        easuTap(&aC, &aW, vec2f(1.0, 0.0) - pp, dir, len2, lob, clp, cg);
        easuTap(&aC, &aW, vec2f(1.0, 2.0) - pp, dir, len2, lob, clp, co);
        easuTap(&aC, &aW, vec2f(0.0, 2.0) - pp, dir, len2, lob, clp, cn);

        return max(aC / max(aW, 1e-5), vec3f(0.0));
    }

    @fragment
    fn fragmentMain(input: FragmentInput) -> FragmentOutput {
        var output: FragmentOutput;

        let centerTexel: vec4f = textureSample(multiframeTex, multiframeSampler, input.texcoord);
        let e: vec3f = pow(centerTexel.rgb, vec3f(uniform.power));
        let alpha: f32 = pow(centerTexel.a, uniform.power);

        if (uniform.easuEnabled > 0.5) {
            output.color = vec4f(easu(input.texcoord), alpha);
            return output;
        }

        if (uniform.sharpness <= 0.0) {
            output.color = vec4f(e, alpha);
            return output;
        }

        let b: vec3f = tap(input.texcoord + vec2f(0.0, -uniform.outputTexel.y));
        let h: vec3f = tap(input.texcoord + vec2f(0.0, uniform.outputTexel.y));
        let d: vec3f = tap(input.texcoord + vec2f(-uniform.outputTexel.x, 0.0));
        let f: vec3f = tap(input.texcoord + vec2f(uniform.outputTexel.x, 0.0));

        let mn4: vec3f = min(min(b, d), min(f, h));
        let mx4: vec3f = max(max(b, d), max(f, h));
        let hitMin: vec3f = mn4 / (4.0 * mx4 + 1e-5);
        let hitMax: vec3f = (vec3f(1.0) - mx4) / (4.0 * mn4 - 4.0 - 1e-5);
        let lobeRGB: vec3f = max(-hitMin, hitMax);
        let lobe: f32 = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uniform.sharpness;

        let color: vec3f = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
        output.color = vec4f(clamp(color, min(mn4, e), max(mx4, e)), alpha);

        return output;
    }
`;

const supportsFloat16 = (device: GraphicsDevice): boolean => {
    return device.textureHalfFloatRenderable;
};

const supportsFloat32 = (device: GraphicsDevice): boolean => {
    return device.textureFloatRenderable;
};

// lighting source should be stored HDR
const choosePixelFormat = (device: GraphicsDevice): number => {
    return supportsFloat16(device) ? PIXELFORMAT_RGBA16F :
        supportsFloat32(device) ? PIXELFORMAT_RGBA32F :
            PIXELFORMAT_RGBA8;
};

// calculate 1d gauss
const gauss = (x: number, sigma: number): number => {
    return (1.0 / (Math.sqrt(2.0 * Math.PI) * sigma)) * Math.exp(-(x * x) / (2.0 * sigma * sigma));
};

/**
 * Сила резкости по умолчанию — множитель к лобе RCAS.
 *
 * Единица означает полную силу фильтра. RCAS сам ограничивает лобу пределом 0.1875, за которым
 * знаменатель ядра `1 + 4·lobe` подходит к нулю, поэтому развалиться картинка не может даже на
 * единице; меньшие значения просто мягче.
 */
const DEFAULT_SHARPNESS = 0.5;

const accumBlend = new BlendState(true, BLENDEQUATION_ADD, BLENDMODE_CONSTANT, BLENDMODE_ONE_MINUS_CONSTANT);
const noBlend = new BlendState(false);

class CustomRenderPass extends RenderPassShaderQuad {
    events = new EventHandler();

    execute() {
        this.events.fire('execute');
        super.execute();
    }
}

const resolve = (scope: ScopeSpace, values: any) => {
    for (const key in values) {
        scope.resolve(key).setValue(values[key]);
    }
};

// generate multiframe, supersampled AA
class Multiframe {
    device: GraphicsDevice;

    camera: CameraComponent;

    textureBias: number;

    shader: Shader = null;

    /** Шейдер финального прохода, когда цель сцены мельче бэкбуфера. */
    /** Сила резкости RCAS: 0 выключает фильтр целиком. */
    sharpness = DEFAULT_SHARPNESS;

    accumTexture: Texture = null;

    accumRenderTarget: RenderTarget = null;

    updateRenderPass: CustomRenderPass;

    finalRenderPass: CustomRenderPass;

    sampleArray: Vec3[] = [];

    sampleId = 0;

    sampleAccum = 0;

    enabled = true;

    blend = 1.0;

    constructor(device: GraphicsDevice, camera: CameraComponent, samples?: Vec3[]) {
        this.device = device;
        this.camera = camera;
        this.samples = samples || Multiframe.generateSamples(5, false, 2, 0);

        // just before rendering the scene we apply a subpixel jitter
        // to the camera's projection matrix.
        //
        // Where the jitter goes depends on the projection. In a perspective matrix the
        // skew terms m[8]/m[9] are divided by w = -z, so the shift is the same at every
        // depth. An orthographic matrix has w = 1, so those same terms would shift each
        // fragment proportionally to its view depth — a deep scene (a 3D Tiles set, say)
        // smears into overlapping ghost copies instead of anti-aliasing. Orthographic
        // therefore jitters the translation terms m[12]/m[13], which are plain NDC offsets.
        // Both pairs are zero in an un-jittered symmetric frustum, so clearing them is safe.
        const jitterIndices = (): [number, number] => {
            return this.camera.camera.projection === PROJECTION_ORTHOGRAPHIC ? [12, 13] : [8, 9];
        };

        const preRender = (c: CameraComponent) => {
            if (c !== this.camera) {
                return;
            }

            const camera = this.camera.camera;
            const pmat = camera.projectionMatrix;
            const [ix, iy] = jitterIndices();

            pmat.data[8] = 0;
            pmat.data[9] = 0;
            pmat.data[12] = 0;
            pmat.data[13] = 0;

            if (this.enabled && this.accumTexture) {
                const sample = this.sampleArray[this.sampleId];
                // m[12]/m[13] shift NDC directly, m[8]/m[9] shift it through the -z divide,
                // so the orthographic pair takes the opposite sign to jitter the same way.
                const sign = ix === 12 ? -1 : 1;
                pmat.data[ix] = sign * sample.x / this.accumTexture.width;
                pmat.data[iy] = sign * sample.y / this.accumTexture.height;
                // Байас наращиваем по числу уже накопленных сэмплов, а не переключаем скачком.
                // За формулой стоит смысл: сдвиг уровня мипа допустим ровно настолько, насколько
                // есть усреднения, которые погасят вызванную им рябь. Прежний код прыгал с нуля
                // на конечное значение — при шестнадцати сэмплах это два уровня мипа разом, и
                // текстуры скачком становились резкими в момент остановки камеры.
                const settled = Math.max(1, this.sampleId);
                const bias = Math.max(this.textureBias, -Math.log2(Math.sqrt(settled)));
                resolve(device.scope, {
                    textureBias: this.sampleId === 0 ? 0.0 : bias
                });
            } else {
                resolve(device.scope, {
                    textureBias: 0
                });
            }

            // look away now
            camera._viewProjMatDirty = true;
        };

        const postRender = (c: CameraComponent) => {
            if (c !== this.camera) {
                return;
            }
            const pmat = camera.projectionMatrix;
            pmat.data[8] = 0;
            pmat.data[9] = 0;
            pmat.data[12] = 0;
            pmat.data[13] = 0;
        };

        this.camera.system.app.scene.on(EVENT_PRERENDER, preRender);
        this.camera.system.app.scene.on(EVENT_POSTRENDER, postRender);

        this.shader = ShaderUtils.createShader(device, {
            uniqueName: 'multiframe-shader',
            attributes: {
                vertex_position: SEMANTIC_POSITION
            },
            vertexGLSL,
            fragmentGLSL,
            vertexWGSL,
            fragmentWGSL
        });

        this.accumTexture = new Texture(device, {
            name: 'multiframe-texture',
            width: device.width,
            height: device.height,
            format: choosePixelFormat(device),
            mipmaps: false,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR
        });

        this.accumRenderTarget = new RenderTarget({
            name: 'multiframe-target',
            colorBuffer: this.accumTexture,
            depth: false
        });

        // render pass for blending into the accumulation texture
        this.updateRenderPass = new CustomRenderPass(device);
        this.updateRenderPass.init(this.accumRenderTarget, {});
        this.updateRenderPass.shader = this.shader;
        this.updateRenderPass.blendState = accumBlend;
        this.updateRenderPass.events.on('execute', () => {
            const sampleWeight = this.sampleArray[this.sampleId++].z;
            const blend = sampleWeight / (this.sampleAccum + sampleWeight);
            this.sampleAccum += sampleWeight;

            device.setBlendColor(blend, blend, blend, blend);

            resolve(device.scope, {
                texcoordMod: [1, 1, 0, 0],
                multiframeTex: this.sourceTex,
                power: gamma
            });
        });

        // render pass for final blit to backbuffer
        this.finalRenderPass = new CustomRenderPass(device);
        this.finalRenderPass.init(null, {});
        this.finalRenderPass.shader = this.shader;
        this.finalRenderPass.events.on('execute', () => {
            const blending = this.enabled && this.sampleId > 0;
            const source = blending ? this.accumTexture : this.sourceTex;

            if (this.blend !== 1.0) {
                device.setBlendColor(this.blend, this.blend, this.blend, this.blend);
                this.finalRenderPass.blendState = accumBlend;
            } else {
                this.finalRenderPass.blendState = noBlend;
            }

            const upscaling = source.width < device.width || source.height < device.height;

            // Путь вывода один на все состояния. Прежде шейдер выбирался по совпадению
            // размеров, и вместе с ним менялась гамма — за жест переключение случалось дважды
            // и было видно как вспышка. Теперь меняются только значения параметров.

            // we must flip the image upside-down on webgpu
            resolve(device.scope, {
                texcoordMod: !blending && device.isWebGPU ? [1, -1, 0, 1] : [1, 1, 0, 0],
                multiframeTex: source,
                power: blending ? (1.0 / gamma) : 1.0,
                sharpness: this.sharpness,
                // EASU включаем только когда источник и правда мельче экрана: при совпадении
                // размеров растягивать нечего, а двенадцать отсчётов стоили бы впустую.
                easuEnabled: upscaling ? 1 : 0,
                srcSize: [source.width, source.height],
                outputTexel: [1 / Math.max(1, device.width), 1 / Math.max(1, device.height)]
            });
        });

        const handler = () => {
            this.destroy();
        };

        device.once('destroy', handler);
        device.on('devicelost', handler);
    }

    get sourceTex() {
        return this.camera.renderTarget.colorBuffer;
    }

    // set the samples array which contains one Vec3 per multiframe sample
    // each sample contains (x pixel offset, y pixel offset, normalized weight)
    set samples(sampleArray: Vec3[]) {
        this.sampleArray = sampleArray;
        this.textureBias = -Math.log2(Math.sqrt(sampleArray.length));
        this.sampleId = 0;
    }

    get samples() {
        return this.sampleArray;
    }

    // helper function to generate an array of samples for use in multiframe rendering
    // numSamples: square root of number of samples: 5 === 25 total samples
    // jitter: enable sample jittering
    // size: size of the filter, in pixels
    // sigma: guassian sigma filter value or 0 to use box filtering instead
    static generateSamples(numSamples: number, jitter = false, size = 1, sigma = 0): Vec3[] {
        const samples: Vec3[] = [];
        const kernelSize = Math.ceil(3 * sigma) + 1;
        const halfSize = size * 0.5;
        let sx, sy, weight, totalWeight = 0;

        // generate jittered grid samples (poisson would be better)
        for (let x = 0; x < numSamples; ++x) {
            for (let y = 0; y < numSamples; ++y) {
                // generate sx, sy in range -1..1
                if (jitter) {
                    sx = ((x + Math.random()) / numSamples) * 2.0 - 1.0;
                    sy = ((y + Math.random()) / numSamples) * 2.0 - 1.0;
                } else {
                    sx = (x / (numSamples - 1)) * 2.0 - 1.0;
                    sy = (y / (numSamples - 1)) * 2.0 - 1.0;
                }
                // calculate sample weight
                weight = (sigma <= 0.0) ? 1.0 : gauss(sx * kernelSize, sigma) * gauss(sy * kernelSize, sigma);
                totalWeight += weight;
                samples.push(new Vec3(sx * halfSize, sy * halfSize, weight));
            }
        }

        // normalize weights
        samples.forEach((v) => {
            v.z /= totalWeight;
        });

        // closest sample first
        samples.sort((a, b) => {
            const aL = a.length();
            const bL = b.length();
            return aL < bL ? -1 : (bL < aL ? 1 : 0);
        });

        return samples;
    }

    destroy() {
        if (this.accumRenderTarget) {
            this.accumRenderTarget.destroy();
            this.accumRenderTarget = null;
        }

        if (this.accumTexture) {
            this.accumTexture.destroy();
            this.accumTexture = null;
        }
    }

    // flag the camera as moved
    moved() {
        this.sampleId = 0;
        this.sampleAccum = 0;
    }

    // update the multiframe accumulation buffer.
    // blend the camera's render target colour buffer with the multiframe accumulation buffer.
    // writes results to the backbuffer.
    update() {
        if (!this.enabled) {
            this.finalRenderPass.render();
            return false;
        }

        const sampleCnt = this.sampleArray.length;
        const { sourceTex } = this;

        // update accumulation texture
        this.accumRenderTarget.resize(sourceTex.width, sourceTex.height);

        // in disabled state we resolve directly from source to backbuffer
        if (this.enabled && this.sampleId < sampleCnt) {
            this.updateRenderPass.render();
        }

        this.finalRenderPass.render();

        return this.sampleId < sampleCnt;
    }
}

export {
    Multiframe
};
