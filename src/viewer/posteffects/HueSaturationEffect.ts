import {
    PostEffect,
    GraphicsDevice,
    ShaderUtils,
    SEMANTIC_POSITION
} from 'playcanvas';

export class HueSaturationEffect extends PostEffect {
    hue = 0;
    saturation = 0;
    shader: any;

    constructor(graphicsDevice: GraphicsDevice) {
        super(graphicsDevice);

        const fragmentGLSL = `
            uniform sampler2D uColorBuffer;
            uniform float uHue;
            uniform float uSaturation;
            varying vec2 vUv0;
            void main() {
                gl_FragColor = texture2D( uColorBuffer, vUv0 );
                float angle = uHue * 3.14159265;
                float s = sin(angle), c = cos(angle);
                vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
                gl_FragColor.rgb = vec3(
                    dot(gl_FragColor.rgb, weights.xyz),
                    dot(gl_FragColor.rgb, weights.zxy),
                    dot(gl_FragColor.rgb, weights.yzx)
                );
                float average = (gl_FragColor.r + gl_FragColor.g + gl_FragColor.b) / 3.0;
                if (uSaturation > 0.0) {
                    gl_FragColor.rgb += (average - gl_FragColor.rgb) * (1.0 - 1.0 / (1.001 - uSaturation));
                } else {
                    gl_FragColor.rgb += (average - gl_FragColor.rgb) * (-uSaturation);
                }
            }
        `;

        this.shader = (ShaderUtils as any).createShader(graphicsDevice, {
            uniqueName: 'HueSaturationShader',
            attributes: { aPosition: SEMANTIC_POSITION },
            vertexGLSL: PostEffect.quadVertexShader,
            fragmentGLSL: fragmentGLSL
        });
    }

    render(inputTarget: any, outputTarget: any, rect: any) {
        const device = this.device;
        const scope = device.scope;

        scope.resolve('uHue').setValue(this.hue);
        scope.resolve('uSaturation').setValue(this.saturation);
        scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
        this.drawQuad(outputTarget, this.shader, rect);
    }
}
