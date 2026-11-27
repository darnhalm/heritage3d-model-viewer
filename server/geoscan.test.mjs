import assert from 'node:assert/strict';
import test from 'node:test';

import { createGeoscanHandler, parseSource, handler } from './geoscan.mjs';

const access = '6ac432f9-21a7-4331-985b-0bf8af76df90';
const team = '91e66125-78af-466c-8fc8-37eb7ba57aa6';
const project = '8cf399de-ea33-40ba-b580-a58872562bca';
const dataset = 'c081caf3-fe23-455e-8e38-e2df8ab97018';
const data = 'eb52f0e7-324f-4a70-954c-62312de76626';
const source = `https://cloud.geoscan.ru/shared/projects/${access}`;
const origin = 'https://playcanvasviewer.website.yandexcloud.net';
const bytes = new Uint8Array(1000).map((_, i) => i % 256);

const requestFor = (action = 'resolve', headers, src = source) => {
    const url = new URL('https://viewer.test/api/geoscan');
    url.searchParams.set('source', src);
    url.searchParams.set('action', action);
    url.searchParams.set('dataset', dataset);
    return new Request(url, { headers: { origin, ...headers } });
};

const fixture = (options = {}) => {
    let time = Date.UTC(2026, 10, 26);
    const calls = [];
    let signatures = 0;
    let assets = 0;
    const fetch = async (value, init) => {
        const url = new URL(value);
        calls.push({ url, init });
        if (url.hostname === 'cloud.geoscan.ru') {
            assert.equal(init.redirect, 'manual');
            if (url.pathname.startsWith('/api/accesses/')) {
                if (options.denied) return new Response(null, { status: 302, headers: { location: 'https://login.geoscan.ru/' } });
                return Response.json({ teamUid: team, projectUid: project });
            }
            assert.equal(url.searchParams.get('access'), access);
            if (url.pathname.endsWith('/tileset.3tz')) {
                signatures++;
                const date = new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
                return Response.json({ url: `https://agisoft-prod-workspace-bucket.storage.yandexcloud.net/model.3tz?X-Amz-Date=${date}&X-Amz-Expires=3000&signature=${signatures}` });
            }
            return Response.json({ projectInfo: { name: 'Kizhi' }, structure: { datasets: options.empty ? [] : [
                { datasetUid: dataset, name: 'Kizhi.3tz', visualData: { dataUid: data, type: 'CESIUM_TILES_3TZ', status: 'COMPLETED', sizeInBytes: bytes.length } },
                { datasetUid: team, name: 'Tour', visualData: { dataUid: project, type: 'GEOJSON', status: 'COMPLETED' } }
            ] } });
        }
        assert.equal(url.hostname, 'agisoft-prod-workspace-bucket.storage.yandexcloud.net');
        assert.equal(init.headers['Accept-Encoding'], 'identity');
        assets++;
        if (options.expired && assets === 1) return new Response(null, { status: 403 });
        if (options.fullResponse) return new Response('must not be downloaded', { status: 200 });
        const range = init.headers.Range;
        const suffix = /^bytes=-(\d+)$/.exec(range);
        const explicit = /^bytes=(\d+)-(\d+)$/.exec(range);
        const start = suffix ? Math.max(0, bytes.length - Number(suffix[1])) : Number(explicit[1]);
        const end = suffix ? bytes.length - 1 : Math.min(Number(explicit[2]), bytes.length - 1);
        return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
            'content-range': `bytes ${start}-${end}/${bytes.length}`, etag: 'stable-model-version', 'content-length': String(end - start + 1)
        } });
    };
    return { handle: createGeoscanHandler({ fetch, now: () => time, allowedOrigins: options.allowedOrigins }), calls, advance: milliseconds => { time += milliseconds; }, signatures: () => signatures, assets: () => assets };
};

test('resolves public project metadata without leaking signed URLs or unrelated layers', async () => {
    const { handle, calls } = fixture();
    const response = await handle(requestFor());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { source, name: 'Kizhi', datasets: [{ id: dataset, name: 'Kizhi.3tz' }] });
    assert.equal(calls.length, 2);
});

test('accepts embed links but refuses forged hosts, private paths and mismatched project IDs', async () => {
    assert.equal(parseSource(`https://cloud.geoscan.ru/embedded/projects/${project}/${access}/?autoplay=0`).access, access);
    const { handle } = fixture();
    for (const src of ['http://cloud.geoscan.ru/shared/projects/' + access, source.replace('cloud.geoscan.ru', 'cloud.geoscan.ru.evil.test'), source.replace('/shared/', '/private/'), source.replace('https://', 'https://name@')]) {
        assert.equal((await handle(requestFor('resolve', undefined, src))).status, 400);
    }
    const mismatch = `https://cloud.geoscan.ru/embedded/projects/${team}/${access}`;
    assert.equal((await handle(requestFor('resolve', undefined, mismatch))).status, 400);
});

test('forwards exact ranges and exposes size and immutable archive validators', async () => {
    const { handle } = fixture();
    const response = await handle(requestFor('archive', { range: 'bytes=10-29' }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 10-29/1000');
    assert.equal(response.headers.get('etag'), 'stable-model-version');
    assert.match(response.headers.get('access-control-expose-headers'), /ETag/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(10, 30));
    const suffix = await handle(requestFor('archive', { range: 'bytes=-65557' }));
    assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), bytes);
});

