import * as pc from 'playcanvas';

/**
 * @class
 * @name HorizontalTiltShiftEffect
 * @classdesc Simple fake tilt-shift effect, modulating two pass Gaussian blur by horizontal position.
 * @description Creates new instance of the post effect.
 * @augments pc.PostEffect
 * @param {pc.GraphicsDevice} graphicsDevice - The graphics device of the application.
 * @property {number} focus Controls where the "focused" vertical line lies.
 */
export class HorizontalTiltShiftEffect extends pc.PostEffect {
    shader: pc.Shader | null = null;
    focus: number = 0.35;

    constructor(graphicsDevice: pc.GraphicsDevice) {
        super(graphicsDevice);

        const fshader = `
            uniform sampler2D uColorBuffer;
            uniform float uH;
            uniform float uR;
            
            varying vec2 vUv0;
            
            void main() {
                vec4 sum = vec4( 0.0 );
                float hh = uH * abs( uR - vUv0.x );
            
                sum += texture2D( uColorBuffer, vec2( vUv0.x - 4.0 * hh, vUv0.y ) ) * 0.051;
                sum += texture2D( uColorBuffer, vec2( vUv0.x - 3.0 * hh, vUv0.y ) ) * 0.0918;
                sum += texture2D( uColorBuffer, vec2( vUv0.x - 2.0 * hh, vUv0.y ) ) * 0.12245;
                sum += texture2D( uColorBuffer, vec2( vUv0.x - 1.0 * hh, vUv0.y ) ) * 0.1531;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y ) ) * 0.1633;
                sum += texture2D( uColorBuffer, vec2( vUv0.x + 1.0 * hh, vUv0.y ) ) * 0.1531;
                sum += texture2D( uColorBuffer, vec2( vUv0.x + 2.0 * hh, vUv0.y ) ) * 0.12245;
                sum += texture2D( uColorBuffer, vec2( vUv0.x + 3.0 * hh, vUv0.y ) ) * 0.0918;
                sum += texture2D( uColorBuffer, vec2( vUv0.x + 4.0 * hh, vUv0.y ) ) * 0.051;
            
                gl_FragColor = sum;
            }
        `;

        this.shader = pc.ShaderUtils.createShader(graphicsDevice, {
            uniqueName: 'HorizontalTiltShiftShader',
            attributes: { aPosition: pc.SEMANTIC_POSITION },
            vertexGLSL: (pc as any).PostEffect.quadVertexShader,
            fragmentGLSL: fshader
        });
    }

    render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget, rect: pc.Vec4) {
        const device = this.device;
        const scope = device.scope;

        scope.resolve('uH').setValue(1 / inputTarget.width);
        scope.resolve('uR').setValue(this.focus);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        if (this.shader) {
            this.drawQuad(outputTarget, this.shader, rect);
        }
    }
}
