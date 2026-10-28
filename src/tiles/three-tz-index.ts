/** Random-access reader for the @3dtilesIndex1@ fast path. */

import type { Reader } from '@zip.js/zip.js';

const INDEX_FILENAME = '@3dtilesIndex1@';
const ROOT_TILESET = 'tileset.json';

const SIGNATURE_LOCAL_FILE = 0x04034b50;
const SIGNATURE_CENTRAL_FILE = 0x02014b50;
const SIGNATURE_EOCD = 0x06054b50;
const SIGNATURE_ZIP64_EOCD = 0x06064b50;
const SIGNATURE_ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;

const EOCD_MIN_SIZE = 22;
const EOCD_SEARCH_SIZE = 65557;
const CENTRAL_FILE_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_SIZE = 30;
const LOCAL_ENTRY_PROBE_SIZE = 64 * 1024;
const CENTRAL_TAIL_SIZE = 64 * 1024;
const INDEX_RECORD_SIZE = 24;
const MAX_INDEX_SIZE = 128 * 1024 * 1024;
const UINT32_MAX = 0xffffffff;
const RANGE_BLOCK_SIZE = 256 * 1024;
const MAX_RANGE_BLOCKS = 64;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const throwIfAborted = (signal?: AbortSignal): void => {
    if (!signal?.aborted) return;
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
};

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const readUint64 = (view: DataView, offset: number, label: string): number => {
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    if (high > 0x1fffff) throw new Error(`${label} выходит за безопасный диапазон JavaScript.`);
    return high * 0x100000000 + low;
};

const decodeFilename = (bytes: Uint8Array): string => textDecoder.decode(bytes).replace(/\\/g, '/').replace(/^\/+/, '');

interface Zip64Values {
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
}

const readZip64Values = (
    extra: Uint8Array,
    compressedSize32: number,
    uncompressedSize32: number,
    localHeaderOffset32: number
): Zip64Values => {
    let compressedSize = compressedSize32;
    let uncompressedSize = uncompressedSize32;
    let localHeaderOffset = localHeaderOffset32;
    const view = viewOf(extra);
    let cursor = 0;

    while (cursor + 4 <= extra.length) {
        const type = view.getUint16(cursor, true);
        const size = view.getUint16(cursor + 2, true);
        const start = cursor + 4;
        const end = start + size;
        if (end > extra.length) throw new Error('Повреждено дополнительное поле ZIP.');
        if (type === ZIP64_EXTRA_FIELD) {
            let valueOffset = start;
            if (uncompressedSize32 === UINT32_MAX) {
                if (valueOffset + 8 > end) throw new Error('В ZIP64 отсутствует распакованный размер.');
                uncompressedSize = readUint64(view, valueOffset, 'Размер записи ZIP64');
                valueOffset += 8;
            }
            if (compressedSize32 === UINT32_MAX) {
                if (valueOffset + 8 > end) throw new Error('В ZIP64 отсутствует сжатый размер.');
                compressedSize = readUint64(view, valueOffset, 'Сжатый размер записи ZIP64');
                valueOffset += 8;
            }
            if (localHeaderOffset32 === UINT32_MAX) {
                if (valueOffset + 8 > end) throw new Error('В ZIP64 отсутствует смещение записи.');
                localHeaderOffset = readUint64(view, valueOffset, 'Смещение записи ZIP64');
            }
            break;
        }
        cursor = end;
    }

    if (compressedSize === UINT32_MAX || uncompressedSize === UINT32_MAX || localHeaderOffset === UINT32_MAX) {
        throw new Error('В записи ZIP64 отсутствует обязательное дополнительное поле.');
    }
    return { compressedSize, uncompressedSize, localHeaderOffset };
};

const md5Shifts = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]);
const md5Constants = new Int32Array(64);
for (let i = 0; i < md5Constants.length; i++) {
    md5Constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
}

const rotateLeft = (value: number, bits: number): number => (value << bits) | (value >>> (32 - bits));

