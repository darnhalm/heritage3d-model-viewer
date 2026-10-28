import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';

const waitForViewer = (page: Page) => page.waitForFunction(() => !!(window as any).viewer?.observer);

const pumpFrames = (page: Page, count = 8) => page.evaluate(async (n) => {
    const app = (window as any).viewer.app;
    for (let i = 0; i < n; i++) {
        app.tick(performance.now());
        // eslint-disable-next-line no-await-in-loop -- each tick represents a distinct frame
        await new Promise((resolve) => {
            setTimeout(resolve, 16);
        });
    }
}, count);

const makeLegacyArchive = async (): Promise<Buffer> => {
    const glb = await readFile(path.resolve('static/test-assets/BoxTextured.glb'));
    const tileset = {
        asset: { version: '1.1' },
        geometricError: 1,
        root: {
            boundingVolume: { box: [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2] },
            geometricError: 0,
            refine: 'REPLACE',
            content: { uri: 'Data/tile.glb' }
        }
    };

    const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await writer.add('tileset.json', new TextReader(JSON.stringify(tileset)));
    await writer.add('Data/tile.glb', new Uint8ArrayReader(glb));
    // Invalid/legacy index on purpose: this fixture covers the compatible zip.js fallback.
    await writer.add('@3dtilesIndex1@', new Uint8ArrayReader(new Uint8Array()), { level: 0 });
    return Buffer.from(await writer.close());
};

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    crcTable[i] = value >>> 0;
}

const crc32 = (data: Buffer): number => {
    let value = 0xffffffff;
    for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
    return (value ^ 0xffffffff) >>> 0;
};

interface StoredZipEntry {
    name: string;
    data: Buffer;
    offset: number;
    crc: number;
}

const localRecord = (name: string, data: Buffer, offset: number): { entry: StoredZipEntry; bytes: Buffer } => {
    const filename = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    return { entry: { name, data, offset, crc }, bytes: Buffer.concat([header, filename, data]) };
};

const centralRecord = (entry: StoredZipEntry): Buffer => {
    const filename = Buffer.from(entry.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(filename.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    return Buffer.concat([header, filename]);
};

/**
 * Minimal standards-compliant stored 3TZ with a real sorted 24-byte path index.
 *
 * @returns Archive bytes.
 */
const makeIndexedArchive = async (): Promise<Buffer> => {
    const glb = await readFile(path.resolve('static/test-assets/BoxTextured.glb'));
    const tileset = Buffer.from(JSON.stringify({
        asset: { version: '1.1' },
        geometricError: 1,
        root: {
            boundingVolume: { box: [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2] },
            geometricError: 0,
            refine: 'REPLACE',
            content: { uri: 'Data/tile.glb' }
        }
    }));
    // Keep the archive larger than the 65,557-byte EOCD suffix request so the URL test proves
    // that the reader does not download the whole file.
    const sourceEntries = [
        { name: 'tileset.json', data: tileset },
        { name: 'Data/tile.glb', data: glb },
        { name: 'Data/padding.bin', data: Buffer.alloc(512 * 1024, 0x5a) }
    ];
    const localParts: Buffer[] = [];
    const entries: StoredZipEntry[] = [];
    let offset = 0;
    for (const source of sourceEntries) {
        const record = localRecord(source.name, source.data, offset);
        localParts.push(record.bytes);
        entries.push(record.entry);
        offset += record.bytes.length;
    }

    const indexRecords = entries.map((entry) => {
        const record = Buffer.alloc(24);
        createHash('md5').update(entry.name).digest().copy(record, 0);
        record.writeBigUInt64LE(BigInt(entry.offset), 16);
        return record;
    }).sort((left, right) => {
        const leftHigh = left.readBigUInt64LE(0);
        const rightHigh = right.readBigUInt64LE(0);
        if (leftHigh !== rightHigh) return leftHigh < rightHigh ? -1 : 1;
        const leftLow = left.readBigUInt64LE(8);
        const rightLow = right.readBigUInt64LE(8);
        return leftLow === rightLow ? 0 : (leftLow < rightLow ? -1 : 1);
    });
    const indexRecord = localRecord('@3dtilesIndex1@', Buffer.concat(indexRecords), offset);
    localParts.push(indexRecord.bytes);
    entries.push(indexRecord.entry);
    offset += indexRecord.bytes.length;

    const central = Buffer.concat(entries.map(centralRecord));
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...localParts, central, eocd]);
};

