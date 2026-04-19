import * as pc from 'playcanvas';

/**
 * @class
 * @name VerticalTiltShiftEffect
 * @classdesc Simple fake tilt-shift effect, modulating two pass Gaussian blur by vertical position.
 * @description Creates new instance of the post effect.
 * @augments pc.PostEffect
 * @param {pc.GraphicsDevice} graphicsDevice - The graphics device of the application.
 * @property {number} focus Controls where the "focused" horizontal line lies.
 */
export class VerticalTiltShiftEffect extends pc.PostEffect {
    shader: pc.Shader | null = null;
    focus: number = 0.35;

    constructor(graphicsDevice: pc.GraphicsDevice) {
        super(graphicsDevice);

        const fshader = `
            uniform sampler2D uColorBuffer;
            uniform float uV;
            uniform float uR;
            
            varying vec2 vUv0;
            
            void main() {
                vec4 sum = vec4( 0.0 );
                float vv = uV * abs( uR - vUv0.y );
            
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y - 4.0 * vv ) ) * 0.051;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y - 3.0 * vv ) ) * 0.0918;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y - 2.0 * vv ) ) * 0.12245;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y - 1.0 * vv ) ) * 0.1531;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y ) ) * 0.1633;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y + 1.0 * vv ) ) * 0.1531;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y + 2.0 * vv ) ) * 0.12245;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y + 3.0 * vv ) ) * 0.0918;
                sum += texture2D( uColorBuffer, vec2( vUv0.x, vUv0.y + 4.0 * vv ) ) * 0.051;
            
                gl_FragColor = sum;
            }
        `;

        this.shader = pc.ShaderUtils.createShader(graphicsDevice, {
            uniqueName: 'VerticalTiltShiftShader',
            attributes: { aPosition: pc.SEMANTIC_POSITION },
            vertexGLSL: (pc as any).PostEffect.quadVertexShader,
            fragmentGLSL: fshader
        });
    }

    render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget, rect: pc.Vec4) {
        const device = this.device;
        const scope = device.scope;

        scope.resolve('uV').setValue(1 / inputTarget.height);
        scope.resolve('uR').setValue(this.focus);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        if (this.shader) {
            this.drawQuad(outputTarget, this.shader, rect);
        }
    }
}
