// Device-local graphics backend preference.
//
// The chosen backend depends on the user's machine, not on the scene, so it is
// stored in localStorage / URL only and is deliberately kept OUT of the model
// settings JSON and embed URLs. Precedence: explicit URL param > localStorage > 'auto'.
//
// - 'auto'   → try WebGPU first, fall back to WebGL 2 (engine appends its own fallbacks).
// - 'webgpu' → prefer WebGPU, still falls back to WebGL 2 if it cannot start.
// - 'webgl'  → force WebGL 2 (diagnostics / driver workarounds / render comparison).

export type GraphicsBackend = 'auto' | 'webgpu' | 'webgl';

const STORAGE_KEY = 'mv:graphics-backend';

const isBackend = (value: unknown): value is GraphicsBackend => value === 'auto' || value === 'webgpu' || value === 'webgl';

// Resolve the requested backend from URL params first, then localStorage, then 'auto'.
// URL params (`?webgpu` / `?webgl`) win so a shared diagnostic link is reproducible.
export const resolveRequestedBackend = (url: URL): GraphicsBackend => {
    const hasWebgpu = url.searchParams.has('webgpu');
    const hasWebgl = url.searchParams.has('webgl');
    if (hasWebgpu && !hasWebgl) return 'webgpu';
    if (hasWebgl && !hasWebgpu) return 'webgl';

    try {
        const stored = window.localStorage?.getItem(STORAGE_KEY);
        if (isBackend(stored)) return stored;
    } catch {
        // localStorage may be unavailable (privacy mode / sandboxed iframe) — ignore.
    }
    return 'auto';
};

// Расширения гауссовых сплатов. Только на них WebGPU даёт измеримый выигрыш: движок
// сортирует сплаты на видеокарте (`GSplat renderer: GPU sort`), тогда как на WebGL 2
// сортировка идёт на процессоре.
const SPLAT_EXTENSION = /\.(?:ply|sog|spz)(?:\?|#|$)/i;

const isFirefox = () => typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

/**
 * Названа ли в адресе сцена со сплатами.
 *
 * Решение о бэкенде принимается ДО загрузки, поэтому судить можно только по адресу.
 * Это приближение: сплаты бывают и внутри `.glb` через `KHR_gaussian_splatting`, и
 * приходят перетаскиванием уже после старта — такие случаи достанутся WebGL 2, и для
 * них остаётся ручной переключатель.
 *
 * @param url - Адрес страницы.
 * @returns `true`, если модель в адресе похожа на сплаты.
 */
const scenePointsAtSplats = (url: URL): boolean => {
    return ['load', 'assetUrl'].some((key) => {
        const value = url.searchParams.get(key);
        return !!value && SPLAT_EXTENSION.test(value);
    });
};

/**
 * Какой бэкенд просить на самом деле.
 *
 * В Firefox режим «авто» означает WebGL 2, а не WebGPU. Причина не идеологическая:
 * его реализация WebGPU моложе хромовской и на тяжёлых моделях ведёт себя заметно
 * хуже — вплоть до того, что плеер подолгу стоит перед первым кадром. Единственное
 * место, где выигрыш WebGPU виден и измерим, — гауссовы сплаты с сортировкой на
 * видеокарте; ради них исключение и сделано.
 *
 * Явный выбор — параметр адреса или переключатель в настройках — главнее этого
 * правила: оно работает только когда пользователь ничего не выбирал.
 *
 * @param url - Адрес страницы.
 * @param requested - Что запросил пользователь (`resolveRequestedBackend`).
 * @returns Бэкенд, который следует создавать.
 */
export const resolveEffectiveBackend = (url: URL, requested: GraphicsBackend): GraphicsBackend => {
    if (requested !== 'auto') return requested;
    if (isFirefox() && !scenePointsAtSplats(url)) return 'webgl';
    return 'webgpu';
};

// Persist the user's manual choice locally. 'auto' clears any stored override.
export const persistRequestedBackend = (backend: GraphicsBackend) => {
    try {
        if (backend === 'auto') {
            window.localStorage?.removeItem(STORAGE_KEY);
        } else {
            window.localStorage?.setItem(STORAGE_KEY, backend);
        }
    } catch {
        // ignore storage failures
    }
};