const waitForFirstTile = async (page: Page) => {
    await page.waitForFunction(() => (window as any).viewer.observer.get('scene.isTileset') === true);
    await expect.poll(async () => {
        await pumpFrames(page);
        return (await page.evaluate(() => (window as any).viewer.getTileStats()?.ready ?? 0));
    }, { timeout: 30000 }).toBeGreaterThan(0);
};

test('opens a local .3tz and streams its GLB content', async ({ page }) => {
    const archive = await makeIndexedArchive();
    await page.goto('/?webgl');
    await waitForViewer(page);

    await expect(page.locator('#file')).toHaveAttribute('accept', /\.3tz/);
    await page.setInputFiles('#file', {
        name: 'fixture.3tz',
        mimeType: 'application/vnd.maxar.archive.3tz+zip',
        buffer: archive
    });
    await waitForFirstTile(page);

    const state = await page.evaluate(() => ({
        filename: (window as any).viewer.observer.get('scene.filenames')[0],
        error: (window as any).viewer.observer.get('ui.error'),
        stats: (window as any).viewer.getTileStats()
    }));
    expect(state.filename).toBe('fixture.3tz');
    expect(state.error).toBeNull();
    expect(state.stats.bytes).toBeGreaterThan(0);
    expect(state.stats.failed).toBe(0);
});

test('falls back to the ZIP central directory for a legacy archive without a valid index', async ({ page }) => {
    const archive = await makeLegacyArchive();
    await page.goto('/?webgl');
    await waitForViewer(page);
    await page.setInputFiles('#file', {
        name: 'legacy.3tz',
        mimeType: 'application/vnd.maxar.archive.3tz+zip',
        buffer: archive
    });
    await waitForFirstTile(page);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('ui.error'))).toBeNull();
});

test('opens a .3tz URL through byte range requests', async ({ page }) => {
    const archive = await makeIndexedArchive();
    const ranges: string[] = [];
    let headRequests = 0;
    await page.route('**/fixture.3tz', async (route) => {
        const request = route.request();
        const headers = request.headers();
        const common = {
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
            'content-type': 'application/vnd.maxar.archive.3tz+zip'
        };
        if (request.method() === 'HEAD') {
            headRequests++;
            await route.fulfill({ status: 200, headers: { ...common, 'content-length': String(archive.length) } });
            return;
        }
        const range = headers.range;
        if (range) {
            ranges.push(range);
            const suffix = /^bytes=-(\d+)$/.exec(range);
            const explicit = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (!suffix && !explicit) throw new Error(`Unexpected range: ${range}`);
            const start = suffix ? Math.max(0, archive.length - Number(suffix[1])) : Number(explicit![1]);
            const end = suffix ? archive.length - 1 : (explicit![2] ? Number(explicit![2]) : archive.length - 1);
            const body = archive.subarray(start, Math.min(end + 1, archive.length));
            await route.fulfill({
                status: 206,
                body,
                headers: {
                    ...common,
                    'content-length': String(body.length),
                    'content-range': `bytes ${start}-${start + body.length - 1}/${archive.length}`
                }
            });
            return;
        }
        await route.fulfill({
            status: 200,
            body: archive,
            headers: { ...common, 'content-length': String(archive.length) }
        });
    });

    await page.goto('/?webgl&load=fixture.3tz');
    await waitForViewer(page);
    await waitForFirstTile(page);

    expect(headRequests).toBe(0);
    expect(ranges[0]).toBe('bytes=-65557');
    expect(ranges).not.toContain(`bytes=0-${archive.length - 1}`);
    expect(ranges.length).toBeLessThanOrEqual(5);
    expect(await page.evaluate(() => (window as any).viewer.observer.get('ui.error'))).toBeNull();
});
