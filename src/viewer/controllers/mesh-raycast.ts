import { MeshInstance, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, Vec3 } from 'playcanvas';

type CachedMeshGeometry = {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array | null;
    vertexCount: number;
    primitives: Array<{
        base: number;
        count: number;
        baseVertex: number;
        indexed: boolean;
    }>;
};

type MeshLike = object & {
    primitive?: Array<{ type?: number; base?: number; count?: number; indexed?: boolean; baseVertex?: number }>;
    vertexBuffer?: { getNumVertices?: () => number; numVertices?: number };
    indexBuffer?: Array<{ numIndices?: number }>;
    getVertexStream?: (semantic: string, data: Float32Array) => number;
    getIndices?: (data: Uint16Array | Uint32Array) => number;
};

const getCachedMeshGeometry = (mi: MeshInstance, cache: WeakMap<object, CachedMeshGeometry | null>) => {
    const mesh = mi.mesh as MeshLike;
    if (!mesh) return null;

    const cached = cache.get(mesh);
    if (cached !== undefined) return cached;

    const primitives = (mesh.primitive ?? [])
    .filter(primitive => primitive?.type === PRIMITIVE_TRIANGLES)
    .map(primitive => ({
        base: Math.max(0, primitive.base ?? 0),
        count: Math.max(0, primitive.count ?? 0),
        baseVertex: primitive.baseVertex ?? 0,
        indexed: Boolean(primitive.indexed)
    }))
    .filter(primitive => primitive.count >= 3);
    const vertexCount = mesh.vertexBuffer?.getNumVertices?.() ?? mesh.vertexBuffer?.numVertices ?? 0;
    if (primitives.length === 0 || vertexCount <= 0 || !mesh.getVertexStream) {
        cache.set(mesh, null);
        return null;
    }

    const positions = new Float32Array(vertexCount * 3);
    if (mesh.getVertexStream(SEMANTIC_POSITION, positions) <= 0) {
        cache.set(mesh, null);
        return null;
    }

    let indices: Uint16Array | Uint32Array | null = null;
    if (primitives.some(primitive => primitive.indexed)) {
        const totalIndexCount = mesh.indexBuffer?.[0]?.numIndices ?? Math.max(...primitives.map(primitive => primitive.base + primitive.count));
        if (!totalIndexCount || !mesh.getIndices) {
            cache.set(mesh, null);
            return null;
        }
        indices = vertexCount > 65535 ? new Uint32Array(totalIndexCount) : new Uint16Array(totalIndexCount);
        if (mesh.getIndices(indices) <= 0) {
            cache.set(mesh, null);
            return null;
        }
    }

    const geometry = { positions, indices, vertexCount, primitives } satisfies CachedMeshGeometry;
    cache.set(mesh, geometry);
    return geometry;
};

const intersectTriangle = (origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3) => {
    const epsilon = 1e-8;
    const edge1 = new Vec3().sub2(b, a);
    const edge2 = new Vec3().sub2(c, a);
    const pvec = new Vec3().cross(direction, edge2);
    const det = edge1.dot(pvec);
    if (Math.abs(det) < epsilon) return null;

    const invDet = 1 / det;
    const tvec = new Vec3().sub2(origin, a);
    const u = tvec.dot(pvec) * invDet;
    if (u < 0 || u > 1) return null;

    const qvec = new Vec3().cross(tvec, edge1);
    const v = direction.dot(qvec) * invDet;
    if (v < 0 || u + v > 1) return null;

    const t = edge2.dot(qvec) * invDet;
    return t >= 0 ? t : null;
};

const intersectMeshTriangles = (
    mi: MeshInstance,
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    cache: WeakMap<object, CachedMeshGeometry | null>
) => {
    const geometry = getCachedMeshGeometry(mi, cache);
    if (!geometry) return null;

    const world = mi.node?.getWorldTransform();
    if (!world) return null;

    let bestT = Number.POSITIVE_INFINITY;
    const p0 = new Vec3();
    const p1 = new Vec3();
    const p2 = new Vec3();

    geometry.primitives.forEach((primitive) => {
        if (primitive.indexed && !geometry.indices) return;
        for (let i = primitive.base; i + 2 < primitive.base + primitive.count; i += 3) {
            const i0 = ((primitive.indexed ? geometry.indices?.[i] : i) ?? i) + primitive.baseVertex;
            const i1 = ((primitive.indexed ? geometry.indices?.[i + 1] : i + 1) ?? (i + 1)) + primitive.baseVertex;
            const i2 = ((primitive.indexed ? geometry.indices?.[i + 2] : i + 2) ?? (i + 2)) + primitive.baseVertex;
            if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= geometry.vertexCount || i1 >= geometry.vertexCount || i2 >= geometry.vertexCount) continue;

            p0.set(geometry.positions[i0 * 3], geometry.positions[i0 * 3 + 1], geometry.positions[i0 * 3 + 2]);
            p1.set(geometry.positions[i1 * 3], geometry.positions[i1 * 3 + 1], geometry.positions[i1 * 3 + 2]);
            p2.set(geometry.positions[i2 * 3], geometry.positions[i2 * 3 + 1], geometry.positions[i2 * 3 + 2]);
            world.transformPoint(p0, p0);
            world.transformPoint(p1, p1);
            world.transformPoint(p2, p2);

            const t = intersectTriangle(origin, direction, p0, p1, p2);
            if (t == null || t > maxDistance || t >= bestT) continue;
            bestT = t;
        }
    });

    return Number.isFinite(bestT) ? bestT : null;
};

export { getCachedMeshGeometry, intersectMeshTriangles };
export type { CachedMeshGeometry };