test('refuses whole archives, open-ended ranges, multiple ranges and overlarge requests before networking', async () => {
    const { handle, calls } = fixture();
    for (const range of [undefined, 'bytes=0-', 'bytes=0-1048576', 'bytes=-1048577', 'bytes=10-9', 'bytes=0-1,4-5', 'bytes=9007199254740992-9007199254740993']) {
        const response = await handle(requestFor('archive', range ? { range } : undefined));
        assert.equal(response.status, 416);
    }
    assert.equal(calls.length, 0);
    const full = fixture({ fullResponse: true });
    assert.equal((await full.handle(requestFor('archive', { range: 'bytes=0-9' }))).status, 502);
});

test('renews signed URLs during long sessions and coalesces parallel signing requests', async () => {
    const f = fixture();
    const req = () => requestFor('archive', { range: 'bytes=0-9' });
    await Promise.all(Array.from({ length: 8 }, () => f.handle(req())));
    assert.equal(f.signatures(), 1);
    f.advance(51 * 60 * 1000);
    assert.equal((await f.handle(req())).status, 206);
    assert.equal(f.signatures(), 2);
});

test('rechecks access and retries an expired signature once', async () => {
    const f = fixture({ expired: true });
    assert.equal((await f.handle(requestFor('archive', { range: 'bytes=0-9' }))).status, 206);
    assert.equal(f.signatures(), 2);
    assert.equal(f.calls.filter(call => call.url.pathname.startsWith('/api/accesses/')).length, 2);
});

test('reuses identical ranges briefly and coalesces simultaneous byte requests', async () => {
    const f = fixture();
    const req = () => requestFor('archive', { range: 'bytes=0-19' });
    const results = await Promise.all(Array.from({ length: 6 }, () => f.handle(req())));
    for (const response of results) assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(0, 20));
    assert.equal(f.assets(), 1);
    const cached = await f.handle(req());
    assert.equal(cached.headers.get('x-geoscan-cache'), 'HIT');
    assert.equal(cached.headers.get('cache-control'), 'no-store');
    f.advance(31000);
    assert.equal((await f.handle(req())).headers.get('x-geoscan-cache'), 'MISS');
    assert.equal(f.assets(), 2);
});

test('cached bytes do not bypass a subsequently closed public link', async () => {
    const options = {};
    const f = fixture(options);
    const req = () => requestFor('archive', { range: 'bytes=0-19' });
    assert.equal((await f.handle(req())).status, 206);
    options.denied = true;
    f.advance(61000);
    assert.equal((await f.handle(req())).status, 403);
    assert.equal(f.assets(), 1);
});

test('byte cache bounds the number of tiny entries and never confuses adjacent ranges', async () => {
    const f = fixture();
    for (let start = 0; start < 257; start++) {
        const response = await f.handle(requestFor('archive', { range: `bytes=${start}-${start}` }));
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(start, start + 1));
    }
    assert.equal(f.assets(), 257);
    assert.equal((await f.handle(requestFor('archive', { range: 'bytes=0-0' }))).headers.get('x-geoscan-cache'), 'MISS');
    assert.equal(f.assets(), 258);
});

test('closed public access and missing models are explicit errors, never login redirects', async () => {
    const closed = await fixture({ denied: true }).handle(requestFor());
    assert.equal(closed.status, 403);
    assert.deepEqual(await closed.json(), { error: 'access_denied' });
    const empty = await fixture({ empty: true }).handle(requestFor());
    assert.equal(empty.status, 422);
    assert.deepEqual(await empty.json(), { error: 'no_models' });
});

test('cloud function envelope preserves CORS for preflights', async () => {
    const result = await handler({ httpMethod: 'OPTIONS', headers: { origin }, queryStringParameters: {} });
    assert.equal(result.statusCode, 204);
    assert.equal(result.headers['access-control-allow-origin'], origin);
    assert.equal(result.isBase64Encoded, true);
});

test('rejects foreign origins before upstream access, including preflights and null origins', async () => {
    const { handle, calls } = fixture();
    for (const value of ['https://cloud.geoscan.ru', `${origin}.evil.test`, 'https://other.test', 'null']) {
        for (const method of ['GET', 'OPTIONS']) {
            const req = requestFor('resolve', { origin: value });
            const response = await handle(new Request(req, { method }));
            assert.equal(response.status, 403);
            assert.equal(response.headers.get('access-control-allow-origin'), null);
            assert.equal(response.headers.get('vary'), 'Origin');
        }
    }
    assert.equal(calls.length, 0);
});

test('CORS varies per response even when archive bytes are shared between allowed origins', async () => {
    const f = fixture({ allowedOrigins: [origin, 'http://localhost:43498'] });
    const first = await f.handle(requestFor('archive', { range: 'bytes=0-19' }));
    assert.equal(first.headers.get('access-control-allow-origin'), origin);
    const second = await f.handle(requestFor('archive', { origin: 'http://localhost:43498', range: 'bytes=0-19' }));
    assert.equal(second.headers.get('access-control-allow-origin'), 'http://localhost:43498');
    assert.equal(second.headers.get('x-geoscan-cache'), 'HIT');
    assert.equal(f.assets(), 1);
    const req = requestFor();
    req.headers.delete('origin');
    const serverResponse = await f.handle(req);
    assert.equal(serverResponse.status, 200);
    assert.equal(serverResponse.headers.get('access-control-allow-origin'), null);
});
