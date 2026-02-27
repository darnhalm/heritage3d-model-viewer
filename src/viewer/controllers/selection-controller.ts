import { Observer } from '@playcanvas/observer';
import {
    GraphNode,
    Mat4,
    math,
    MeshInstance,
    ShaderMaterial,
    Vec3
} from 'playcanvas';

import { CachedMeshGeometry, intersectMeshTriangles } from './mesh-raycast';
import { Picker } from '../../picker';

const SELECT_CLICK_DRAG_THRESHOLD = 5;
const FLASH_DURATION_MS = 500;
const FLASH_COLOR: [number, number, number] = [0.224, 1.0, 0.078];

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

    private intersectMeshTriangles(mi: MeshInstance, origin: Vec3, direction: Vec3, maxDistance: number) {
        return intersectMeshTriangles(mi, origin, direction, maxDistance, this.meshGeometryCache);
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
