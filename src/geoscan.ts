import { t } from './i18n/translations';
import type { File as ViewerFile } from './types';

declare const __GEOSCAN_PROXY_URL__: string;

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const publicPath = new RegExp(`^/(?:shared/projects/${UUID}|embedded/projects/${UUID}/${UUID})/?$`, 'i');

interface Dataset {
    id: string;
    name: string;
}

export const isGeoscanUrl = (value: string): boolean => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'cloud.geoscan.ru' && !url.port &&
            !url.username && !url.password && publicPath.test(url.pathname);
    } catch {
        return false;
    }
};

const endpoint = (source: string, action: string, dataset?: string): URL => {
    const url = new URL(__GEOSCAN_PROXY_URL__ || '/api/geoscan', window.location.href);
    url.searchParams.set('action', action);
    url.searchParams.set('source', source);
    if (dataset) url.searchParams.set('dataset', dataset);
    return url;
};

const responseError = async (response: Response, lang?: string): Promise<Error> => {
    let code: string;
    try {
        code = (await response.json()).error;
    } catch { /* A static host may return its HTML 404 page. */ }
    const key = ({
        access_denied: 'The Geoscan link is unavailable or access has been closed.',
        no_models: 'This Geoscan project has no ready 3D model.',
        model_not_found: 'The selected Geoscan model is no longer available.',
        model_changed: 'The Geoscan model changed. Open the project again.'
    } as Record<string, string>)[code] ?? 'Could not connect to Geoscan. Please try again later.';
    return new Error(t(key, lang));
};

const retryDelay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const wake = AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]);
    wake.addEventListener('abort', () => {
        if (signal.aborted) reject(signal.reason);
        else resolve();
    }, { once: true });
});

/**
 * Select one dataset without downloading an archive.
 *
 * @param datasets - Ready model datasets.
 * @param lang - Interface language.
 * @param signal - Cancels the picker when another scene is loaded.
 * @returns Selected dataset.
 */
const chooseDataset = (datasets: Dataset[], lang: string, signal: AbortSignal): Promise<Dataset> => new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'geoscan-model-picker';
    const label = document.createElement('label');
    label.textContent = t('Choose a Geoscan model', lang);
    const select = document.createElement('select');
    select.setAttribute('aria-label', label.textContent);
    for (const dataset of datasets) {
        const option = document.createElement('option');
        option.value = dataset.id;
        option.textContent = dataset.name;
        select.appendChild(option);
    }
    label.appendChild(select);
    const actions = document.createElement('div');
    const open = document.createElement('button');
    open.textContent = t('Open model', lang);
    const cancel = document.createElement('button');
    cancel.textContent = t('Cancel', lang);
    actions.append(cancel, open);
    dialog.append(label, actions);
    const aborted = () => {
        signal.removeEventListener('abort', aborted);
        dialog.remove();
        reject(new DOMException('Cancelled', 'AbortError'));
    };
    const cleanup = () => {
        signal.removeEventListener('abort', aborted); dialog.remove();
    };
    open.addEventListener('click', () => {
        const selected = datasets.find(dataset => dataset.id === select.value);
        cleanup();
        resolve(selected);
    });
    cancel.addEventListener('click', aborted);
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault(); aborted();
    });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) {
        aborted(); return;
    }
    document.body.appendChild(dialog);
    dialog.showModal();
});

/**
 * Preserve the public project URL; signed storage URLs remain on the server.
 *
 * @param file - Public Geoscan project.
 * @param lang - Interface language.
 * @param signal - Cancels resolution and subsequent archive reads.
 * @returns Seekable 3TZ source with stable public URL.
 */
export async function prepareGeoscanFile(file: ViewerFile, lang: string, signal: AbortSignal): Promise<ViewerFile> {
    let response: Response;
    try {
        response = await fetch(endpoint(file.url, 'resolve'), { signal, credentials: 'omit', cache: 'no-store' });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(t('Could not connect to Geoscan. Please try again later.', lang));
    }
    if (!response.ok) throw await responseError(response, lang);
    let datasets: Dataset[];
    try {
        const data = await response.json();
        datasets = data.datasets;
        if (!Array.isArray(datasets) || !datasets.length || datasets.some(item => !new RegExp(`^${UUID}$`, 'i').test(item.id) || typeof item.name !== 'string'
        )) throw new Error();
    } catch {
        throw new Error(t('Could not connect to Geoscan. Please try again later.', lang));
    }
    signal.throwIfAborted();
    const requested = new URL(file.url).searchParams.get('dataset');
    const dataset = requested ? datasets.find(item => item.id === requested) :
        datasets.length === 1 ? datasets[0] : await chooseDataset(datasets, lang, signal);
    if (!dataset) throw new Error(t('The selected Geoscan model is no longer available.', lang));
    const source = new URL(file.url);
    source.search = '';
    source.hash = '';
    source.searchParams.set('dataset', dataset.id);
    const archive = endpoint(source.href, 'archive', dataset.id);
    return {
        url: source.href,
        filename: `${dataset.name.replace(/[\\/]/g, '_').replace(/\.3tz$/i, '')}.3tz`,
        archiveFetch: async (_input, init) => {
            const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
            // Keep a temporary transport/upstream failure from permanently failing a tile.
            // Access errors and changed archives are not retried here.
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    // eslint-disable-next-line no-await-in-loop -- bounded retries of the same byte range
                    const response = await fetch(archive, {
                        method: init?.method ?? 'GET',
                        headers: init?.headers,
                        signal: requestSignal,
                        credentials: 'omit',
                        cache: 'no-store'
                    });
                    if (response.ok) return response;
                    if (attempt === 2 || ![429, 500, 502, 503, 504].includes(response.status)) {
                        // eslint-disable-next-line no-await-in-loop -- only parse the final error response
                        throw await responseError(response, lang);
                    }
                    // eslint-disable-next-line no-await-in-loop -- release the failed body before retrying
                    await response.body?.cancel();
                } catch (error) {
                    if (requestSignal.aborted || attempt === 2 || !(error instanceof TypeError)) throw error;
                }
                // eslint-disable-next-line no-await-in-loop -- abortable backoff, never concurrent duplicate retries
                await retryDelay(500 * (attempt + 1), requestSignal);
            }
            throw new Error(t('Could not connect to Geoscan. Please try again later.', lang));
        }
    };
}