const md5 = (input: Uint8Array): Uint8Array => {
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;
    const paddedView = viewOf(padded);
    const bitLength = input.length * 8;
    paddedView.setUint32(paddedLength - 8, bitLength >>> 0, true);
    paddedView.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let stateA = 0x67452301 | 0;
    let stateB = 0xefcdab89 | 0;
    let stateC = 0x98badcfe | 0;
    let stateD = 0x10325476 | 0;

    for (let block = 0; block < paddedLength; block += 64) {
        let a = stateA;
        let b = stateB;
        let c = stateC;
        let d = stateD;

        for (let i = 0; i < 64; i++) {
            let f: number;
            let word: number;
            if (i < 16) {
                f = (b & c) | (~b & d);
                word = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                word = (5 * i + 1) & 15;
            } else if (i < 48) {
                f = b ^ c ^ d;
                word = (3 * i + 5) & 15;
            } else {
                f = c ^ (b | ~d);
                word = (7 * i) & 15;
            }
            const sum = (a + f + md5Constants[i] + paddedView.getInt32(block + word * 4, true)) | 0;
            const previousD = d;
            d = c;
            c = b;
            b = (b + rotateLeft(sum, md5Shifts[i])) | 0;
            a = previousD;
        }

        stateA = (stateA + a) | 0;
        stateB = (stateB + b) | 0;
        stateC = (stateC + c) | 0;
        stateD = (stateD + d) | 0;
    }

    const result = new Uint8Array(16);
    const resultView = viewOf(result);
    resultView.setInt32(0, stateA, true);
    resultView.setInt32(4, stateB, true);
    resultView.setInt32(8, stateC, true);
    resultView.setInt32(12, stateD, true);
    return result;
};

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    crcTable[i] = value >>> 0;
}

const crc32 = (bytes: Uint8Array): number => {
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
    return (value ^ 0xffffffff) >>> 0;
};

const compareHash = (indexView: DataView, offset: number, hashView: DataView): number => {
    for (const pairOffset of [0, 8]) {
        const indexUpper = indexView.getUint32(offset + pairOffset + 4, true);
        const hashUpper = hashView.getUint32(pairOffset + 4, true);
        if (indexUpper !== hashUpper) return indexUpper < hashUpper ? -1 : 1;
        const indexLower = indexView.getUint32(offset + pairOffset, true);
        const hashLower = hashView.getUint32(pairOffset, true);
        if (indexLower !== hashLower) return indexLower < hashLower ? -1 : 1;
    }
    return 0;
};

const inflateRaw = async (compressed: Uint8Array, expectedSize: number): Promise<Uint8Array> => {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Этот браузер не поддерживает распаковку Deflate для быстрого 3TZ reader.');
    }
    const stream = new Blob([Uint8Array.from(compressed).buffer]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (result.length !== expectedSize) {
        throw new Error(`Неверный распакованный размер записи 3TZ: ${result.length} вместо ${expectedSize}.`);
    }
    return result;
};

interface IndexedEntry {
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    crc: number;
    dataOffset: number;
    prefetchedData: Uint8Array;
}

interface CentralDirectoryInfo {
    offset: number;
    size: number;
}

interface RandomAccessReader {
    readonly size: number;
    readUint8Array(index: number, length: number): Promise<Uint8Array>;
}

/** Coalesces overlapping and adjacent range reads while keeping at most 16 MB of source bytes. */
class BlockCacheReader implements RandomAccessReader {
    readonly size: number;

    private readonly blocks = new Map<number, Promise<Uint8Array>>();

    constructor(private readonly source: RandomAccessReader) {
        this.size = source.size;
    }

    async readUint8Array(index: number, length: number): Promise<Uint8Array> {
        if (length <= 0 || index >= this.size) return new Uint8Array();
        const actualLength = Math.min(length, this.size - index);
        // HttpRangeReader already retains the EOCD suffix obtained while discovering the size.
        // Preserve that zero-request path instead of replacing it with a larger aligned block.
        if (index >= this.size - EOCD_SEARCH_SIZE) {
            return this.source.readUint8Array(index, actualLength);
        }

        const firstBlock = Math.floor(index / RANGE_BLOCK_SIZE);
        const lastBlock = Math.floor((index + actualLength - 1) / RANGE_BLOCK_SIZE);
        let block = firstBlock;
        while (block <= lastBlock) {
            if (this.blocks.has(block)) {
                this.touch(block);
                block++;
                continue;
            }
            const runStart = block;
            while (block <= lastBlock && !this.blocks.has(block)) block++;
            const runEnd = block - 1;
            const byteStart = runStart * RANGE_BLOCK_SIZE;
            const byteEnd = Math.min(this.size, (runEnd + 1) * RANGE_BLOCK_SIZE);
            const run = this.source.readUint8Array(byteStart, byteEnd - byteStart);
            for (let current = runStart; current <= runEnd; current++) {
                const relativeStart = (current - runStart) * RANGE_BLOCK_SIZE;
                const relativeEnd = Math.min(byteEnd - byteStart, relativeStart + RANGE_BLOCK_SIZE);
                this.blocks.set(current, run.then(bytes => bytes.slice(relativeStart, relativeEnd)));
            }
        }

        const output = new Uint8Array(actualLength);
        const requestedBlocks: Array<{ block: number; promise: Promise<Uint8Array> }> = [];
        for (let current = firstBlock; current <= lastBlock; current++) {
            requestedBlocks.push({ block: current, promise: this.blocks.get(current)! });
        }
        let written = 0;
        for (const requested of requestedBlocks) {
            // eslint-disable-next-line no-await-in-loop -- block order defines the output byte order
            const bytes = await requested.promise;
            const blockStart = requested.block * RANGE_BLOCK_SIZE;
            const from = Math.max(index, blockStart) - blockStart;
            const to = Math.min(index + actualLength, blockStart + bytes.length) - blockStart;
            output.set(bytes.subarray(from, to), written);
            written += to - from;
        }
        this.trim();
        return output;
    }

