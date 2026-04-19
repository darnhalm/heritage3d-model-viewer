import * as pc from 'playcanvas';

/**
 * @class
 * @name BlendEffect
 * @classdesc Blends the input render target with another texture.
 * @description Creates new instance of the post effect.
 * @augments pc.PostEffect
 * @param {pc.GraphicsDevice} graphicsDevice - The graphics device of the application.
 * @property {pc.Texture} blendMap The texture with which to blend the input render target with.
 * @property {number} mixRatio The amount of blending between the input and the blendMap. Ranges from 0 to 1.
 */
export class BlendEffect extends pc.PostEffect {
    shader: pc.Shader | null = null;
    mixRatio: number = 0.5;
    blendMap: pc.Texture | null = null;

    constructor(graphicsDevice: pc.GraphicsDevice) {
        super(graphicsDevice);

        const fshader = `
            uniform float uMixRatio;
            uniform sampler2D uColorBuffer;
            uniform sampler2D uBlendMap;
            
            varying vec2 vUv0;
            
            void main(void)
            {
                vec4 texel1 = texture2D(uColorBuffer, vUv0);
                vec4 texel2 = texture2D(uBlendMap, vUv0);
                gl_FragColor = mix(texel1, texel2, uMixRatio);
            }
        `;

        this.shader = pc.ShaderUtils.createShader(graphicsDevice, {
            uniqueName: 'BlendShader',
            attributes: { aPosition: pc.SEMANTIC_POSITION },
            vertexGLSL: (pc as any).PostEffect.quadVertexShader,
            fragmentGLSL: fshader
        });

        this.blendMap = new pc.Texture(graphicsDevice, {
            name: 'pe-blend',
            width: 1,
            height: 1
        });
    }

    render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget, rect: pc.Vec4) {
        const device = this.device;
        const scope = device.scope;

        scope.resolve('uMixRatio').setValue(this.mixRatio);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        scope.resolve('uBlendMap').setValue(this.blendMap);
        if (this.shader) {
            this.drawQuad(outputTarget, this.shader, rect);
        }
    }
}
