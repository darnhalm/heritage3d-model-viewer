/** Public Geoscan project adapter. Only bounded ranges of a public 3TZ are forwarded. */
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { Readable } from 'node:stream';

const API = 'https://cloud.geoscan.ru';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const uuidPattern = new RegExp(`^${UUID}$`, 'i');
const MAX_RANGE = 1024 * 1024;
const MAX_JSON = 4 * 1024 * 1024;
const BYTE_CACHE_LIMIT = 32 * 1024 * 1024;
const BYTE_CACHE_ENTRIES = 256;
const BYTE_CACHE_TTL = 30000;
const PRODUCTION_ORIGIN = 'https://playcanvasviewer.website.yandexcloud.net';
const cors = {
    vary: 'Origin',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range',
    'access-control-expose-headers': 'Content-Range, Content-Length, Accept-Ranges, ETag, Last-Modified, X-Geoscan-Cache',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
};

class GeoscanError extends Error {
    constructor(code, status = 502) {
        super(code);
        this.status = status;
    }
}

/** Accept only public links, never an arbitrary upstream URL or an authenticated project. */
export function parseSource(value) {
    let url;
    try { url = new URL(value); } catch { throw new GeoscanError('invalid_link', 400); }
    if (url.protocol !== 'https:' || url.hostname !== 'cloud.geoscan.ru' || url.port || url.username || url.password) {
        throw new GeoscanError('invalid_link', 400);
    }
    const shared = new RegExp(`^/shared/projects/(${UUID})/?$`, 'i').exec(url.pathname);
    const embedded = new RegExp(`^/embedded/projects/(${UUID})/(${UUID})/?$`, 'i').exec(url.pathname);
    if (!shared && !embedded) throw new GeoscanError('invalid_link', 400);
    return {
        access: (shared?.[1] ?? embedded[2]).toLowerCase(),
        project: embedded?.[1].toLowerCase(),
        source: `${url.origin}${url.pathname.replace(/\/$/, '')}`
    };
}

// Geoscan uses Russian Trusted CA and omits its intermediate. Scope the supplied official
// chain to this host; storage and all other HTTPS requests keep the normal trust store.
const geoscanAgent = new https.Agent({
    ca: readFileSync(new URL('./certs/geoscan-ca.pem', import.meta.url)),
    keepAlive: true,
    maxSockets: 6,
    maxFreeSockets: 2
});

function upstreamFetch(input, init) {
    if (new URL(input).origin !== API) return fetch(input, init);
    return new Promise((resolve, reject) => {
        const req = https.request(input, { method: init.method ?? 'GET', headers: init.headers, signal: init.signal, agent: geoscanAgent }, (res) => {
            resolve(new Response([204, 304].includes(res.statusCode) ? null : Readable.toWeb(res), {
                status: res.statusCode, headers: res.headers
            }));
        });
        req.once('error', reject);
        req.end();
    });
}

