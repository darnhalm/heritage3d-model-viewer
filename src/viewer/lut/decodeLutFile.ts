/**
 * Decode LUT file bytes to string (UTF-8 default; UTF-16 if BOM present).
 * Reject likely binary LUT before parsing (null bytes in UTF-8 files are rare).
 */

export function decodeLutFileBuffer(buf: ArrayBuffer): string {
    const u8 = new Uint8Array(buf.slice(0, 4));
    if (buf.byteLength >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buf);
    }
    if (buf.byteLength >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(buf);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/** True if buffer looks like binary LUT (null bytes) — must run after UTF-16 BOM branch in loader. */
export function lutBufferLooksBinaryAfterUtf8Decode(buf: ArrayBuffer): boolean {
    const n = Math.min(buf.byteLength, 8192);
    const u8 = new Uint8Array(buf, 0, n);
    for (let i = 0; i < n; i++) {
        if (u8[i] === 0) {
            return true;
        }
    }
    return false;
}
