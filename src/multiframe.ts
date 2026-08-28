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
    void main(void) {
        vec4 t = texture2D(multiframeTex, texcoord);
        gl_FragColor = pow(t, vec4(power));
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
const fragmentUpscaleGLSL = `
    varying vec2 texcoord;
    uniform sampler2D multiframeTex;
    uniform float power;
    uniform float sharpness;
    uniform vec2 outputTexel;

    vec3 tap(vec2 uv) {
        return pow(texture2D(multiframeTex, uv).rgb, vec3(power));
    }

    void main(void) {
        vec4 centerTexel = texture2D(multiframeTex, texcoord);
        vec3 c = pow(centerTexel.rgb, vec3(power));
        vec3 n = tap(texcoord + vec2(0.0, -outputTexel.y));
        vec3 s = tap(texcoord + vec2(0.0, outputTexel.y));
        vec3 w = tap(texcoord + vec2(-outputTexel.x, 0.0));
        vec3 e = tap(texcoord + vec2(outputTexel.x, 0.0));

        vec3 mn = min(c, min(min(n, s), min(w, e)));
        vec3 mx = max(c, max(max(n, s), max(w, e)));

        vec3 headroom = min(mn, vec3(1.0) - mx) / max(mx, vec3(1e-4));
        float room = clamp(min(min(headroom.r, headroom.g), headroom.b), 0.0, 1.0);
        float amount = -sharpness * sqrt(room);

        vec3 color = (c + amount * (n + s + w + e)) / (1.0 + 4.0 * amount);
        gl_FragColor = vec4(clamp(color, mn, mx), pow(centerTexel.a, power));
    }
`;

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

    @fragment
    fn fragmentMain(input: FragmentInput) -> FragmentOutput {
        var output: FragmentOutput;

        let t: vec4f = textureSample(multiframeTex, multiframeSampler, input.texcoord);
        output.color = pow(t, vec4f(uniform.power));

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

const fragmentUpscaleWGSL = /* wgsl */`
    varying texcoord: vec2f;

    var multiframeTex: texture_2d<f32>;
    var multiframeSampler: sampler;

    uniform outputTexel: vec2f;
    uniform power: f32;
    uniform sharpness: f32;

    fn tap(uv: vec2f) -> vec3f {
        let t: vec4f = textureSample(multiframeTex, multiframeSampler, uv);
        return pow(t.rgb, vec3f(uniform.power));
    }

    @fragment
    fn fragmentMain(input: FragmentInput) -> FragmentOutput {
        var output: FragmentOutput;

        let centerTexel: vec4f = textureSample(multiframeTex, multiframeSampler, input.texcoord);
        let c: vec3f = pow(centerTexel.rgb, vec3f(uniform.power));
        let n: vec3f = tap(input.texcoord + vec2f(0.0, -uniform.outputTexel.y));
        let s: vec3f = tap(input.texcoord + vec2f(0.0, uniform.outputTexel.y));
        let w: vec3f = tap(input.texcoord + vec2f(-uniform.outputTexel.x, 0.0));
        let e: vec3f = tap(input.texcoord + vec2f(uniform.outputTexel.x, 0.0));

        let mn: vec3f = min(c, min(min(n, s), min(w, e)));
        let mx: vec3f = max(c, max(max(n, s), max(w, e)));

        let headroom: vec3f = min(mn, vec3f(1.0) - mx) / max(mx, vec3f(1e-4));
        let room: f32 = clamp(min(min(headroom.r, headroom.g), headroom.b), 0.0, 1.0);
        let amount: f32 = -uniform.sharpness * sqrt(room);

        let color: vec3f = (c + amount * (n + s + w + e)) / (1.0 + 4.0 * amount);
        output.color = vec4f(clamp(color, mn, mx), pow(centerTexel.a, uniform.power));

        return output;
    }
`;

/**
 * Сила резкости при растяжке.
 *
 * Знаменатель ядра равен `1 + 4w`, поэтому при w меньше -0.25 он обращается в ноль и картинка
 * разваливается. 0.12 оставляет запас и на глаз возвращает примерно ту чёткость, которую
 * съела билинейная выборка, не доводя до звона.
 */
const UPSCALE_SHARPNESS = 0.12;

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
    upscaleShader: Shader = null;

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
                resolve(device.scope, {
                    textureBias: this.sampleId === 0 ? 0.0 : this.textureBias
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

        // Накопитель живёт в разрешении сцены, а финальный проход тянет его на бэкбуфер,
        // который может быть крупнее (`camera.pixelScale`). Поэтому фильтрация линейная: в
        // накопление она не вмешивается — там выборка идёт один в один, — а растяжку до
        // экрана делает гладкой вместо лесенки.
        this.upscaleShader = ShaderUtils.createShader(device, {
            uniqueName: 'multiframe-upscale-shader',
            attributes: {
                vertex_position: SEMANTIC_POSITION
            },
            vertexGLSL,
            fragmentGLSL: fragmentUpscaleGLSL,
            vertexWGSL,
            fragmentWGSL: fragmentUpscaleWGSL
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

            // Растягиваем, только если цель сцены и правда мельче бэкбуфера. При совпадении
            // размеров выборка попадает в центры текселей, и резкость нечего возвращать —
            // там работает обычная копия, без лишних четырёх выборок на пиксель.
            const upscaling = source.width !== device.width || source.height !== device.height;
            this.finalRenderPass.shader = upscaling ? this.upscaleShader : this.shader;

            // we must flip the image upside-down on webgpu
            resolve(device.scope, {
                texcoordMod: !blending && device.isWebGPU ? [1, -1, 0, 1] : [1, 1, 0, 0],
                multiframeTex: source,
                power: blending ? (1.0 / gamma) : 1.0,
                sharpness: UPSCALE_SHARPNESS,
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
