import * as pc from 'playcanvas';

/**
 * @class
 * @name LuminosityEffect
 * @classdesc Outputs the luminosity of the input render target.
 * @description Creates new instance of the post effect.
 * @augments pc.PostEffect
 * @param {pc.GraphicsDevice} graphicsDevice - The graphics device of the application.
 */
export class LuminosityEffect extends pc.PostEffect {
    shader: pc.Shader | null = null;

    constructor(graphicsDevice: pc.GraphicsDevice) {
        super(graphicsDevice);

        const fshader = `
            uniform sampler2D uColorBuffer;
            
            varying vec2 vUv0;
            
            void main() {
                vec4 texel = texture2D(uColorBuffer, vUv0);
                vec3 luma = vec3(0.299, 0.587, 0.114);
                float v = dot(texel.xyz, luma);
                gl_FragColor = vec4(v, v, v, texel.w);
            }
        `;

        this.shader = pc.ShaderUtils.createShader(graphicsDevice, {
            uniqueName: 'LuminosityShader',
            attributes: { aPosition: pc.SEMANTIC_POSITION },
            vertexGLSL: (pc as any).PostEffect.quadVertexShader,
            fragmentGLSL: fshader
        });
    }

    render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget, rect: pc.Vec4) {
        const device = this.device;
        const scope = device.scope;

        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        if (this.shader) {
            this.drawQuad(outputTarget, this.shader, rect);
        }
    }
}
