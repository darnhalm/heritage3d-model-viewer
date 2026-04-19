import {
    PostEffect,
    GraphicsDevice,
    ShaderUtils,
    SEMANTIC_POSITION,
    Texture,
    PIXELFORMAT_RGBA8,
    FILTER_LINEAR,
    ADDRESS_CLAMP_TO_EDGE,
    RenderTarget
} from 'playcanvas';

const SAMPLE_COUNT = 15;

function computeGaussian(n: number, theta: number) {
    return ((1.0 / Math.sqrt(2 * Math.PI * theta)) * Math.exp(-(n * n) / (2 * theta * theta)));
}

function calculateBlurValues(sampleWeights: Float32Array, sampleOffsets: Float32Array, dx: number, dy: number, blurAmount: number) {
    sampleWeights[0] = computeGaussian(0, blurAmount);
    sampleOffsets[0] = 0;
    sampleOffsets[1] = 0;

    let totalWeights = sampleWeights[0];

    for (let i = 0, len = Math.floor(SAMPLE_COUNT / 2); i < len; i++) {
        const weight = computeGaussian(i + 1, blurAmount);
        sampleWeights[i * 2] = weight;
        sampleWeights[i * 2 + 1] = weight;
        totalWeights += weight * 2;

        const sampleOffset = i * 2 + 1.5;
        sampleOffsets[i * 4] = dx * sampleOffset;
        sampleOffsets[i * 4 + 1] = dy * sampleOffset;
        sampleOffsets[i * 4 + 2] = -dx * sampleOffset;
        sampleOffsets[i * 4 + 3] = -dy * sampleOffset;
    }

    for (let i = 0, len = sampleWeights.length; i < len; i++) {
        sampleWeights[i] /= totalWeights;
    }
}

export class BloomEffect extends PostEffect {
    bloomThreshold = 0.25;
    blurAmount = 4;
    bloomIntensity = 1.25;

    extractShader: any;
    blurShader: any;
    combineShader: any;
    targets: RenderTarget[] = [];
    sampleWeights = new Float32Array(SAMPLE_COUNT);
    sampleOffsets = new Float32Array(SAMPLE_COUNT * 2);
    width = 0;
    height = 0;

    constructor(graphicsDevice: GraphicsDevice) {
        super(graphicsDevice);

        const attributes = {
            aPosition: SEMANTIC_POSITION
        };

        const extractFrag = `
            varying vec2 vUv0;
            uniform sampler2D uBaseTexture;
            uniform float uBloomThreshold;
            void main(void) {
                vec4 color = texture2D(uBaseTexture, vUv0);
                gl_FragColor = clamp((color - uBloomThreshold) / (1.0 - uBloomThreshold), 0.0, 1.0);
            }
        `;

        const gaussianBlurFrag = `
            #define SAMPLE_COUNT ${SAMPLE_COUNT}
            varying vec2 vUv0;
            uniform sampler2D uBloomTexture;
            uniform vec2 uBlurOffsets[${SAMPLE_COUNT}];
            uniform float uBlurWeights[${SAMPLE_COUNT}];
            void main(void) {
                vec4 color = vec4(0.0);
                for (int i = 0; i < SAMPLE_COUNT; i++) {
                    color += texture2D(uBloomTexture, vUv0 + uBlurOffsets[i]) * uBlurWeights[i];
                }
                gl_FragColor = color;
            }
        `;

        const combineFrag = `
            varying vec2 vUv0;
            uniform float uBloomEffectIntensity;
            uniform sampler2D uBaseTexture;
            uniform sampler2D uBloomTexture;
            void main(void) {
                vec4 bloom = texture2D(uBloomTexture, vUv0) * uBloomEffectIntensity;
                vec4 base = texture2D(uBaseTexture, vUv0);
                base *= (1.0 - clamp(bloom, 0.0, 1.0));
                gl_FragColor = base + bloom;
            }
        `;

        this.extractShader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'BloomExtractShader',
            attributes: attributes,
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: extractFrag
        });

        this.blurShader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'BloomBlurShader',
            attributes: attributes,
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: gaussianBlurFrag
        });

        this.combineShader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'BloomCombineShader',
            attributes: attributes,
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: combineFrag
        });
    }

    _destroy() {
        if (this.targets) {
            for (let i = 0; i < this.targets.length; i++) {
                this.targets[i].destroyTextureBuffers();
                this.targets[i].destroy();
            }
        }
        this.targets.length = 0;
    }

    _resize(target: RenderTarget) {
        const width = target.colorBuffer!.width;
        const height = target.colorBuffer!.height;

        if (width === this.width && height === this.height) {
            return;
        }

        this.width = width;
        this.height = height;

        this._destroy();

        for (let i = 0; i < 2; i++) {
            const colorBuffer = new Texture(this.device, {
                name: `Bloom Texture${i}`,
                format: PIXELFORMAT_RGBA8,
                width: width >> 1,
                height: height >> 1,
                mipmaps: false
            });
            colorBuffer.minFilter = FILTER_LINEAR;
            colorBuffer.magFilter = FILTER_LINEAR;
            colorBuffer.addressU = ADDRESS_CLAMP_TO_EDGE;
            colorBuffer.addressV = ADDRESS_CLAMP_TO_EDGE;
            
            const bloomTarget = new RenderTarget({
                name: `Bloom Render Target ${i}`,
                colorBuffer: colorBuffer,
                depth: false
            });

            this.targets.push(bloomTarget);
        }
    }

    render(inputTarget: RenderTarget, outputTarget: RenderTarget, rect: any) {
        this._resize(inputTarget);

        const device = this.device;
        const scope = device.scope;

        scope.resolve('uBloomThreshold').setValue(this.bloomThreshold);
        scope.resolve('uBaseTexture').setValue(inputTarget.colorBuffer);
        this.drawQuad(this.targets[0], this.extractShader);

        calculateBlurValues(this.sampleWeights, this.sampleOffsets, 1.0 / this.targets[1].width, 0, this.blurAmount);
        scope.resolve('uBlurWeights[0]').setValue(this.sampleWeights);
        scope.resolve('uBlurOffsets[0]').setValue(this.sampleOffsets);
        scope.resolve('uBloomTexture').setValue(this.targets[0].colorBuffer);
        this.drawQuad(this.targets[1], this.blurShader);

        calculateBlurValues(this.sampleWeights, this.sampleOffsets, 0, 1.0 / this.targets[0].height, this.blurAmount);
        scope.resolve('uBlurWeights[0]').setValue(this.sampleWeights);
        scope.resolve('uBlurOffsets[0]').setValue(this.sampleOffsets);
        scope.resolve('uBloomTexture').setValue(this.targets[1].colorBuffer);
        this.drawQuad(this.targets[0], this.blurShader);

        scope.resolve('uBloomEffectIntensity').setValue(this.bloomIntensity);
        scope.resolve('uBloomTexture').setValue(this.targets[0].colorBuffer);
        scope.resolve('uBaseTexture').setValue(inputTarget.colorBuffer);
        this.drawQuad(outputTarget, this.combineShader, rect);
    }
}
