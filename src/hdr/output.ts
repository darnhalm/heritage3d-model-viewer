import { GraphicsDevice, RenderPassShaderQuad, RenderTarget, SEMANTIC_POSITION, ShaderUtils, Texture } from 'playcanvas';

import { HdrSpatial } from './spatial';

// Linear float scene -> exposure -> luminance-preserving Reinhard (SDR only) -> sRGB encoding.
// Extended sRGB permits values above one; primaries remain sRGB, not Display P3.
type HdrLutShaper = 'linear' | 'acescct' | 'slog3' | 'cineon';

/**
 * Таблица цвета и то, чего о ней не говорит сам файл.
 *
 * `.cube` описывает только сетку и границы входной области. Ни кодирование входа, ни
 * пространство выхода в нём не записаны, а без них таблицу применить некуда: проявочная сетка
 * ждёт логарифмический вход и отдаёт уже экранные значения, то есть сама заменяет тональное
 * преобразование. Поэтому и то и другое приходит снаружи, явно.
 */
type HdrLut = {
    texture: Texture;
    /** Доля подмешивания, 0..1. */
    intensity: number;
    /** `strip` — прежняя восьмибитная полоса PNG; `cube` — проявочная таблица. */
    kind: 'strip' | 'cube';
    /** Как линейное значение кодируется перед обращением к сетке. */
    shaper: HdrLutShaper;
    /** `display` — сетка отдаёт экранные значения и заменяет тональное преобразование. */
    output: 'display' | 'linear';
    domainMin: [number, number, number];
    domainMax: [number, number, number];
};

/** Кодирование входа перед обращением к сетке; порядок совпадает с веткой `shaper` в шейдере. */
const SHAPER_INDEX: Record<HdrLutShaper, number> = { linear: 0, acescct: 1, slog3: 2, cineon: 3 };

export class HdrOutput {
    private pass: RenderPassShaderQuad;

    private spatial: HdrSpatial | null = null;