    private touch(block: number): void {
        const value = this.blocks.get(block);
        if (!value) return;
        this.blocks.delete(block);
        this.blocks.set(block, value);
    }

    private trim(): void {
        while (this.blocks.size > MAX_RANGE_BLOCKS) {
            const oldest = this.blocks.keys().next().value as number | undefined;
            if (oldest === undefined) break;
            this.blocks.delete(oldest);
        }
    }
}

/**
 * Reads only the standard 3TZ index and requested local entries. It deliberately does not scan
 * the complete ZIP Central Directory.
 */
export class ThreeTzIndexReader {
    readonly tilesetPath = ROOT_TILESET;

    private readonly entryCache = new Map<string, Promise<IndexedEntry | null>>();

    private readonly dataCache = new Map<string, Uint8Array>();

    private constructor(
        private readonly source: RandomAccessReader,
        private readonly index: Uint8Array
    ) {}

    static async open(source: Reader<unknown>): Promise<ThreeTzIndexReader> {
        await source.init?.();
        if (!Number.isFinite(source.size) || source.size < EOCD_MIN_SIZE) {
            throw new Error('3TZ слишком мал или не сообщает размер.');
        }

        const cachedSource = new BlockCacheReader(source);
        const centralDirectory = await ThreeTzIndexReader.readCentralDirectoryInfo(cachedSource);
        const indexEntry = await ThreeTzIndexReader.readLastCentralEntry(cachedSource, centralDirectory);
        if (indexEntry.filename !== INDEX_FILENAME) {
            throw new Error(`Последняя запись 3TZ — не ${INDEX_FILENAME}.`);
        }
        if (indexEntry.compressionMethod !== 0 || indexEntry.compressedSize !== indexEntry.uncompressedSize) {
            throw new Error(`${INDEX_FILENAME} должен храниться без сжатия.`);
        }
        if (indexEntry.uncompressedSize <= 0 || indexEntry.uncompressedSize > MAX_INDEX_SIZE ||
            indexEntry.uncompressedSize % INDEX_RECORD_SIZE !== 0) {
            throw new Error(`Некорректный размер ${INDEX_FILENAME}: ${indexEntry.uncompressedSize}.`);
        }

        const temporary = new ThreeTzIndexReader(cachedSource, new Uint8Array());
        const localIndexEntry = await temporary.readLocalEntry(indexEntry.localHeaderOffset, INDEX_FILENAME);
        if (!localIndexEntry) throw new Error(`Local File Header ${INDEX_FILENAME} не совпадает с индексом.`);
        const index = await temporary.readEntryData(localIndexEntry);
        const reader = new ThreeTzIndexReader(cachedSource, index);
        const rootEntry = await reader.findEntry(ROOT_TILESET);
        if (!rootEntry) throw new Error(`В индексе 3TZ отсутствует ${ROOT_TILESET}.`);
        reader.entryCache.set(ROOT_TILESET, Promise.resolve(rootEntry));
        return reader;
    }

    async read(path: string, signal?: AbortSignal): Promise<Uint8Array | null> {
        throwIfAborted(signal);
        const cached = this.dataCache.get(path);
        if (cached) return cached;

        let promise = this.entryCache.get(path);
        if (!promise) {
            promise = this.findEntry(path);
            this.entryCache.set(path, promise);
        }
        const entry = await promise;
        throwIfAborted(signal);
        if (!entry) return null;
        const data = await this.readEntryData(entry, signal);
        if (path === ROOT_TILESET) this.dataCache.set(path, data);
        return data;
    }

