import {
    GraphicsDevice,
    PostEffect,
    SEMANTIC_POSITION,
    ShaderUtils,
    Texture
} from 'playcanvas';

/**
 * 3D LUT (2D texture layout) or 1D LUT (1×N strip, per-channel curve).
 */
export class LutEffect extends PostEffect {
    shader3d: ReturnType<typeof ShaderUtils.createShader>;

    shader1d: ReturnType<typeof ShaderUtils.createShader>;

    /** Linear blend: 0 = off, 1 = full LUT */
    intensity = 1;

    lutTexture: Texture | null = null;

    /** 3D: cube edge length; 1D: number of samples */
    lutSize = 0;

    /** When true, {@link lutTexture} is 1D (W×1); otherwise 3D packed 2D */
    lutIs1D = false;

    lutDomainMin: [number, number, number] = [0, 0, 0];

    lutDomainMax: [number, number, number] = [1, 1, 1];

    /** 1D only: reconstructed output range from normalized texture */
    lutOutputMin = 0;

    lutOutputMax = 1;

    constructor(graphicsDevice: GraphicsDevice) {
        super(graphicsDevice);

        const fragment3d = `
            uniform sampler2D uColorBuffer;
            uniform sampler2D uLUT;
            uniform float uLUTSize;
            uniform float uIntensity;

            varying vec2 vUv0;

            vec3 applyLut(vec3 color) {
                float size = uLUTSize;
                float x = color.r * (size - 1.0);
                float y = color.g * (size - 1.0);
                float z = color.b * (size - 1.0);
                float zSlice = floor(z);
                float zOffset = fract(z);
                vec2 uv0 = vec2((x + zSlice * size + 0.5) / (size * size), (y + 0.5) / size);
                vec2 uv1 = vec2((x + (zSlice + 1.0) * size + 0.5) / (size * size), (y + 0.5) / size);
                vec3 c0 = texture2D(uLUT, uv0).rgb;
                vec3 c1 = texture2D(uLUT, uv1).rgb;
                return mix(c0, c1, zOffset);
            }

            void main() {
                vec4 col = texture2D(uColorBuffer, vUv0);
                vec3 lutCol = applyLut(col.rgb);
                col.rgb = mix(col.rgb, lutCol, uIntensity);
                gl_FragColor = col;
            }
        `;

        const fragment1d = `
            uniform sampler2D uColorBuffer;
            uniform sampler2D uLUT;
            uniform float uLUTSize;
            uniform float uIntensity;
            uniform vec3 uDomainMin;
            uniform vec3 uDomainMax;
            uniform float uLUTOutMin;
            uniform float uLUTOutMax;

            varying vec2 vUv0;

            float sample1D(float t) {
                float u = clamp(t, 0.0, 1.0) * (uLUTSize - 1.0);
                float u0 = floor(u);
                float u1 = min(u0 + 1.0, uLUTSize - 1.0);
                float f = fract(u);
                float n0 = texture2D(uLUT, vec2((u0 + 0.5) / uLUTSize, 0.5)).r;
                float n1 = texture2D(uLUT, vec2((u1 + 0.5) / uLUTSize, 0.5)).r;
                float n = mix(n0, n1, f);
                return mix(uLUTOutMin, uLUTOutMax, n);
            }

            void main() {
                vec4 col = texture2D(uColorBuffer, vUv0);
                vec3 safe = max(uDomainMax - uDomainMin, vec3(1e-8));
                vec3 t = (col.rgb - uDomainMin) / safe;
                t = clamp(t, 0.0, 1.0);
                vec3 lutCol = vec3(sample1D(t.r), sample1D(t.g), sample1D(t.b));
                col.rgb = mix(col.rgb, lutCol, uIntensity);
                gl_FragColor = col;
            }
        `;

        this.shader3d = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'LutShader3d',
            attributes: { aPosition: SEMANTIC_POSITION },
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: fragment3d
        });

        this.shader1d = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'LutShader1d',
            attributes: { aPosition: SEMANTIC_POSITION },
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: fragment1d
        });
    }

    render(inputTarget: any, outputTarget: any, rect: any) {
        if (!this.lutTexture || this.lutSize < 2) {
            return;
        }
        const device = this.device;
        const scope = device.scope;
        scope.resolve('uIntensity').setValue(this.intensity);
        scope.resolve('uLUTSize').setValue(this.lutSize);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        scope.resolve('uLUT').setValue(this.lutTexture);

        if (this.lutIs1D) {
            scope.resolve('uDomainMin').setValue(this.lutDomainMin);
            scope.resolve('uDomainMax').setValue(this.lutDomainMax);
            scope.resolve('uLUTOutMin').setValue(this.lutOutputMin);
            scope.resolve('uLUTOutMax').setValue(this.lutOutputMax);
            this.drawQuad(outputTarget, this.shader1d, rect);
        } else {
            this.drawQuad(outputTarget, this.shader3d, rect);
        }
    }
}
