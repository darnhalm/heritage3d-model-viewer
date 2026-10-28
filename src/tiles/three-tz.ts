/** Lazy reader for a 3TZ (3D Tiles Archive) container. */

import {
    BlobReader,
    BlobWriter,
    HttpRangeReader,
    type HttpOptions,
    type Reader,
    ZipReader,
    type Entry,
    type FileEntry
} from '@zip.js/zip.js';

import type { File as ViewerFile } from '../types';
import { ThreeTzIndexReader } from './three-tz-index';
import type { TileResourceProvider } from './tile-resource';

// URL schemes must start with a letter, so the on-disk extension cannot be used verbatim.
const ARCHIVE_ORIGIN = 'threetz://archive/';

const normalizePath = (value: string): string => {
    const parts: string[] = [];
    value.replace(/\\/g, '/').split('/').forEach((part) => {
        if (!part || part === '.') return;
        if (part === '..') {
            if (parts.length === 0) throw new Error(`Недопустимый путь в 3TZ: ${value}`);
            parts.pop();
            return;
        }
        parts.push(part);
    });
    return parts.join('/');
};

const mimeTypeFor = (filename: string): string => {
    const path = filename.toLowerCase();
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.glb')) return 'model/gltf-binary';
    if (path.endsWith('.gltf')) return 'model/gltf+json';
    if (path.endsWith('.subtree')) return 'application/octet-stream';
    if (path.endsWith('.bin')) return 'application/octet-stream';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.ktx2')) return 'image/ktx2';
    return 'application/octet-stream';
};

const isFileEntry = (entry: Entry): entry is FileEntry => !entry.directory;

interface ArchiveBackend {
    readonly tilesetPath: string;
    read(path: string, signal?: AbortSignal): Promise<Blob | null>;
    close(): Promise<void>;
}

const createReader = (file: ViewerFile): Reader<unknown> => {
    const httpOptions: HttpOptions = { combineSizeEocd: true };
    return (file.blob ?
        new BlobReader(file.blob) :
        new HttpRangeReader(file.url, httpOptions)) as Reader<unknown>;
};

class IndexedArchiveBackend implements ArchiveBackend {
    readonly tilesetPath: string;

    private constructor(private readonly reader: ThreeTzIndexReader) {
        this.tilesetPath = reader.tilesetPath;
    }

    static async open(file: ViewerFile): Promise<IndexedArchiveBackend> {
        return new IndexedArchiveBackend(await ThreeTzIndexReader.open(createReader(file)));
    }

    async read(path: string, signal?: AbortSignal): Promise<Blob | null> {
        const data = await this.reader.read(path, signal);
        return data ? new Blob([Uint8Array.from(data).buffer], { type: mimeTypeFor(path) }) : null;
    }

    async close(): Promise<void> {}
}

class ZipJsArchiveBackend implements ArchiveBackend {
    readonly tilesetPath: string;

    private constructor(
        private readonly reader: ZipReader<Blob>,
        private readonly entries: Map<string, FileEntry>,
        tilesetPath: string
    ) {
        this.tilesetPath = tilesetPath;
    }

    static async open(file: ViewerFile): Promise<ZipJsArchiveBackend> {
        const reader = new ZipReader(createReader(file));
        const allEntries = await reader.getEntries();
        const entries = new Map<string, FileEntry>();
        try {
            allEntries.filter(isFileEntry).forEach((entry) => {
                const path = normalizePath(entry.filename);
                // ZIP permits duplicate names. Reject them instead of making the loaded model depend
                // on central-directory ordering.
                if (entries.has(path)) throw new Error(`В 3TZ повторяется файл: ${path}`);
                entries.set(path, entry);
            });
        } catch (err) {
            await reader.close();
            throw err;
        }

        const tilesetPath = [...entries.keys()]
        .filter(path => path.toLowerCase() === 'tileset.json' || path.toLowerCase().endsWith('/tileset.json'))
        .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0];
        if (!tilesetPath) {
            await reader.close();
            throw new Error('В архиве 3TZ отсутствует tileset.json.');
        }
        return new ZipJsArchiveBackend(reader, entries, tilesetPath);
    }

    read(path: string, signal?: AbortSignal): Promise<Blob | null> {
        const entry = this.entries.get(path);
        return entry ? entry.getData(new BlobWriter(mimeTypeFor(path)), { signal }) : Promise.resolve(null);
    }

    async close(): Promise<void> {
        await this.reader.close();
    }
}

/**
 * Makes files in one archive look like an ordinary URL hierarchy to TileManager.
 * Entries are decompressed only when selected by the LOD traversal.
 */
export class ThreeTzResourceProvider implements TileResourceProvider {
    readonly tilesetUrl: string;

    private constructor(
        private readonly backend: ArchiveBackend
    ) {
        this.tilesetUrl = new URL(backend.tilesetPath, ARCHIVE_ORIGIN).href;
    }

    static async open(file: ViewerFile): Promise<ThreeTzResourceProvider> {
        let indexedError: unknown;
        try {
            return new ThreeTzResourceProvider(await IndexedArchiveBackend.open(file));
        } catch (err) {
            indexedError = err;
        }

        try {
            return new ThreeTzResourceProvider(await ZipJsArchiveBackend.open(file));
        } catch (err) {
            const indexedDetail = indexedError instanceof Error ? indexedError.message : String(indexedError);
            const fallbackDetail = err instanceof Error ? err.message : String(err);
            throw new Error('Не удалось открыть 3TZ. Для URL сервер должен поддерживать HTTP Range и CORS. ' +
                `Быстрый индекс: ${indexedDetail} ZIP fallback: ${fallbackDetail}`);
        }
    }

    resolve(uri: string, baseUrl: string): string {
        return new URL(uri, baseUrl).href;
    }

    async fetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
        const parsed = new URL(url);
        if (parsed.protocol !== 'threetz:') {
            return fetch(url, init);
        }

        const path = normalizePath(decodeURIComponent(parsed.pathname.replace(/^\//, '')));
        const blob = await this.backend.read(path, init?.signal);
        if (!blob) {
            return new Response(`Файл отсутствует в 3TZ: ${path}`, { status: 404 });
        }
        return new Response(blob, {
            status: 200,
            headers: {
                'content-type': mimeTypeFor(path),
                'content-length': String(blob.size)
            }
        });
    }

    async close(): Promise<void> {
        await this.backend.close();
    }
}
