// Иконки панели: их подогревают заранее, чтобы при первом открытии вкладки не было
// подмигивания. Раньше список лежал сорока тегами `<link rel="preload">` прямо в
// index.html — и браузер честно тянул все сорок ещё до запуска кода, в том числе на
// встройке с `panel=0`, где панели не будет вовсе. Измерено: 40 запросов на 331 КБ
// ради разметки, которой в DOM нет.
//
// Теперь список живёт здесь, а подогрев запускается из index.tsx — только когда панель
// действительно показывают, и только после первого кадра, чтобы не толкаться в очереди
// с моделью и стилями.
const PANEL_ICONS = [
    'tab-settings-icon.svg', 'tab-texture-icon.svg', 'tab-poi-icon.svg',
    'id-icon.svg', 'final-render-icon.svg', 'diffuse-icon.svg',
    'metalness-icon.svg', 'roughness-icon.svg', 'opacity-icon.svg',
    'uv-icon.svg', 'ao-icon.svg', 'lighting-icon.svg',
    'emissive-icon.svg', 'specular-icon.svg', 'normal-icon.svg',
    'vertex-normals-icon.svg', 'wireframe-icon.svg', 'camera-icon.svg',
    'sky-icon.svg', 'light-icon.svg', 'settings-camera-icon.svg',
    'info-icon.svg', 'ruler-icon.svg', 'fragment-frame-icon.svg',
    'fragment-scale-icon.svg', 'share-icon.svg', 'fullscreen-icon.svg',
    'fullscreen-exit-icon.svg', 'fit-screen-icon.svg', 'reset-camera-icon.svg',
    'file-json-icon.svg', 'hd-icon.svg', 'sd-icon.svg',
    'orbit-mode.svg', 'fly-mode.svg', 'mouse-icon.svg',
    'trackpad-1-icon.svg', 'trackpad-2-icon.svg', 'swipe-left-icon.svg',
    'swipe-right-icon.svg'
];

/**
 * Подогреть иконки панели в простое браузера.
 *
 * @param baseHref - Префикс путей (тот же, что у остальной статики).
 */
const warmPanelIcons = (baseHref = '') => {
    const start = () => {
        PANEL_ICONS.forEach((name) => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = `${baseHref}static/icons/${name}`;
            document.head.appendChild(link);
        });
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(start, { timeout: 3000 });
    else setTimeout(start, 1000);
};

export { warmPanelIcons };