    constructor(private device: GraphicsDevice) {
        this.pass = new RenderPassShaderQuad(device);
        this.pass.init(null);
        this.pass.shader = ShaderUtils.createShader(device, {
            uniqueName: 'hdr-surface-output',
            attributes: { vertex_position: SEMANTIC_POSITION },
            vertexGLSL: `attribute vec2 vertex_position;
                varying vec2 uv;
                uniform float flip;
                void main() { gl_Position=vec4(vertex_position,0.0,1.0);
                    uv=vertex_position*0.5+0.5; uv.y=mix(uv.y,1.0-uv.y,flip); }`,
            fragmentGLSL: `varying vec2 uv;
                uniform sampler2D source;
                uniform float exposure;
                uniform float extended;
                uniform float encodedSource;
                uniform sampler2D hdrLut;
                uniform float lutSize;
                uniform float lutIntensity;
                uniform float lutMode;
                uniform float lutShaper;
                uniform float lutDisplayOutput;
                uniform vec3 lutDomainMin;
                uniform vec3 lutDomainMax;
                vec3 sampleStrip(vec3 t) {
                    vec3 q=clamp(t,0.0,1.0);
                    float slice=q.b*(lutSize-1.0);
                    vec2 rg=(q.rg*(lutSize-1.0)+0.5)/vec2(lutSize*lutSize,lutSize);
                    vec3 lo=texture2D(hdrLut,rg+vec2(floor(slice)/lutSize,0.0)).rgb;
                    vec3 hi=texture2D(hdrLut,rg+vec2(ceil(slice)/lutSize,0.0)).rgb;
                    return mix(lo,hi,fract(slice));
                }
                vec3 encodeSrgb(vec3 c) {
                    return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));
                }
                vec3 grade(vec3 c) { return encodeSrgb(sampleStrip(c)); }
                vec3 shaper(vec3 c) {
                    vec3 t=c;
                    if (lutShaper>2.5) {
                        vec3 d=max(c,vec3(0.0))*(1.0-0.0107977516232771)+0.0107977516232771;
                        t=(685.0+300.0*log2(d)*0.301029995663981)/1023.0;
                    } else if (lutShaper>1.5) {
                        vec3 lin=(c*(171.2102946929-95.0)/0.01125+95.0)/1023.0;
                        vec3 lg=(420.0+log2(max((c+0.01)/0.19,vec3(1e-10)))*0.301029995663981*261.5)/1023.0;
                        t=mix(lin,lg,step(vec3(0.01125),c));
                    } else if (lutShaper>0.5) {
                        vec3 lin=10.5402377416545*c+0.0729055341958355;
                        vec3 lg=(log2(max(c,vec3(1e-10)))+9.72)/17.52;
                        t=mix(lin,lg,step(vec3(0.0078125),c));
                    }
                    return (t-lutDomainMin)/max(lutDomainMax-lutDomainMin,vec3(1e-6));
                }
                void main() {
                    vec4 pixel=texture2D(source,uv);
                    vec3 raw=max(pixel.rgb,vec3(0.0));
                    if (encodedSource>0.5) raw=max(pow(raw,vec3(2.2))-0.0000001,vec3(0.0));
                    vec3 c=raw*exposure;
                    vec3 scene=c;
                    bool wide=lutMode>1.5&&lutIntensity>0.0;
                    // Таблица с линейным выходом стоит до тонального преобразования: её результат
                    // ещё предстоит сжать в экран.
                    if (wide&&lutDisplayOutput<0.5) c=mix(c,sampleStrip(shaper(c)),lutIntensity);
                    float luminance=dot(c,vec3(0.2126,0.7152,0.0722));
                    if (extended<0.5) {
                        c=c/(1.0+luminance);
                        c=c/max(1.0,max(c.r,max(c.g,c.b)));
                    }
                    c=encodeSrgb(c);
                    // Проявочная таблица сама и есть тональное преобразование, поэтому её выход
                    // подмешивается уже в экранном пространстве, к готовому кадру.
                    if (wide&&lutDisplayOutput>0.5) c=mix(c,sampleStrip(shaper(scene)),lutIntensity);
                    if (lutMode>0.5&&lutMode<1.5&&extended<0.5&&lutIntensity>0.0) c=mix(c,grade(c),lutIntensity);
                    gl_FragColor=vec4(c,pixel.a);
                }`,
            vertexWGSL: `attribute vertex_position: vec2f;
                varying uv: vec2f;
                uniform flip: f32;
                @vertex fn vertexMain(input: VertexInput)->VertexOutput {
                    var output: VertexOutput;
                    output.position=vec4f(input.vertex_position,0.0,1.0);
                    output.uv=input.vertex_position*0.5+0.5;
                    output.uv.y=mix(output.uv.y,1.0-output.uv.y,uniform.flip);
                    return output;
                }`,
            fragmentWGSL: `varying uv: vec2f;
                var source: texture_2d<f32>;
                var sourceSampler: sampler;
                uniform exposure: f32;
                uniform extended: f32;
                uniform encodedSource: f32;
                var hdrLut: texture_2d<f32>;
                var hdrLutSampler: sampler;
                uniform lutSize: f32;
                uniform lutIntensity: f32;
                uniform lutMode: f32;
                uniform lutShaper: f32;
                uniform lutDisplayOutput: f32;
                uniform lutDomainMin: vec3f;
                uniform lutDomainMax: vec3f;
                fn sampleStrip(t: vec3f)->vec3f {
                    let n=uniform.lutSize;
                    let q=clamp(t,vec3f(0.0),vec3f(1.0));
                    let slice=q.b*(n-1.0);
                    let rg=(q.rg*(n-1.0)+0.5)/vec2f(n*n,n);
                    let lo=textureSampleLevel(hdrLut,hdrLutSampler,rg+vec2f(floor(slice)/n,0.0),0.0).rgb;
                    let hi=textureSampleLevel(hdrLut,hdrLutSampler,rg+vec2f(ceil(slice)/n,0.0),0.0).rgb;
                    return mix(lo,hi,vec3f(fract(slice)));
                }
                fn encodeSrgb(c: vec3f)->vec3f {
                    return select(c*12.92,1.055*pow(max(c,vec3f(0.0)),vec3f(1.0/2.4))-0.055,c>=vec3f(0.0031308));
                }
                fn grade(c: vec3f)->vec3f { return encodeSrgb(sampleStrip(c)); }
                fn shaper(c: vec3f)->vec3f {
                    var t=c;
                    if (uniform.lutShaper>2.5) {
                        let d=max(c,vec3f(0.0))*(1.0-0.0107977516232771)+0.0107977516232771;
                        t=(685.0+300.0*log2(d)*0.301029995663981)/1023.0;
                    } else if (uniform.lutShaper>1.5) {
                        let lin=(c*(171.2102946929-95.0)/0.01125+95.0)/1023.0;
                        let lg=(420.0+log2(max((c+0.01)/0.19,vec3f(1e-10)))*0.301029995663981*261.5)/1023.0;
                        t=select(lin,lg,c>=vec3f(0.01125));
                    } else if (uniform.lutShaper>0.5) {
                        let lin=10.5402377416545*c+0.0729055341958355;
                        let lg=(log2(max(c,vec3f(1e-10)))+9.72)/17.52;
                        t=select(lin,lg,c>=vec3f(0.0078125));
                    }
                    return (t-uniform.lutDomainMin)/max(uniform.lutDomainMax-uniform.lutDomainMin,vec3f(1e-6));
                }
                @fragment fn fragmentMain(input: FragmentInput)->FragmentOutput {
                    var output: FragmentOutput;
                    let pixel=textureSample(source,sourceSampler,input.uv);
                    var raw=max(pixel.rgb,vec3f(0.0));
                    if (uniform.encodedSource>0.5) { raw=max(pow(raw,vec3f(2.2))-0.0000001,vec3f(0.0)); }
                    var c=raw*uniform.exposure;
                    let scene=c;
                    let wide=uniform.lutMode>1.5&&uniform.lutIntensity>0.0;
                    if (wide&&uniform.lutDisplayOutput<0.5) { c=mix(c,sampleStrip(shaper(c)),vec3f(uniform.lutIntensity)); }
                    let luminance=dot(c,vec3f(0.2126,0.7152,0.0722));
                    if (uniform.extended<0.5) {
                        c=c/(1.0+luminance);
                        c=c/max(1.0,max(c.r,max(c.g,c.b)));
                    }
                    c=encodeSrgb(c);
                    if (wide&&uniform.lutDisplayOutput>0.5) { c=mix(c,sampleStrip(shaper(scene)),vec3f(uniform.lutIntensity)); }
                    if (uniform.lutMode>0.5&&uniform.lutMode<1.5&&uniform.extended<0.5&&uniform.lutIntensity>0.0) { c=mix(c,grade(c),vec3f(uniform.lutIntensity)); }
                    output.color=vec4f(c,pixel.a);
                    return output;
                }`
        });
    }