    private static async readCentralDirectoryInfo(source: RandomAccessReader): Promise<CentralDirectoryInfo> {
        const tailLength = Math.min(source.size, EOCD_SEARCH_SIZE);
        const tailOffset = source.size - tailLength;
        const tail = await source.readUint8Array(tailOffset, tailLength);
        const view = viewOf(tail);
        let eocd = -1;
        for (let offset = tail.length - EOCD_MIN_SIZE; offset >= 0; offset--) {
            if (view.getUint32(offset, true) !== SIGNATURE_EOCD) continue;
            const commentLength = view.getUint16(offset + 20, true);
            if (offset + EOCD_MIN_SIZE + commentLength === tail.length) {
                eocd = offset;
                break;
            }
        }
        if (eocd < 0) throw new Error('В 3TZ не найден конец Central Directory.');

        const size32 = view.getUint32(eocd + 12, true);
        const offset32 = view.getUint32(eocd + 16, true);
        if (size32 !== UINT32_MAX && offset32 !== UINT32_MAX) return { offset: offset32, size: size32 };

        const absoluteEocd = tailOffset + eocd;
        const locatorOffset = absoluteEocd - 20;
        if (locatorOffset < 0) throw new Error('В ZIP64 отсутствует locator.');
        const locator = locatorOffset >= tailOffset ?
            tail.subarray(locatorOffset - tailOffset, locatorOffset - tailOffset + 20) :
            await source.readUint8Array(locatorOffset, 20);
        const locatorView = viewOf(locator);
        if (locator.length < 20 || locatorView.getUint32(0, true) !== SIGNATURE_ZIP64_LOCATOR) {
            throw new Error('В ZIP64 не найден locator.');
        }
        const zip64Offset = readUint64(locatorView, 8, 'Смещение ZIP64 EOCD');
        const zip64 = await source.readUint8Array(zip64Offset, 56);
        const zip64View = viewOf(zip64);
        if (zip64.length < 56 || zip64View.getUint32(0, true) !== SIGNATURE_ZIP64_EOCD) {
            throw new Error('В ZIP64 не найден EOCD.');
        }
        return {
            size: readUint64(zip64View, 40, 'Размер Central Directory ZIP64'),
            offset: readUint64(zip64View, 48, 'Смещение Central Directory ZIP64')
        };
    }

    private static async readLastCentralEntry(source: RandomAccessReader, central: CentralDirectoryInfo): Promise<{
        filename: string;
        compressionMethod: number;
        compressedSize: number;
        uncompressedSize: number;
        localHeaderOffset: number;
    }> {
        if (central.size < CENTRAL_FILE_HEADER_SIZE || central.offset + central.size > source.size) {
            throw new Error('Central Directory 3TZ выходит за границы файла.');
        }
        const length = Math.min(central.size, CENTRAL_TAIL_SIZE);
        const bytes = await source.readUint8Array(central.offset + central.size - length, length);
        const view = viewOf(bytes);

        for (let offset = bytes.length - CENTRAL_FILE_HEADER_SIZE; offset >= 0; offset--) {
            if (view.getUint32(offset, true) !== SIGNATURE_CENTRAL_FILE) continue;
            const filenameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const end = offset + CENTRAL_FILE_HEADER_SIZE + filenameLength + extraLength + commentLength;
            if (end !== bytes.length) continue;

            const filenameStart = offset + CENTRAL_FILE_HEADER_SIZE;
            const filename = decodeFilename(bytes.subarray(filenameStart, filenameStart + filenameLength));
            const extra = bytes.subarray(filenameStart + filenameLength, filenameStart + filenameLength + extraLength);
            const values = readZip64Values(
                extra,
                view.getUint32(offset + 20, true),
                view.getUint32(offset + 24, true),
                view.getUint32(offset + 42, true)
            );
            return {
                filename,
                compressionMethod: view.getUint16(offset + 10, true),
                ...values
            };
        }
        throw new Error('Не найдена последняя запись Central Directory 3TZ.');
    }

    private async findEntry(path: string): Promise<IndexedEntry | null> {
        const hash = md5(textEncoder.encode(path));
        const hashView = viewOf(hash);
        const indexView = viewOf(this.index);
        const count = this.index.length / INDEX_RECORD_SIZE;
        let low = 0;
        let high = count;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const comparison = compareHash(indexView, middle * INDEX_RECORD_SIZE, hashView);
            if (comparison < 0) low = middle + 1;
            else high = middle;
        }

