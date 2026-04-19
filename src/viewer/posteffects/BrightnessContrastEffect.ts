import {
    PostEffect,
    GraphicsDevice,
    ShaderUtils,
    SEMANTIC_POSITION
} from 'playcanvas';

export class BrightnessContrastEffect extends PostEffect {
    brightness = 0;
    contrast = 0;
    shader: any;

    constructor(graphicsDevice: GraphicsDevice) {
        super(graphicsDevice);

        const fragmentGLSL = `
            uniform sampler2D uColorBuffer;
            uniform float uBrightness;
            uniform float uContrast;
            varying vec2 vUv0;
            void main() {
                gl_FragColor = texture2D( uColorBuffer, vUv0 );
                gl_FragColor.rgb += uBrightness;
                if (uContrast > 0.0) {
                    gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) / (1.0 - uContrast) + 0.5;
                } else {
                    gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * (1.0 + uContrast) + 0.5;
                }
            }
        `;

        this.shader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'BrightnessContrastShader',
            attributes: { aPosition: SEMANTIC_POSITION },
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: fragmentGLSL
        });
    }

    render(inputTarget: any, outputTarget: any, rect: any) {
        const device = this.device;
        const scope = device.scope;

        scope.resolve('uBrightness').setValue(this.brightness);
        scope.resolve('uContrast').setValue(this.contrast);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        this.drawQuad(outputTarget, this.shader, rect);
    }
}
