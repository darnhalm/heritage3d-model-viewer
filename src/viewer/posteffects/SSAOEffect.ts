import {
    PostEffect,
    GraphicsDevice,
    ShaderUtils,
    SEMANTIC_POSITION,
    Texture,
    PIXELFORMAT_RGBA8,
    FILTER_LINEAR,
    ADDRESS_CLAMP_TO_EDGE,
    RenderTarget,
    ShaderChunks,
    SHADERLANGUAGE_GLSL
} from 'playcanvas';

export class SSAOEffect extends PostEffect {
    radius = 4;
    brightness = 0;
    samples = 20;
    downscale = 1.0;
    
    ssaoShader: any;
    blurShader: any;
    outputShader: any;
    target: RenderTarget | null = null;
    blurTarget: RenderTarget | null = null;
    width = 0;
    height = 0;
    
    // We need camera far clip for the shader
    cameraFarClip = 1000;

    constructor(graphicsDevice: GraphicsDevice) {
        super(graphicsDevice);
        this.needsDepthBuffer = true;

        const screenDepthPS = (ShaderChunks as any).get(graphicsDevice, SHADERLANGUAGE_GLSL).get('screenDepthPS');

        const fSsao = `
            ${screenDepthPS}
            varying vec2 vUv0;
            uniform vec4 uResolution;
            uniform float uAspect;
            #define saturate(x) clamp(x,0.0,1.0)
            const float kLog2LodRate = 3.0;
            uniform float uInvFarPlane;

            float random(const highp vec2 w) {
                const vec3 m = vec3(0.06711056, 0.00583715, 52.9829189);
                return fract(m.z * fract(dot(w, m.xy)));
            }

            highp vec2 getFragCoord() {
                return gl_FragCoord.xy;
            }

            highp vec3 computeViewSpacePositionFromDepth(highp vec2 uv, highp float linearDepth) {
                return vec3((0.5 - uv) * vec2(uAspect, 1.0) * linearDepth, linearDepth);
            }

            highp vec3 faceNormal(highp vec3 dpdx, highp vec3 dpdy) {
                return normalize(cross(dpdx, dpdy));
            }

            highp vec3 computeViewSpaceNormal(const highp vec3 position, const highp vec2 uv) {
                highp vec2 uvdx = uv + vec2(uResolution.z, 0.0);
                highp vec2 uvdy = uv + vec2(0.0, uResolution.w);
                highp vec3 px = computeViewSpacePositionFromDepth(uvdx, -getLinearScreenDepth(uvdx));
                highp vec3 py = computeViewSpacePositionFromDepth(uvdy, -getLinearScreenDepth(uvdy));
                highp vec3 dpdx = px - position;
                highp vec3 dpdy = py - position;
                return faceNormal(dpdx, dpdy);
            }

            uniform vec2 uSampleCount;
            uniform float uSpiralTurns;
            #define PI (3.14159)

            vec2 startPosition(const float noise) {
                float angle = ((2.0 * PI) * 2.4) * noise;
                return vec2(cos(angle), sin(angle));
            }

            uniform vec2 uAngleIncCosSin;
            highp mat2 tapAngleStep() {
                highp vec2 t = uAngleIncCosSin;
                return mat2(t.x, t.y, -t.y, t.x);
            }

            vec3 tapLocationFast(float i, vec2 p, const float noise) {
                float radius = (i + noise + 0.5) * uSampleCount.y;
                return vec3(p, radius * radius);
            }

            uniform float uMaxLevel;
            uniform float uInvRadiusSquared;
            uniform float uMinHorizonAngleSineSquared;
            uniform float uBias;
            uniform float uPeak2;

            void computeAmbientOcclusionSAO(inout float occlusion, float i, float ssDiskRadius,
                    const highp vec2 uv,  const highp vec3 origin, const vec3 normal,
                    const vec2 tapPosition, const float noise) {
                vec3 tap = tapLocationFast(i, tapPosition, noise);
                float ssRadius = max(1.0, tap.z * ssDiskRadius);
                vec2 uvSamplePos = uv + vec2(ssRadius * tap.xy) * uResolution.zw;
                float level = clamp(floor(log2(ssRadius)) - kLog2LodRate, 0.0, float(uMaxLevel));
                highp float occlusionDepth = -getLinearScreenDepth(uvSamplePos);
                highp vec3 p = computeViewSpacePositionFromDepth(uvSamplePos, occlusionDepth);
                vec3 v = p - origin;
                float vv = dot(v, v);
                float vn = dot(v, normal);
                float w = max(0.0, 1.0 - vv * uInvRadiusSquared);
                w = w*w;
                w *= step(vv * uMinHorizonAngleSineSquared, vn * vn);
                occlusion += w * max(0.0, vn + origin.z * uBias) / (vv + uPeak2);
            }

            uniform float uProjectionScaleRadius;
            uniform float uIntensity;

            float scalableAmbientObscurance(highp vec2 uv, highp vec3 origin, vec3 normal) {
                float noise = random(getFragCoord());
                highp vec2 tapPosition = startPosition(noise);
                highp mat2 angleStep = tapAngleStep();
                float ssDiskRadius = -(uProjectionScaleRadius / origin.z);
                float occlusion = 0.0;
                for (float i = 0.0; i < uSampleCount.x; i += 1.0) {
                    computeAmbientOcclusionSAO(occlusion, i, ssDiskRadius, uv, origin, normal, tapPosition, noise);
                    tapPosition = angleStep * tapPosition;
                }
                return sqrt(occlusion * uIntensity);
            }

            uniform float uPower;

            void main() {
                highp vec2 uv = vUv0;
                highp float depth = -getLinearScreenDepth(vUv0);
                highp vec3 origin = computeViewSpacePositionFromDepth(uv, depth);
                vec3 normal = computeViewSpaceNormal(origin, uv);
                float occlusion = 0.0;
                if (uIntensity > 0.0) {
                    occlusion = scalableAmbientObscurance(uv, origin, normal);
                }
                float aoVisibility = pow(saturate(1.0 - occlusion), uPower);
                gl_FragColor.r = aoVisibility;
            }
        `;

        const fblur = `
            ${screenDepthPS}
            varying vec2 vUv0;
            uniform sampler2D uSSAOBuffer;
            uniform vec4 uResolution;
            uniform float uAspect;
            uniform int uBilatSampleCount;
            uniform float uFarPlaneOverEdgeDistance;
            uniform float uBrightness;

            float bilateralWeight(in float depth, in float sampleDepth) {
                float diff = (sampleDepth - depth) * uFarPlaneOverEdgeDistance;
                return max(0.0, 1.0 - diff * diff);
            }

            void tap(inout float sum, inout float totalWeight, float weight, float depth, vec2 position) {
                float ssao = texture2D( uSSAOBuffer, position ).r;
                float tdepth = -getLinearScreenDepth( position );
                float bilateral = bilateralWeight(depth, tdepth);
                bilateral *= weight;
                sum += ssao * bilateral;
                totalWeight += bilateral;
            }

            void main() {
                highp vec2 uv = vUv0;
                float depth = -getLinearScreenDepth(vUv0);
                float totalWeight = 0.0;
                float ssao = texture2D( uSSAOBuffer, vUv0 ).r;
                float sum = ssao * totalWeight;

                for (int x = -4; x <= 4; x++) {
                    for (int y = -4; y < 4; y++) {
                        float weight = 1.0;
                        vec2 offset = vec2(x,y)*uResolution.zw;
                        tap(sum, totalWeight, weight, depth, uv + offset);
                    }
                }
                float ao = sum / totalWeight;
                ao = mix(ao, 1.0, uBrightness);
                gl_FragColor.a = ao;
            }
        `;

        const foutput = `
            varying vec2 vUv0;
            uniform sampler2D uColorBuffer;
            uniform sampler2D uSSAOBuffer;
            void main(void) {
                vec4 inCol = texture2D( uColorBuffer, vUv0 );
                float ssao = texture2D( uSSAOBuffer, vUv0 ).a;
                gl_FragColor.rgb = inCol.rgb * ssao;
                gl_FragColor.a = inCol.a;
            }
        `;

        const attributes = {
            aPosition: SEMANTIC_POSITION
        };

        this.ssaoShader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'SsaoShader',
            attributes: attributes,
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: fSsao
        });

        this.blurShader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'SsaoBlurShader',
            attributes: attributes,
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: fblur
        });

        this.outputShader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'SsaoOutputShader',
            attributes: attributes,
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: foutput
        });
    }

    _destroy() {
        if (this.target) {
            this.target.destroyTextureBuffers();
            this.target.destroy();
            this.target = null;
        }
        if (this.blurTarget) {
            this.blurTarget.destroyTextureBuffers();
            this.blurTarget.destroy();
            this.blurTarget = null;
        }
    }

    _resize(target: RenderTarget) {
        const width = Math.ceil(target.colorBuffer!.width / this.downscale);
        const height = Math.ceil(target.colorBuffer!.height / this.downscale);

        if (width === this.width && height === this.height) {
            return;
        }

        this.width = width;
        this.height = height;
        this._destroy();

        const ssaoResultBuffer = new Texture(this.device, {
            format: PIXELFORMAT_RGBA8,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            width: this.width,
            height: this.height,
            mipmaps: false
        });
        this.target = new RenderTarget({
            name: 'SSAO Result Render Target',
            colorBuffer: ssaoResultBuffer,
            depth: false
        });

        const ssaoBlurBuffer = new Texture(this.device, {
            format: PIXELFORMAT_RGBA8,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            width: this.width,
            height: this.height,
            mipmaps: false
        });
        this.blurTarget = new RenderTarget({
            name: 'SSAO Blur Render Target',
            colorBuffer: ssaoBlurBuffer,
            depth: false
        });
    }

    render(inputTarget: RenderTarget, outputTarget: RenderTarget, rect: any) {
        this._resize(inputTarget);

        const device = this.device;
        const scope = device.scope;

        const sampleCount = this.samples;
        const spiralTurns = 10.0;
        const step = (1.0 / (sampleCount - 0.5)) * spiralTurns * 2.0 * 3.141;

        const radius = this.radius;
        const bias = 0.001;
        const peak = 0.1 * radius;
        const intensity = (peak * 2.0 * 3.141) * 0.125;
        const projectionScale = 0.5 * device.height;

        scope.resolve('uAspect').setValue(this.width / this.height);
        scope.resolve('uResolution').setValue([this.width, this.height, 1.0 / this.width, 1.0 / this.height]);
        scope.resolve('uBrightness').setValue(this.brightness);
        scope.resolve('uInvFarPlane').setValue(1.0 / this.cameraFarClip);
        scope.resolve('uSampleCount').setValue([sampleCount, 1.0 / sampleCount]);
        scope.resolve('uSpiralTurns').setValue(spiralTurns);
        scope.resolve('uAngleIncCosSin').setValue([Math.cos(step), Math.sin(step)]);
        scope.resolve('uMaxLevel').setValue(0.0);
        scope.resolve('uInvRadiusSquared').setValue(1.0 / (radius * radius));
        scope.resolve('uMinHorizonAngleSineSquared').setValue(0.0);
        scope.resolve('uBias').setValue(bias);
        scope.resolve('uPeak2').setValue(peak * peak);
        scope.resolve('uIntensity').setValue(intensity);
        scope.resolve('uPower').setValue(1.0);
        scope.resolve('uProjectionScaleRadius').setValue(projectionScale * radius);

        this.drawQuad(this.target!, this.ssaoShader, rect);

        scope.resolve('uSSAOBuffer').setValue(this.target!.colorBuffer);
        scope.resolve('uFarPlaneOverEdgeDistance').setValue(1);
        scope.resolve('uBilatSampleCount').setValue(4);

        this.drawQuad(this.blurTarget!, this.blurShader, rect);

        scope.resolve('uSSAOBuffer').setValue(this.blurTarget!.colorBuffer);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        this.drawQuad(outputTarget, this.outputShader, rect);
    }
}