export function createGeoscanHandler({
    fetch: request = upstreamFetch, now = Date.now,
    allowedOrigins = (process.env.GEOSCAN_ALLOWED_ORIGINS ?? PRODUCTION_ORIGIN).split(',').map(value => value.trim()).filter(Boolean)
} = {}) {
    const origins = new Set(allowedOrigins.map((value) => {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('Invalid allowed origin');
        return url.origin;
    }));
    const projects = new Map();
    const signatures = new Map();
    const inFlight = new Map();
    const byteCache = new Map();
    const byteRequests = new Map();
    let cachedBytes = 0;

    const forgetBytes = (key) => {
        const entry = byteCache.get(key);
        if (entry) cachedBytes -= entry.body.byteLength;
        byteCache.delete(key);
    };

    const cached = async (cache, key, load) => {
        const item = cache.get(key);
        if (item && item.expires > now()) return item.value;
        const pendingKey = `${cache === projects ? 'project' : 'signature'}:${key}`;
        if (!inFlight.has(pendingKey)) {
            const pending = load().then(({ value, expires }) => {
                if (cache.size >= 256) cache.delete(cache.keys().next().value);
                cache.set(key, { value, expires });
                return value;
            }).finally(() => inFlight.delete(pendingKey));
            inFlight.set(pendingKey, pending);
        }
        return inFlight.get(pendingKey);
    };

    const apiJson = async (path) => {
        const response = await request(`${API}${path}`, {
            redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' }
        });
        if ([301, 302, 303, 307, 308, 401, 403, 404].includes(response.status)) {
            await response.body?.cancel();
            throw new GeoscanError('access_denied', 403);
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new GeoscanError('upstream_unavailable');
        }
        const bytes = await readBounded(response, MAX_JSON);
        try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new GeoscanError('upstream_unavailable'); }
    };

    const projectFor = source => cached(projects, source.access, async () => {
        const access = await apiJson(`/api/accesses/${source.access}`);
        if (!uuidPattern.test(access.teamUid) || !uuidPattern.test(access.projectUid) ||
            (source.project && source.project !== access.projectUid.toLowerCase())) {
            throw new GeoscanError('invalid_link', 400);
        }
        const base = `/api/teams/${access.teamUid}/projects/${access.projectUid}`;
        const project = await apiJson(`${base}?access=${source.access}`);
        const datasets = (project.structure?.datasets ?? []).filter(dataset =>
            uuidPattern.test(dataset.datasetUid) && uuidPattern.test(dataset.visualData?.dataUid) &&
            dataset.visualData?.type === 'CESIUM_TILES_3TZ' && dataset.visualData?.status === 'COMPLETED'
        ).map(dataset => ({
            id: dataset.datasetUid,
            name: dataset.properties?.name || dataset.name || 'Geoscan',
            dataId: dataset.visualData.dataUid,
            size: Number(dataset.visualData.sizeInBytes) || 0
        }));
        if (!datasets.length) throw new GeoscanError('no_models', 422);
        return { value: { base, name: project.projectInfo?.name || 'Geoscan', version: project.projectInfo?.version ?? '', datasets }, expires: now() + 60000 };
    });

    const signatureFor = (source, project, dataset) => cached(signatures, `${source.access}:${dataset.id}:${dataset.dataId}`, async () => {
        const result = await apiJson(`${project.base}/datasets/${dataset.id}/tilesets/${dataset.dataId}/download/presign/tileset.3tz?access=${source.access}`);
        let url;
        try { url = new URL(result.url); } catch { throw new GeoscanError('upstream_unavailable'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.port ||
            !(url.hostname === 'storage.yandexcloud.net' || url.hostname.endsWith('.storage.yandexcloud.net'))) {
            throw new GeoscanError('upstream_unavailable');
        }
        const date = url.searchParams.get('X-Amz-Date') ?? '';
        const parsedDate = /^\d{8}T\d{6}Z$/.test(date) ? Date.parse(
            `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`
        ) : now();
        const duration = Number(url.searchParams.get('X-Amz-Expires')) || 300;
        // Keep signed URLs server-side and renew before they expire during a long session.
        const expires = Math.max(now() + 1000, Math.min(now() + 2400000, parsedDate + duration * 1000 - 60000));
        return { value: url.href, expires };
    });

    const handle = async (req) => {
        try {
            if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
            if (!['GET', 'HEAD'].includes(req.method)) throw new GeoscanError('method_not_allowed', 405);
            const query = new URL(req.url).searchParams;
            const source = parseSource(query.get('source'));
            const action = query.get('action') ?? 'resolve';
            if (!['resolve', 'archive'].includes(action)) throw new GeoscanError('invalid_request', 400);
            const range = action === 'archive' && req.method === 'GET' ? validateRange(req.headers.get('range')) : null;
            const project = await projectFor(source);
            if (source.project && !project.base.endsWith(`/${source.project}`)) throw new GeoscanError('invalid_link', 400);
            if (action === 'resolve') {
                return json({ name: project.name, source: source.source, datasets: project.datasets.map(({ id, name }) => ({ id, name })) });
            }
            const datasetId = query.get('dataset');
            const dataset = project.datasets.find(item => item.id === datasetId);
            if (!dataset) throw new GeoscanError('model_not_found', 404);
            if (req.method === 'HEAD') return new Response(null, {
                headers: { ...cors, 'accept-ranges': 'bytes', 'content-length': String(dataset.size) }
            });
            // Cache only after the public-access check above. Scope bytes to the public link,
            // dataset and project version; browser caching remains disabled for revocation.
            const key = JSON.stringify([source.access, dataset.id, dataset.dataId, project.version, range]);
            const previous = byteCache.get(key);
            if (previous && previous.expires > now()) {
                byteCache.delete(key);
                byteCache.set(key, previous);
                return new Response(previous.body, { status: 206, headers: { ...previous.headers, 'x-geoscan-cache': 'HIT' } });
            }
            if (previous) forgetBytes(key);
            if (!byteRequests.has(key)) {
                const pending = (async () => {
                    let url = await signatureFor(source, project, dataset);
                    const init = {
                        redirect: 'manual', signal: AbortSignal.timeout(30000),
                        headers: { Range: range, 'Accept-Encoding': 'identity' }
                    };
                    let response = await request(url, init);
                    if (response.status === 401 || response.status === 403) {
                        await response.body?.cancel();
                        signatures.delete(`${source.access}:${dataset.id}:${dataset.dataId}`);
                        // Recheck public access before retrying an expired or revoked signature.
                        projects.delete(source.access);
                        const refreshed = await projectFor(source);
                        const current = refreshed.datasets.find(item => item.id === dataset.id);
                        if (!current || current.dataId !== dataset.dataId) throw new GeoscanError('model_changed', 409);
                        url = await signatureFor(source, refreshed, current);
                        response = await request(url, { ...init, signal: AbortSignal.timeout(30000) });
                    }
                    if (response.status !== 206 || !/^bytes \d+-\d+\/\d+$/.test(response.headers.get('content-range') ?? '')) {
                        await response.body?.cancel();
                        throw new GeoscanError(response.status === 416 ? 'invalid_range' : 'archive_unavailable', response.status === 416 ? 416 : 502);
                    }
                    const body = await readBounded(response, MAX_RANGE);
                    const headers = { ...cors, 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream', 'content-length': String(body.length) };
                    for (const key of ['content-range', 'etag', 'last-modified']) {
                        if (response.headers.has(key)) headers[key] = response.headers.get(key);
                    }
                    const entry = { body, headers, expires: now() + BYTE_CACHE_TTL };
                    for (const [cachedKey, cached] of byteCache) {
                        if (cached.expires <= now()) forgetBytes(cachedKey);
                    }
                    while ((cachedBytes + body.byteLength > BYTE_CACHE_LIMIT || byteCache.size >= BYTE_CACHE_ENTRIES) && byteCache.size) {
                        forgetBytes(byteCache.keys().next().value);
                    }
                    byteCache.set(key, entry);
                    cachedBytes += body.byteLength;
                    return entry;
                })().finally(() => byteRequests.delete(key));
                byteRequests.set(key, pending);
            }
            const entry = await byteRequests.get(key);
            return new Response(entry.body, { status: 206, headers: { ...entry.headers, 'x-geoscan-cache': 'MISS' } });
        } catch (error) {
            return json({ error: error instanceof GeoscanError ? error.message : 'upstream_unavailable' }, error instanceof GeoscanError ? error.status : 502);
        }
    };

    return async (req) => {
        const origin = req.headers.get('origin');
        // Reject other browser origins before any upstream work. CORS is not authentication:
        // same-origin requests and server clients can omit Origin altogether.
        if (origin && !origins.has(origin)) return json({ error: 'origin_not_allowed' }, 403);
        const response = await handle(req);
        if (origin) response.headers.set('access-control-allow-origin', origin);
        return response;
    };
}

function validateRange(range) {
    const explicit = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    const suffix = /^bytes=-(\d+)$/.exec(range ?? '');
    if (explicit) {
        const start = Number(explicit[1]);
        const end = Number(explicit[2]);
        if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start && end - start < MAX_RANGE) return range;
    } else if (suffix && Number(suffix[1]) > 0 && Number(suffix[1]) <= MAX_RANGE) return range;
    throw new GeoscanError('invalid_range', 416);
}

async function readBounded(response, limit) {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new GeoscanError('upstream_unavailable');
            chunks.push(value);
        }
    } finally { await reader.cancel(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
}

function json(value, status = 200) {
    return Response.json(value, { status, headers: cors });
}

const handle = createGeoscanHandler();

/** Yandex Cloud Functions / API Gateway envelope; no credentials or external dependencies. */
export async function handler(event) {
    const url = new URL('https://viewer.invalid/api/geoscan');
    for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) url.searchParams.set(key, value);
    const response = await handle(new Request(url, { method: event.httpMethod ?? 'GET', headers: event.headers }));
    return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()).toString('base64'),
        isBase64Encoded: true
    };
}
