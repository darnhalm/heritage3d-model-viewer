import { GraphicsDevice, RenderPassShaderQuad, RenderTarget, SEMANTIC_POSITION, ShaderUtils, Texture } from 'playcanvas';

import { HdrSpatial } from './spatial';

// Linear float scene -> exposure -> luminance-preserving Reinhard (SDR only) -> sRGB encoding.
// Extended sRGB permits values above one; primaries remain sRGB, not Display P3.
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
                vec3 grade(vec3 c) {
                    float slice=clamp(c.b,0.0,1.0)*(lutSize-1.0);
                    vec2 rg=(clamp(c.rg,0.0,1.0)*(lutSize-1.0)+0.5)/vec2(lutSize*lutSize,lutSize);
                    vec3 lo=texture2D(hdrLut,rg+vec2(floor(slice)/lutSize,0.0)).rgb;
                    vec3 hi=texture2D(hdrLut,rg+vec2(ceil(slice)/lutSize,0.0)).rgb;
                    vec3 linear=mix(lo,hi,fract(slice));
                    return mix(linear*12.92,1.055*pow(max(linear,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),linear));
                }
                void main() {
                    vec4 pixel=texture2D(source,uv);
                    vec3 raw=max(pixel.rgb,vec3(0.0));
                    if (encodedSource>0.5) raw=max(pow(raw,vec3(2.2))-0.0000001,vec3(0.0));
                    vec3 c=raw*exposure;
                    float luminance=dot(c,vec3(0.2126,0.7152,0.0722));
                    if (extended<0.5) {
                        c=c/(1.0+luminance);
                        c=c/max(1.0,max(c.r,max(c.g,c.b)));
                    }
                    c=mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));
                    if (extended<0.5 && lutIntensity>0.0) c=mix(c,grade(c),lutIntensity);
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
                fn grade(c: vec3f)->vec3f {
                    let n=uniform.lutSize;
                    let slice=clamp(c.b,0.0,1.0)*(n-1.0);
                    let rg=(clamp(c.rg,vec2f(0.0),vec2f(1.0))*(n-1.0)+0.5)/vec2f(n*n,n);
                    let lo=textureSampleLevel(hdrLut,hdrLutSampler,rg+vec2f(floor(slice)/n,0.0),0.0).rgb;
                    let hi=textureSampleLevel(hdrLut,hdrLutSampler,rg+vec2f(ceil(slice)/n,0.0),0.0).rgb;
                    let linear=mix(lo,hi,fract(slice));
                    return select(linear*12.92,1.055*pow(max(linear,vec3f(0.0)),vec3f(1.0/2.4))-0.055,linear>=vec3f(0.0031308));
                }
                @fragment fn fragmentMain(input: FragmentInput)->FragmentOutput {
                    var output: FragmentOutput;
                    let pixel=textureSample(source,sourceSampler,input.uv);
                    var raw=max(pixel.rgb,vec3f(0.0));
                    if (uniform.encodedSource>0.5) { raw=max(pow(raw,vec3f(2.2))-0.0000001,vec3f(0.0)); }
                    var c=raw*uniform.exposure;
                    let luminance=dot(c,vec3f(0.2126,0.7152,0.0722));
                    if (uniform.extended<0.5) {
                        c=c/(1.0+luminance);
                        c=c/max(1.0,max(c.r,max(c.g,c.b)));
                    }
                    c=select(c*12.92,1.055*pow(c,vec3f(1.0/2.4))-0.055,c>=vec3f(0.0031308));
                    if (uniform.extended<0.5 && uniform.lutIntensity>0.0) { c=mix(c,grade(c),uniform.lutIntensity); }
                    output.color=vec4f(c,pixel.a);
                    return output;
                }`
        });
    }

    render(source: Texture, ev: number, extended: boolean, target: RenderTarget | null = null, encodedSource = false, lut: Texture | null = null, intensity = 1, spatial?: { easu: boolean; sharpness: number }) {
        const width = target?.width ?? this.device.width;
        const height = target?.height ?? this.device.height;
        if (spatial && (spatial.sharpness > 0 || (spatial.easu && (source.width < width || source.height < height)))) {
            this.spatial ??= new HdrSpatial(this.device);
            const intermediate = this.spatial.target(0, source.width, source.height);
            this.render(source, ev, extended, intermediate, encodedSource, lut, intensity);
            this.spatial.render(intermediate.colorBuffer, target, spatial.easu, spatial.sharpness);
            return;
        }
        if (this.pass.renderTarget !== target) this.pass.init(target);
        const scope = this.device.scope;
        scope.resolve('source').setValue(source);
        scope.resolve('encodedSource').setValue(encodedSource ? 1 : 0);
        scope.resolve('hdrLut').setValue(lut ?? source);
        scope.resolve('lutSize').setValue(lut?.height ?? 2);
        scope.resolve('lutIntensity').setValue(lut && !extended ? Math.max(0, Math.min(1, intensity ?? 1)) : 0);
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