        for (let record = low; record < count; record++) {
            const recordOffset = record * INDEX_RECORD_SIZE;
            if (compareHash(indexView, recordOffset, hashView) !== 0) break;
            const localHeaderOffset = readUint64(indexView, recordOffset + 16, 'Смещение файла в индексе 3TZ');
            // Hash collisions are adjacent, so each candidate header must be verified in order.
            // eslint-disable-next-line no-await-in-loop
            const entry = await this.readLocalEntry(localHeaderOffset, path);
            if (entry) return entry;
        }
        return null;
    }

    private async readLocalEntry(offset: number, expectedPath: string): Promise<IndexedEntry | null> {
        if (offset < 0 || offset + LOCAL_FILE_HEADER_SIZE > this.source.size) {
            throw new Error(`Смещение ${expectedPath} выходит за границы 3TZ.`);
        }
        const probeLength = Math.min(LOCAL_ENTRY_PROBE_SIZE, this.source.size - offset);
        const probe = await this.source.readUint8Array(offset, probeLength);
        if (probe.length < LOCAL_FILE_HEADER_SIZE) throw new Error(`Повреждён Local File Header: ${expectedPath}.`);
        const view = viewOf(probe);
        if (view.getUint32(0, true) !== SIGNATURE_LOCAL_FILE) {
            throw new Error(`Не найден Local File Header: ${expectedPath}.`);
        }

        const flags = view.getUint16(6, true);
        if (flags & 1) throw new Error(`Зашифрованные записи 3TZ не поддерживаются: ${expectedPath}.`);
        const filenameLength = view.getUint16(26, true);
        const extraLength = view.getUint16(28, true);
        const dataOffsetInProbe = LOCAL_FILE_HEADER_SIZE + filenameLength + extraLength;
        if (dataOffsetInProbe > probe.length) {
            throw new Error(`Слишком длинный Local File Header: ${expectedPath}.`);
        }
        const filename = decodeFilename(probe.subarray(LOCAL_FILE_HEADER_SIZE, LOCAL_FILE_HEADER_SIZE + filenameLength));
        if (filename !== expectedPath) return null;

        const compressedSize32 = view.getUint32(18, true);
        const uncompressedSize32 = view.getUint32(22, true);
        const extra = probe.subarray(LOCAL_FILE_HEADER_SIZE + filenameLength, dataOffsetInProbe);
        const values = readZip64Values(extra, compressedSize32, uncompressedSize32, 0);
        if (offset + dataOffsetInProbe + values.compressedSize > this.source.size) {
            throw new Error(`Данные ${expectedPath} выходят за границы 3TZ.`);
        }
        return {
            compressionMethod: view.getUint16(8, true),
            compressedSize: values.compressedSize,
            uncompressedSize: values.uncompressedSize,
            crc: view.getUint32(14, true),
            dataOffset: offset + dataOffsetInProbe,
            prefetchedData: probe.subarray(dataOffsetInProbe, Math.min(probe.length, dataOffsetInProbe + values.compressedSize))
        };
    }

    private async readEntryData(entry: IndexedEntry, signal?: AbortSignal): Promise<Uint8Array> {
        throwIfAborted(signal);
        let compressed: Uint8Array;
        if (entry.prefetchedData.length === entry.compressedSize) {
            compressed = entry.prefetchedData;
        } else {
            compressed = new Uint8Array(entry.compressedSize);
            compressed.set(entry.prefetchedData);
            const remaining = await this.source.readUint8Array(
                entry.dataOffset + entry.prefetchedData.length,
                entry.compressedSize - entry.prefetchedData.length
            );
            compressed.set(remaining, entry.prefetchedData.length);
        }
        throwIfAborted(signal);

        let result: Uint8Array;
        if (entry.compressionMethod === 0) {
            if (compressed.length !== entry.uncompressedSize) {
                throw new Error('Неверный размер несжатой записи 3TZ.');
            }
            result = compressed;
        } else if (entry.compressionMethod === 8) {
            result = await inflateRaw(compressed, entry.uncompressedSize);
        } else {
            throw new Error(`Метод сжатия ZIP ${entry.compressionMethod} пока не поддерживается быстрым 3TZ reader.`);
        }
        if (crc32(result) !== entry.crc) throw new Error('Контрольная сумма записи 3TZ не совпадает.');
        return result;
    }
}
