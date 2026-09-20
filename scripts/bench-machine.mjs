/* eslint-disable no-undef */
/**
 * Паспорт машины и кадровые метрики для замеров.
 *
 * Прогоны замеров до сих пор не записывали, где они выполнялись, и два отчёта с разных
 * ноутбуков нечем было сопоставить. Здесь собирается то, чего не хватало: чем считала
 * машина, сколько на кадр потратила видеокарта и сколько заняла видеопамять.
 *
 * Время GPU берётся из профилировщика движка (`gpuProfiler._frameTime`): публичного
 * геттера в релизной сборке нет, а поле заполняется. Разбивки по проходам там нет —
 * только суммарное время кадра.
 */
import os from 'node:os';

/**
 * Снять паспорт машины: чем рисуем, на чём считаем, в какое разрешение.
 *
 * Строку видеокарты читаем через `WEBGL_debug_renderer_info` у отдельного контекста: у
 * WebGPU-адаптера `info` в браузере пустой, а эта строка приходит на любом бэкенде и
 * одинаково называет железо.
 *
 * @param {import('@playwright/test').Page} page - Страница с загруженным плеером.
 * @returns {Promise<object>} Паспорт машины и браузера.
 */
export const collectMachineProfile = async (page) => {
    const browserProfile = await page.evaluate(() => {
        const viewer = window.viewer;
        const device = viewer?.app?.graphicsDevice;
        const readRenderer = () => {
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (!gl) return { renderer: null, vendor: null };
                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                return {
                    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
                };
            } catch {
                return { renderer: null, vendor: null };
            }
        };
        const { renderer, vendor } = readRenderer();
        const canvas = viewer?.canvas;
        return {
            backend: device?.deviceType ?? null,
            gpuRenderer: renderer,
            gpuVendor: vendor,
            maxTextureSize: device?.gpuAdapter?.limits?.maxTextureDimension2D ?? device?.maxTextureSize ?? null,
            canvasCssPx: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
            canvasDevicePx: canvas ? [canvas.width, canvas.height] : null,
            devicePixelRatio: window.devicePixelRatio,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            deviceMemoryGB: navigator.deviceMemory ?? null,
            userAgent: navigator.userAgent
        };
    });

    return {
        ...browserProfile,
        host: {
            platform: `${os.platform()} ${os.release()}`,
            arch: os.arch(),
            cpu: os.cpus()?.[0]?.model ?? null,
            cores: os.cpus()?.length ?? null,
            memoryGB: Math.round(os.totalmem() / 1024 ** 3)
        }
    };
};

/**
 * Начать сбор времени кадра.
 *
 * Считаем две величины: сколько кадр занял главный поток (от `frameupdate` до `frameend`)
 * и сколько на него потратила видеокарта. Первое мы можем ускорить кодом, второе — только
 * содержимым сцены, и путать их нельзя.
 *
 * @param {import('@playwright/test').Page} page - Страница с загруженным плеером.
 * @returns {Promise<void>}
 */
export const installFrameProbe = async (page) => {
    await page.evaluate(() => {
        const viewer = window.viewer;
        const app = viewer.app;
        const profiler = app.graphicsDevice.gpuProfiler;
        if (profiler) profiler.enabled = true;

        const probe = { cpuMs: [], gpuMs: [], startedAt: 0 };
        window.__benchFrameProbe = probe;
        probe.onUpdate = () => {
            probe.startedAt = performance.now();
        };
        probe.onEnd = () => {
            if (probe.startedAt) probe.cpuMs.push(performance.now() - probe.startedAt);
            const frameTime = profiler?._frameTime;
            if (typeof frameTime === 'number' && frameTime > 0) probe.gpuMs.push(frameTime);
        };
        app.on('frameupdate', probe.onUpdate);
        app.on('frameend', probe.onEnd);
    });
};

/**
 * Забрать собранное и снять обработчики.
 *
 * @param {import('@playwright/test').Page} page - Страница с загруженным плеером.
 * @returns {Promise<object>} Медианы и хвосты времени кадра плюс видеопамять.
 */
export const readFrameProbe = (page) => {
    return page.evaluate(() => {
        const viewer = window.viewer;
        const app = viewer.app;
        const probe = window.__benchFrameProbe;
        if (!probe) return null;
        app.off('frameupdate', probe.onUpdate);
        app.off('frameend', probe.onEnd);

        const quantile = (values, q) => {
            if (!values.length) return null;
            const sorted = [...values].sort((a, b) => a - b);
            return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(3);
        };
        const vram = app.stats?.vram ?? {};
        const bytesToMb = value => (typeof value === 'number' ? +(value / 1048576).toFixed(1) : null);

        return {
            frames: probe.cpuMs.length,
            cpuFrameP50Ms: quantile(probe.cpuMs, 0.5),
            cpuFrameP95Ms: quantile(probe.cpuMs, 0.95),
            gpuFrameP50Ms: quantile(probe.gpuMs, 0.5),
            gpuFrameP95Ms: quantile(probe.gpuMs, 0.95),
            gpuSamples: probe.gpuMs.length,
            vramMb: {
                textures: bytesToMb(vram.tex),
                vertexBuffers: bytesToMb(vram.vb),
                indexBuffers: bytesToMb(vram.ib),
                uniformBuffers: bytesToMb(vram.ub),
                total: bytesToMb((vram.tex ?? 0) + (vram.vb ?? 0) + (vram.ib ?? 0) + (vram.ub ?? 0))
            },
            jsHeapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
        };
    });
};
