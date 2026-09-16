import { GraphicsDevice, PIXELFORMAT_RGBA16F, RenderTarget } from 'playcanvas';

type CanvasConfig = { format: string; toneMapping?: { mode: string }; viewFormats?: string[] };
// Adapter for the pinned PlayCanvas 2.21.4 WebGPU backbuffer implementation.
type DisplayDevice = GraphicsDevice & {
    canvasConfig: CanvasConfig;
    gpuContext: { configure: (config: CanvasConfig) => void; getConfiguration?: () => CanvasConfig };
    backBufferViewFormat: string;
    _canvasBackBufferFormat: number;
    backBuffer: RenderTarget;
    createBackbuffer: () => void;
};

export class HdrDisplay {
    private original: { config: CanvasConfig; format: number; view: string; hdr: boolean } | undefined;

    private unsupported = false;

    update(graphics: GraphicsDevice, wanted: boolean) {
        if (!graphics.isWebGPU) return;
        const device = graphics as DisplayDevice;
        if (!wanted) {
            if (!this.original) return;
            const state = this.original;
            device.gpuContext.configure(state.config);
            device.canvasConfig = state.config;
            device.backBufferFormat = state.format;
            device._canvasBackBufferFormat = state.format;
            device.backBufferViewFormat = state.view;
            device.isHdr = state.hdr;
            this.original = undefined;
        } else {
            if (this.original || this.unsupported || device.isHdr) return;
            const config = device.canvasConfig;
            try {
                const hdrConfig: CanvasConfig = { ...config, format: 'rgba16float', viewFormats: [], toneMapping: { mode: 'extended' } };
                device.gpuContext.configure(hdrConfig);
                const actual = device.gpuContext.getConfiguration?.();
                if (actual?.format !== 'rgba16float' || actual?.toneMapping?.mode !== 'extended') {
                    throw new Error('Extended canvas output is unsupported');
                }
                this.original = { config, format: device.backBufferFormat, view: device.backBufferViewFormat, hdr: device.isHdr };
                device.canvasConfig = hdrConfig;
                device.backBufferFormat = PIXELFORMAT_RGBA16F;
                device._canvasBackBufferFormat = PIXELFORMAT_RGBA16F;
                device.backBufferViewFormat = 'rgba16float';
                device.isHdr = true;
            } catch {
                device.gpuContext.configure(config);
                this.unsupported = true;
                return;
            }
        }
        device.backBuffer.destroy();
        device.createBackbuffer();
    }
}
