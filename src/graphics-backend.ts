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
