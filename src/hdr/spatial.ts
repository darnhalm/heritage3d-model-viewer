import { ADDRESS_CLAMP_TO_EDGE, FILTER_LINEAR, GraphicsDevice, PIXELFORMAT_RGBA16F, RenderPassShaderQuad, RenderTarget, SEMANTIC_POSITION, ShaderUtils, Texture } from 'playcanvas';

import { fragmentGLSL, fragmentWGSL, vertexGLSL, vertexWGSL } from '../multiframe';

/** FSR passes share the ordinary viewer shader; HDR enables a relative RCAS ceiling. */
export class HdrSpatial {
    private pass: RenderPassShaderQuad;

    private targets: RenderTarget[] = [];

    constructor(private device: GraphicsDevice) {
        this.pass = new RenderPassShaderQuad(device);
        this.pass.init(null);
        this.pass.shader = ShaderUtils.createShader(device, {
            uniqueName: 'hdr-spatial',
            attributes: { vertex_position: SEMANTIC_POSITION },
            vertexGLSL,
            fragmentGLSL,
            vertexWGSL,
            fragmentWGSL
        });
    }

    target(index: number, width: number, height: number) {
        let target = this.targets[index];
        if (!target) {
            target = new RenderTarget({ depth: false,
                colorBuffer: new Texture(this.device, {
                    name: 'hdr-spatial-buffer',
                    width,
                    height,
                    format: PIXELFORMAT_RGBA16F,
                    mipmaps: false,
                    minFilter: FILTER_LINEAR,
                    magFilter: FILTER_LINEAR,
                    addressU: ADDRESS_CLAMP_TO_EDGE,
                    addressV: ADDRESS_CLAMP_TO_EDGE
                }) });
            this.targets[index] = target;
        }
        target.resize(width, height);
        return target;
    }

    render(source: Texture, target: RenderTarget | null, easu: boolean, sharpness: number) {
        const width = target?.width ?? this.device.width;
        const height = target?.height ?? this.device.height;
        const upscale = easu && (source.width < width || source.height < height);
        if (upscale && sharpness > 0) {
            const intermediate = this.target(1, width, height);
            this.draw(source, intermediate, true, 0);
            this.draw(intermediate.colorBuffer, target, false, sharpness);
        } else {
            this.draw(source, target, upscale, sharpness);
        }
    }

    private draw(source: Texture, target: RenderTarget | null, easu: boolean, sharpness: number) {
        if (this.pass.renderTarget !== target) this.pass.init(target);
        const scope = this.device.scope;
        scope.resolve('multiframeTex').setValue(source);
        scope.resolve('texcoordMod').setValue(this.device.isWebGPU ? [1, -1, 0, 1] : [1, 1, 0, 0]);
        scope.resolve('power').setValue(1);
        scope.resolve('hdrRange').setValue(1);
        scope.resolve('sharpness').setValue(sharpness);
        scope.resolve('easuEnabled').setValue(easu ? 1 : 0);
        scope.resolve('srcSize').setValue([source.width, source.height]);
        scope.resolve('outputTexel').setValue([1 / (target?.width ?? this.device.width), 1 / (target?.height ?? this.device.height)]);
        this.pass.render();
    }

    destroy() {
        this.pass.shader.destroy();
        this.pass.destroy();
        this.targets.forEach((target) => {
            target.colorBuffer.destroy(); target.destroy();
        });
    }
}
