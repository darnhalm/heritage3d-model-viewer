import { Observer } from '@playcanvas/observer';
import {
    GraphNode,
    Mat4,
    math,
    MeshInstance,
    PRIMITIVE_TRIANGLES,
    SEMANTIC_POSITION,
    ShaderMaterial,
    Vec3
} from 'playcanvas';

import { Picker } from '../../picker';

const SELECT_CLICK_DRAG_THRESHOLD = 5;
const FLASH_DURATION_MS = 500;
const FLASH_COLOR: [number, number, number] = [0.224, 1.0, 0.078];

type CachedMeshGeometry = {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array | null;
    vertexCount: number;
    primitiveBase: number;
    primitiveCount: number;
    baseVertex: number;
};

type SelectionControllerArgs = {
    canvas: HTMLCanvasElement;
    observer: Observer;
    picker: Picker;
    selectionHighlightMaterial: ShaderMaterial;
    getMeshInstances: () => Array<MeshInstance>;
    getCameraPosition: () => Vec3;
    getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };
    getSelectedNode: () => GraphNode | null;
    setSelectedNodePath: (path: string) => void;
    resetSelectionHighlightMeshes: () => void;
    renderNextFrame: () => void;
};

class SelectionController {
    private canvas: HTMLCanvasElement;

    private observer: Observer;

    private picker: Picker;

    private selectionHighlightMaterial: ShaderMaterial;

    private getMeshInstances: () => Array<MeshInstance>;

    private getCameraPosition: () => Vec3;