    render(source: Texture, ev: number, extended: boolean, target: RenderTarget | null = null, encodedSource = false, lut: HdrLut | null = null, spatial?: { easu: boolean; sharpness: number }) {
        const width = target?.width ?? this.device.width;
        const height = target?.height ?? this.device.height;
        if (spatial && (spatial.sharpness > 0 || (spatial.easu && (source.width < width || source.height < height)))) {
            this.spatial ??= new HdrSpatial(this.device);
            const intermediate = this.spatial.target(0, source.width, source.height);
            this.render(source, ev, extended, intermediate, encodedSource, lut);
            this.spatial.render(intermediate.colorBuffer, target, spatial.easu, spatial.sharpness);
            return;
        }
        if (this.pass.renderTarget !== target) this.pass.init(target);
        const wide = lut?.kind === 'cube';
        // Прежняя восьмибитная полоса стоит после тонального преобразования и в HDR-выводе
        // смысла не имеет — там сжимать нечем, и она гасится. Проявочная таблица сама заменяет
        // тональное преобразование, поэтому в HDR она остаётся включённой.
        const active = lut ? (wide || !extended) : false;
        const scope = this.device.scope;
        scope.resolve('source').setValue(source);
        scope.resolve('encodedSource').setValue(encodedSource ? 1 : 0);
        scope.resolve('hdrLut').setValue(lut?.texture ?? source);
        scope.resolve('lutSize').setValue(lut?.texture.height ?? 2);
        scope.resolve('lutIntensity').setValue(active ? Math.max(0, Math.min(1, lut?.intensity ?? 1)) : 0);
        scope.resolve('lutMode').setValue(active ? (wide ? 2 : 1) : 0);
        scope.resolve('lutShaper').setValue(SHAPER_INDEX[lut?.shaper ?? 'linear']);
        scope.resolve('lutDisplayOutput').setValue(lut?.output === 'linear' ? 0 : 1);
        scope.resolve('lutDomainMin').setValue(lut?.domainMin ?? [0, 0, 0]);
        scope.resolve('lutDomainMax').setValue(lut?.domainMax ?? [1, 1, 1]);
        scope.resolve('exposure').setValue(2 ** Math.max(-16, Math.min(16, Number(ev) || 0)));
        scope.resolve('extended').setValue(extended ? 1 : 0);
        scope.resolve('flip').setValue(this.device.isWebGPU ? 1 : 0);
        this.pass.render();
    }

    destroy() {
        this.spatial?.destroy();
        this.pass.shader.destroy();
        this.pass.destroy();
    }
}

export type { HdrLut, HdrLutShaper };
