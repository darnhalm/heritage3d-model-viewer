/** Serve the built viewer and the Geoscan adapter on one local origin. */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { createGeoscanHandler } from './geoscan.mjs';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT ?? 43498);
const handle = createGeoscanHandler({ allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`] });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/api/geoscan') {
            const response = await handle(new Request(url, { method: req.method, headers: req.headers }));
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
            return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
        const filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end(); return; }
        const target = (await stat(filename)).isDirectory() ? path.join(filename, 'index.html') : filename;
        const { size } = await stat(target);
        let start = 0;
        let end = size - 1;
        const headers = { 'content-type': types[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
        if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (range && (range[1] || range[2])) {
                start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
                end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            } else start = size;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
                res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return;
            }
            headers['content-range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['content-length'] = String(Math.max(0, end - start + 1));
        res.writeHead(req.headers.range ? 206 : 200, headers);
        if (req.method === 'HEAD' || !size) { res.end(); return; }
        await pipeline(createReadStream(target, { start, end }), res);
    } catch {
        if (!res.headersSent) res.writeHead(404).end();
        else res.destroy();
    }
});
server.listen(port, '127.0.0.1', () => console.log(`Viewer: http://127.0.0.1:${server.address().port}`));