    private getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };

    private getSelectedNode: () => GraphNode | null;

    private setSelectedNodePath: (path: string) => void;

    private resetSelectionHighlightMeshes: () => void;

    private renderNextFrame: () => void;

    private selectClickDown: { clientX: number; clientY: number; canvasX: number; canvasY: number } | null = null;

    private selectIsPotentialClick = false;

    private selectionFlashStartMs = 0;

    private selectionFlashRaf: number | null = null;

    private meshGeometryCache = new WeakMap<object, CachedMeshGeometry | null>();

    constructor(args: SelectionControllerArgs) {
        this.canvas = args.canvas;
        this.observer = args.observer;
        this.picker = args.picker;
        this.selectionHighlightMaterial = args.selectionHighlightMaterial;
        this.getMeshInstances = args.getMeshInstances;
        this.getCameraPosition = args.getCameraPosition;
        this.getPickRay = args.getPickRay;
        this.getSelectedNode = args.getSelectedNode;
        this.setSelectedNodePath = args.setSelectedNodePath;
        this.resetSelectionHighlightMeshes = args.resetSelectionHighlightMeshes;
        this.renderNextFrame = args.renderNextFrame;
        this.bindEvents();
    }

    private bindEvents() {
        const onSelectMousedown = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (event.target !== this.canvas) return;
            if (!this.observer.get('debug.withTextureOnly')) return;
            if (this.observer.get('measure.enabled')) return;
            const rect = this.canvas.getBoundingClientRect();
            this.selectClickDown = {
                clientX: event.clientX,
                clientY: event.clientY,
                canvasX: event.clientX - rect.left,
                canvasY: event.clientY - rect.top
            };
            this.selectIsPotentialClick = true;
        };
        const onSelectMousemove = (event: MouseEvent) => {
            if (!this.selectIsPotentialClick || !this.selectClickDown) return;
            const dx = event.clientX - this.selectClickDown.clientX;
            const dy = event.clientY - this.selectClickDown.clientY;
            if (Math.hypot(dx, dy) > SELECT_CLICK_DRAG_THRESHOLD) {
                this.selectIsPotentialClick = false;
            }
        };
        const onSelectMouseup = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (this.selectIsPotentialClick && this.selectClickDown && this.observer.get('debug.withTextureOnly') && !this.observer.get('measure.enabled')) {
                this.pickAndSelectAt(this.selectClickDown.canvasX, this.selectClickDown.canvasY);
            }
            this.selectIsPotentialClick = false;
            this.selectClickDown = null;
        };
        this.canvas.addEventListener('mousedown', onSelectMousedown);
        document.addEventListener('mousemove', onSelectMousemove);
        document.addEventListener('mouseup', onSelectMouseup);
    }

    private selectNodeAtPoint(worldPoint: Vec3) {
        let bestNode: GraphNode | null = null;
        let bestDistanceSq = Number.POSITIVE_INFINITY;
        let bestVolume = Number.POSITIVE_INFINITY;
        let bestDepthSq = Number.POSITIVE_INFINITY;

        const localPoint = new Vec3();
        const invWorld = new Mat4();
        const cameraPos = this.getCameraPosition();

        this.getMeshInstances().forEach((mi) => {
            const node = mi.node;
            if (!node) return;

            const meshAabb = mi.mesh?.aabb;
            if (meshAabb) {
                invWorld.copy(node.getWorldTransform()).invert();
                invWorld.transformPoint(worldPoint, localPoint);

                const min = meshAabb.getMin();
                const max = meshAabb.getMax();
                const cx = math.clamp(localPoint.x, min.x, max.x);
                const cy = math.clamp(localPoint.y, min.y, max.y);
                const cz = math.clamp(localPoint.z, min.z, max.z);
                const dx = localPoint.x - cx;
                const dy = localPoint.y - cy;
                const dz = localPoint.z - cz;
                const distanceSq = dx * dx + dy * dy + dz * dz;

                const he = meshAabb.halfExtents;
                const volume = (he.x * 2) * (he.y * 2) * (he.z * 2);
                const dcx = cameraPos.x - mi.aabb.center.x;
                const dcy = cameraPos.y - mi.aabb.center.y;
                const dcz = cameraPos.z - mi.aabb.center.z;
                const depthSq = dcx * dcx + dcy * dcy + dcz * dcz;

                const betterDistance = distanceSq < bestDistanceSq - 1e-8;
                const equalDistance = Math.abs(distanceSq - bestDistanceSq) <= 1e-8;
                const betterDepth = equalDistance && depthSq < bestDepthSq - 1e-8;
                const equalDepth = equalDistance && Math.abs(depthSq - bestDepthSq) <= 1e-8;
                const betterVolume = equalDepth && volume < bestVolume;

                if (betterDistance || betterDepth || betterVolume) {
                    bestDistanceSq = distanceSq;
                    bestVolume = volume;
                    bestDepthSq = depthSq;
                    bestNode = node;
                }
                return;
            }

            const aabb = mi.aabb;
            if (!aabb) return;
            const min = aabb.getMin();
            const max = aabb.getMax();
            const cx = math.clamp(worldPoint.x, min.x, max.x);
            const cy = math.clamp(worldPoint.y, min.y, max.y);
            const cz = math.clamp(worldPoint.z, min.z, max.z);
            const dx = worldPoint.x - cx;
            const dy = worldPoint.y - cy;
            const dz = worldPoint.z - cz;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            const dcx = cameraPos.x - aabb.center.x;
            const dcy = cameraPos.y - aabb.center.y;
            const dcz = cameraPos.z - aabb.center.z;
            const depthSq = dcx * dcx + dcy * dcy + dcz * dcz;

            if (distanceSq < bestDistanceSq || (Math.abs(distanceSq - bestDistanceSq) <= 1e-8 && depthSq < bestDepthSq)) {
                bestDistanceSq = distanceSq;
                bestDepthSq = depthSq;
                bestNode = node;
            }
        });

        if (bestNode) {
            this.setSelectedNodePath(bestNode.path);
        }
    }

    private async pickAndSelectAt(x: number, y: number) {
        const rayHit = this.selectNodeByRay(x, y);
        if (rayHit) {
            return;
        }

        const p = await this.picker.pick(x, y);
        if (!p) return;
        this.selectNodeAtPoint(p);
    }

    private selectNodeByRay(x: number, y: number) {
        const { origin, direction } = this.getPickRay(x, y);
        let bestNode: GraphNode | null = null;
        let bestT = Number.POSITIVE_INFINITY;
        let bestVolume = Number.POSITIVE_INFINITY;

        this.getMeshInstances().forEach((mi) => {
            const aabb = mi.aabb;
            const node = mi.node;
            if (!aabb || !node) return;

            const min = aabb.getMin();
            const max = aabb.getMax();

            let tMin = -Infinity;
            let tMax = Infinity;

            const testAxis = (originValue: number, dirValue: number, minValue: number, maxValue: number) => {
                if (Math.abs(dirValue) <= 1e-8) {
                    return originValue >= minValue && originValue <= maxValue;
                }

                const invDir = 1 / dirValue;
                let t1 = (minValue - originValue) * invDir;
                let t2 = (maxValue - originValue) * invDir;
                if (t1 > t2) {
                    const tmp = t1;
                    t1 = t2;
                    t2 = tmp;
                }
                tMin = Math.max(tMin, t1);
                tMax = Math.min(tMax, t2);
                return tMax >= tMin;
            };

            if (!testAxis(origin.x, direction.x, min.x, max.x) ||
                !testAxis(origin.y, direction.y, min.y, max.y) ||
                !testAxis(origin.z, direction.z, min.z, max.z)) {
                return;
            }

            const hitT = tMin >= 0 ? tMin : tMax;
            if (!Number.isFinite(hitT) || hitT < 0) {
                return;
            }

            const exactHitT = this.intersectMeshTriangles(mi, origin, direction, bestT);
            const resolvedT = exactHitT ?? (mi.mesh ? null : hitT);
            if (!Number.isFinite(resolvedT as number) || (resolvedT as number) < 0 || (resolvedT as number) > bestT + 1e-6) {
                return;
            }

            const he = aabb.halfExtents;
            const volume = (he.x * 2) * (he.y * 2) * (he.z * 2);
            if ((resolvedT as number) < bestT - 1e-6 || (Math.abs((resolvedT as number) - bestT) <= 1e-6 && volume < bestVolume)) {
                bestT = resolvedT as number;
                bestVolume = volume;
                bestNode = node;
            }
        });

        if (!bestNode) {
            return false;
        }

        this.setSelectedNodePath(bestNode.path);
        return true;
    }

    private getCachedMeshGeometry(mi: MeshInstance) {
        const mesh = mi.mesh as object & {
            primitive?: Array<{ type?: number; base?: number; count?: number; indexed?: boolean; baseVertex?: number }>;
            vertexBuffer?: { getNumVertices?: () => number; numVertices?: number };
            indexBuffer?: Array<{ numIndices?: number }>;
            getVertexStream?: (semantic: string, data: Float32Array) => number;
            getIndices?: (data: Uint16Array | Uint32Array) => number;
        };
        if (!mesh) return null;

        const cached = this.meshGeometryCache.get(mesh);
        if (cached !== undefined) {
            return cached;
        }

        const primitive = mesh.primitive?.[0];
        const vertexCount = mesh.vertexBuffer?.getNumVertices?.() ?? mesh.vertexBuffer?.numVertices ?? 0;
        if (!primitive || primitive.type !== PRIMITIVE_TRIANGLES || vertexCount <= 0 || !mesh.getVertexStream) {
            this.meshGeometryCache.set(mesh, null);
            return null;
        }

        const positions = new Float32Array(vertexCount * 3);
        if (mesh.getVertexStream(SEMANTIC_POSITION, positions) <= 0) {
            this.meshGeometryCache.set(mesh, null);
            return null;
        }

        let indices: Uint16Array | Uint32Array | null = null;
        if (primitive.indexed) {
            const totalIndexCount = mesh.indexBuffer?.[0]?.numIndices ?? ((primitive.base ?? 0) + (primitive.count ?? 0));
            if (!totalIndexCount || !mesh.getIndices) {
                this.meshGeometryCache.set(mesh, null);
                return null;
            }
            indices = vertexCount > 65535 ? new Uint32Array(totalIndexCount) : new Uint16Array(totalIndexCount);
            if (mesh.getIndices(indices) <= 0) {
                this.meshGeometryCache.set(mesh, null);
                return null;
            }
        }

        const geometry = {
            positions,
            indices,
            vertexCount,
            primitiveBase: Math.max(0, primitive.base ?? 0),
            primitiveCount: Math.max(0, primitive.count ?? 0),
            baseVertex: primitive.baseVertex ?? 0
        } satisfies CachedMeshGeometry;

        this.meshGeometryCache.set(mesh, geometry);
        return geometry;
    }

    private intersectTriangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3) {
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
    }

    private intersectMeshTriangles(mi: MeshInstance, origin: Vec3, direction: Vec3, maxDistance: number) {
        const geometry = this.getCachedMeshGeometry(mi);
        if (!geometry || geometry.primitiveCount < 3) {
            return null;
        }

        const world = mi.node?.getWorldTransform();
        if (!world) {
            return null;
        }

        let bestT = Number.POSITIVE_INFINITY;
        const p0 = new Vec3();
        const p1 = new Vec3();
        const p2 = new Vec3();

        for (let i = geometry.primitiveBase; i + 2 < geometry.primitiveBase + geometry.primitiveCount; i += 3) {
            const i0 = (geometry.indices ? geometry.indices[i] : i) + geometry.baseVertex;
            const i1 = (geometry.indices ? geometry.indices[i + 1] : i + 1) + geometry.baseVertex;
            const i2 = (geometry.indices ? geometry.indices[i + 2] : i + 2) + geometry.baseVertex;

            if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= geometry.vertexCount || i1 >= geometry.vertexCount || i2 >= geometry.vertexCount) {
                continue;
            }

            p0.set(geometry.positions[i0 * 3], geometry.positions[i0 * 3 + 1], geometry.positions[i0 * 3 + 2]);
            p1.set(geometry.positions[i1 * 3], geometry.positions[i1 * 3 + 1], geometry.positions[i1 * 3 + 2]);
            p2.set(geometry.positions[i2 * 3], geometry.positions[i2 * 3 + 1], geometry.positions[i2 * 3 + 2]);
            world.transformPoint(p0, p0);
            world.transformPoint(p1, p1);
            world.transformPoint(p2, p2);

            const t = this.intersectTriangle(origin, direction, p0, p1, p2);
            if (t == null || t > maxDistance || t >= bestT) {
                continue;
            }
            bestT = t;
        }

        return Number.isFinite(bestT) ? bestT : null;
    }

    private stopSelectionFlash() {
        this.selectionFlashStartMs = 0;
        if (this.selectionFlashRaf !== null) {
            cancelAnimationFrame(this.selectionFlashRaf);
            this.selectionFlashRaf = null;
        }
        this.selectionHighlightMaterial.setParameter('uColor', [...FLASH_COLOR, 0]);
        this.selectionHighlightMaterial.update();
        this.resetSelectionHighlightMeshes();
    }

    private startSelectionFlash() {
        this.stopSelectionFlash();

        if (!this.getSelectedNode() || !this.observer.get('debug.withTextureOnly')) return;

        this.selectionFlashStartMs = performance.now();
        this.selectionHighlightMaterial.setParameter('uColor', [...FLASH_COLOR, 1]);
        this.selectionHighlightMaterial.update();

        const tick = () => {
            if (!this.selectionFlashStartMs) return;
            const elapsed = performance.now() - this.selectionFlashStartMs;
            this.renderNextFrame();
            if (elapsed < FLASH_DURATION_MS) {
                this.selectionFlashRaf = requestAnimationFrame(tick);
            } else {
                this.stopSelectionFlash();
                this.renderNextFrame();
            }
        };

        this.selectionFlashRaf = requestAnimationFrame(tick);
    }

    updateFlashMaterial(highlightMeshCount: number) {
        if (this.selectionFlashStartMs > 0 && highlightMeshCount > 0) {
            const elapsed = performance.now() - this.selectionFlashStartMs;
            const fade = math.clamp(1 - (elapsed / FLASH_DURATION_MS), 0, 1);
            this.selectionHighlightMaterial.setParameter('uColor', [...FLASH_COLOR, fade]);
            this.selectionHighlightMaterial.update();
        }
    }

    onTextureSelectionModeChange(enabled: boolean) {
        if (!enabled) {
            this.stopSelectionFlash();
        }
    }

    onSelectionNodeChanged() {
        this.startSelectionFlash();
    }

    onPrerender(highlightMeshCount: number) {
        this.updateFlashMaterial(highlightMeshCount);
    }

    reset() {
        this.stopSelectionFlash();
    }
}

export { SelectionController };
