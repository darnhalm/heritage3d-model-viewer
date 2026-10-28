/**
 * Source of files referenced by a 3D Tiles tileset.
 *
 * Ordinary tilesets use HTTP URLs. Archive containers such as 3TZ expose the same logical
 * URLs, but satisfy reads from entries inside the archive. Keeping this boundary below the
 * tile tree means traversal, LOD selection and rendering do not care where a tile lives.
 */

export interface TileResourceProvider {
    /** Resolve a URI from tileset JSON against the document that contains it. */
    resolve(uri: string, baseUrl: string): string;
    /** Read one resolved resource. */
    fetch(url: string, init?: { signal?: AbortSignal }): Promise<Response>;
    /** Release readers and any in-flight archive state. */
    close?(): Promise<void> | void;
}

/** Default provider for an unpacked tileset served by HTTP or a blob URL. */
export const networkTileResourceProvider: TileResourceProvider = {
    resolve: (uri, baseUrl) => new URL(uri, baseUrl).href,
    fetch: (url, init) => fetch(url, init)
};
