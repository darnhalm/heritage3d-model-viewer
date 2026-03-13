import { Observer } from '@playcanvas/observer';
import { MeshInstance, Vec3 } from 'playcanvas';

import { CachedMeshGeometry, intersectMeshTrianglesDetailed } from './mesh-raycast';
import { Picker } from '../../picker';

const POI_CLICK_DRAG_THRESHOLD = 5;
const POI_MARKER_HIT_RADIUS = 18;
const POI_TITLE_MAX_LENGTH = 80;
const POI_DESCRIPTION_MAX_LENGTH = 636;
type ViewerTaggedMeshInstance = MeshInstance & { __viewerIsGsplat?: boolean };

type PoiEntry = {
    id: string;
    number: number;
    title?: string;
    description?: string;
    color?: string;
    duration?: number;
    camera?: {
        position: [number, number, number];
        focus: [number, number, number];
        fov?: number;
    };
    position: [number, number, number];
    normal: [number, number, number];
};

type PoiControllerArgs = {
    canvas: HTMLCanvasElement;
    observer: Observer;
    picker: Picker;
    getMeshInstances: () => Array<MeshInstance>;
    getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };
    getCameraView: () => { position: [number, number, number]; focus: [number, number, number]; fov?: number } | null;
    applyCameraView: (view: { position: [number, number, number]; focus: [number, number, number]; fov?: number }, duration?: number) => void;
    renderNextFrame: () => void;
};

class PoiController {
    private canvas: HTMLCanvasElement;

    private observer: Observer;

    private picker: Picker;

    private getMeshInstances: () => Array<MeshInstance>;

    private getPickRay: (x: number, y: number) => { origin: Vec3; direction: Vec3 };

    private getCameraView: () => { position: [number, number, number]; focus: [number, number, number]; fov?: number } | null;

    private applyCameraView: (view: { position: [number, number, number]; focus: [number, number, number]; fov?: number }, duration?: number) => void;

    private renderNextFrame: () => void;

    private poiClickDown: { clientX: number; clientY: number; canvasX: number; canvasY: number } | null = null;

    private poiIsPotentialClick = false;

    private meshGeometryCache = new WeakMap<object, CachedMeshGeometry | null>();

    private overlay: HTMLDivElement | null = null;

    private markerEls = new Map<string, HTMLDivElement>();

    private draggingPoiId: string | null = null;

    private poiScreenPositions = new Map<string, { x: number; y: number; visible: boolean }>();

    private hoverLabelEl: HTMLDivElement | null = null;

    private hoverLabelTitleEl: HTMLDivElement | null = null;

    private hoverLabelDescriptionEl: HTMLDivElement | null = null;

    private hoveredPoiId: string | null = null;

    private pinnedPoiId: string | null = null;

    private pulseUntil = 0;

    private pulsePoiId: string | null = null;

    private poiListCacheRaw: string | null = null;

    private poiListCache: PoiEntry[] = [];

    private onMouseDown: ((event: MouseEvent) => void) | null = null;

    private onMouseMove: ((event: MouseEvent) => void) | null = null;

    private onMouseUp: ((event: MouseEvent) => void) | null = null;

    constructor(args: PoiControllerArgs) {
        this.canvas = args.canvas;
        this.observer = args.observer;
        this.picker = args.picker;
        this.getMeshInstances = args.getMeshInstances;
        this.getPickRay = args.getPickRay;
        this.getCameraView = args.getCameraView;
        this.applyCameraView = args.applyCameraView;
        this.renderNextFrame = args.renderNextFrame;
        this.initOverlay();
        this.bindEvents();
        this.observer.on('poi.enabled:set', () => {
            if (this.observer.get('poi.enabled')) {
                this.pulseUntil = Date.now() + 650;
            }
            this.renderNextFrame();
        });
    }

    private shouldShowOverlay(poiCount: number) {
        if (poiCount === 0) return false;
        const embed = this.observer.get('ui.embed') as { enabled?: boolean; poi?: boolean } | undefined;
        if (embed?.enabled && !embed.poi) return false;

        const leftPanel = document.getElementById('panel-left');
        const panelExpanded = leftPanel?.classList.contains('expanded') ?? false;
        const editEnabled = !!this.observer.get('poi.enabled');

        return !panelExpanded || editEnabled;
    }

    private initOverlay() {
        const wrapper = this.canvas.parentElement;
        if (!wrapper) return;

        this.overlay = document.createElement('div');
        this.overlay.className = 'poi-overlay';
        this.hoverLabelEl = document.createElement('div');
        this.hoverLabelEl.className = 'poi-hover-label';
        this.hoverLabelTitleEl = document.createElement('div');
        this.hoverLabelTitleEl.className = 'poi-hover-label-title';
        this.hoverLabelDescriptionEl = document.createElement('div');
        this.hoverLabelDescriptionEl.className = 'poi-hover-label-description';
        this.hoverLabelEl.style.display = 'none';
        this.hoverLabelEl.appendChild(this.hoverLabelTitleEl);
        this.hoverLabelEl.appendChild(this.hoverLabelDescriptionEl);
        this.overlay.appendChild(this.hoverLabelEl);
        wrapper.appendChild(this.overlay);
    }

    private bindEvents() {
        this.onMouseDown = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (!this.observer.get('poi.enabled')) return;
            if (this.observer.get('measure.enabled')) return;

            const rect = this.canvas.getBoundingClientRect();
            const canvasX = event.clientX - rect.left;
            const canvasY = event.clientY - rect.top;
            const grabbedPoiId = this.findPoiNearScreenPoint(canvasX, canvasY);
            if (grabbedPoiId) {
                this.draggingPoiId = grabbedPoiId;
                this.poiIsPotentialClick = false;
                this.poiClickDown = null;
                event.preventDefault();
                return;
            }

            if (event.target !== this.canvas) return;
            this.poiClickDown = {
                clientX: event.clientX,
                clientY: event.clientY,
                canvasX,
                canvasY
            };
            this.poiIsPotentialClick = true;
        };

        this.onMouseMove = (event: MouseEvent) => {
            if (this.draggingPoiId) {
                const rect = this.canvas.getBoundingClientRect();
                this.movePoiTo(this.draggingPoiId, event.clientX - rect.left, event.clientY - rect.top).catch(() => {});
                return;
            }
            if (!this.poiIsPotentialClick || !this.poiClickDown) return;
            const dx = event.clientX - this.poiClickDown.clientX;
            const dy = event.clientY - this.poiClickDown.clientY;
            if (Math.hypot(dx, dy) > POI_CLICK_DRAG_THRESHOLD) {
                this.poiIsPotentialClick = false;
            }
        };

        this.onMouseUp = (event: MouseEvent) => {
            if (event.button !== 0) return;
            if (this.draggingPoiId) {
                this.draggingPoiId = null;
                this.renderNextFrame();
            }
            if (this.poiIsPotentialClick && this.poiClickDown && this.observer.get('poi.enabled') && !this.observer.get('measure.enabled')) {
                this.addPoiAt(this.poiClickDown.canvasX, this.poiClickDown.canvasY).catch(() => {});
            }
            this.poiIsPotentialClick = false;
            this.poiClickDown = null;
        };

        document.addEventListener('mousedown', this.onMouseDown, true);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
    }

    dispose() {
        if (this.onMouseDown) {
            document.removeEventListener('mousedown', this.onMouseDown, true);
            this.onMouseDown = null;
        }
        if (this.onMouseMove) {
            document.removeEventListener('mousemove', this.onMouseMove);
            this.onMouseMove = null;
        }
        if (this.onMouseUp) {
            document.removeEventListener('mouseup', this.onMouseUp);
            this.onMouseUp = null;
        }
        this.markerEls.forEach(marker => marker.remove());
        this.markerEls.clear();
        this.poiScreenPositions.clear();
        this.overlay?.remove();
        this.overlay = null;
        this.hoverLabelEl = null;
        this.hoverLabelTitleEl = null;
        this.hoverLabelDescriptionEl = null;
    }

    private getPoiList() {
        const raw = String(this.observer.get('poi.list') ?? '[]');
        if (this.poiListCacheRaw === raw) {
            return this.poiListCache;
        }

        try {
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed) ? parsed as PoiEntry[] : [];
            this.poiListCacheRaw = raw;
            this.poiListCache = list;
            return list;
        } catch {
            this.poiListCacheRaw = raw;
            this.poiListCache = [];
            return this.poiListCache;
        }
    }

    private setPoiList(list: PoiEntry[]) {
        const raw = JSON.stringify(list);
        this.poiListCacheRaw = raw;
        this.poiListCache = list;
        this.observer.set('poi.list', raw);
        this.renderNextFrame();
    }

    private setActivePoi(id: string | null) {
        this.observer.set('poi.activeId', id || '');
    }

    private findPoiNearScreenPoint(x: number, y: number) {
        let bestId: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        this.poiScreenPositions.forEach((screen, id) => {
            if (!screen.visible) return;
            const distance = Math.hypot(screen.x - x, screen.y - y);
            if (distance <= POI_MARKER_HIT_RADIUS && distance < bestDistance) {
                bestDistance = distance;
                bestId = id;
            }
        });

        return bestId;
    }

    private pickSurfaceHit(x: number, y: number) {
        const { origin, direction } = this.getPickRay(x, y);
        let bestHit: ReturnType<typeof intersectMeshTrianglesDetailed> = null;

        this.getMeshInstances().forEach((mi) => {
            if ((mi as ViewerTaggedMeshInstance).__viewerIsGsplat) return;
            const aabb = mi.aabb;
            if (!aabb) return;

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

            const hit = intersectMeshTrianglesDetailed(mi, origin, direction, bestHit?.t ?? Number.POSITIVE_INFINITY, this.meshGeometryCache);
            if (!hit) return;
            bestHit = hit;
        });

        return bestHit;
    }

    private async pickPoiPlacement(x: number, y: number) {
        const hit = this.pickSurfaceHit(x, y);
        if (hit) {
            const offset = Math.max(0.001, Math.min(0.02, hit.t * 0.0005));
            return {
                point: hit.point.clone().add(hit.normal.clone().mulScalar(offset)),
                normal: hit.normal.clone()
            };
        }

        const pickedPoint = await this.picker.pick(x, y);
        if (!pickedPoint) {
            return null;
        }

        const { direction } = this.getPickRay(x, y);
        const normal = direction.clone().mulScalar(-1).normalize();
        const anchored = pickedPoint.clone().add(normal.clone().mulScalar(0.002));
        return { point: anchored, normal };
    }

    async addPoiAt(x: number, y: number) {
        const placement = await this.pickPoiPlacement(x, y);
        if (!placement) return false;

        const list = this.getPoiList();
        const nextNumber = list.length + 1;
        const nextPoi: PoiEntry = {
            id: `poi-${Date.now()}-${nextNumber}`,
            number: nextNumber,
            title: `POI ${nextNumber}`,
            color: '#000000',
            duration: 0.8,
            position: [placement.point.x, placement.point.y, placement.point.z],
            normal: [placement.normal.x, placement.normal.y, placement.normal.z]
        };
        this.setActivePoi(nextPoi.id);
        this.setPoiList([...list, nextPoi]);
        return true;
    }

    private async movePoiTo(id: string, x: number, y: number) {
        const placement = await this.pickPoiPlacement(x, y);
        if (!placement) return false;

        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            return {
                ...poi,
                position: [placement.point.x, placement.point.y, placement.point.z] as [number, number, number],
                normal: [placement.normal.x, placement.normal.y, placement.normal.z] as [number, number, number]
            };
        });
        this.setPoiList(updated);
        return true;
    }

    removePoi(id: string) {
        if (this.pinnedPoiId === id) {
            this.pinnedPoiId = null;
        }
        if (this.observer.get('poi.activeId') === id) {
            this.setActivePoi(null);
        }
        const remaining = this.getPoiList()
        .filter(poi => poi.id !== id)
        .map((poi, index) => ({ ...poi, number: index + 1, title: poi.title || `POI ${index + 1}` }));
        this.setPoiList(remaining);
    }

    updatePoiTitle(id: string, title: string) {
        const trimmedTitle = String(title ?? '').slice(0, POI_TITLE_MAX_LENGTH).trim();
        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            return {
                ...poi,
                title: trimmedTitle || `POI ${poi.number}`
            };
        });
        this.setPoiList(updated);
    }

    updatePoiDescription(id: string, description: string) {
        const nextDescription = String(description ?? '').slice(0, POI_DESCRIPTION_MAX_LENGTH);
        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            return {
                ...poi,
                description: nextDescription
            };
        });
        this.setPoiList(updated);
    }

    updatePoiColor(id: string, color: string) {
        const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            return {
                ...poi,
                color: hex
            };
        });
        this.setPoiList(updated);
    }

    updatePoiDuration(id: string, duration: number) {
        const safeDuration = Number.isFinite(duration) ? Math.max(0.1, Math.min(10, duration)) : 0.8;
        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            return {
                ...poi,
                duration: safeDuration
            };
        });
        this.setPoiList(updated);
    }

    capturePoiCameraView(id: string) {
        const cameraView = this.getCameraView();
        if (!cameraView) {
            return;
        }

        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            return {
                ...poi,
                camera: cameraView
            };
        });
        this.setPoiList(updated);
    }

    clearPoiCameraView(id: string) {
        const updated = this.getPoiList().map((poi) => {
            if (poi.id !== id) return poi;
            const nextPoi = { ...poi };
            delete nextPoi.camera;
            return nextPoi;
        });
        this.setPoiList(updated);
    }

    focusPoi(id: string) {
        const poi = this.getPoiList().find(entry => entry.id === id);
        if (!poi) {
            return;
        }

        this.pinnedPoiId = poi.id;
        this.setActivePoi(poi.id);
        if (poi.camera) {
            this.applyCameraView(poi.camera, poi.duration);
        } else {
            this.renderNextFrame();
        }
    }

    clearFocusedPoi() {
        this.pinnedPoiId = null;
        this.setActivePoi(null);
        this.renderNextFrame();
    }

    focusNextPoi() {
        const list = this.getPoiList();
        if (list.length === 0) return;
        const activeId = String(this.observer.get('poi.activeId') ?? '');
        const activeIndex = list.findIndex(poi => poi.id === activeId);
        const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % list.length : 0;
        this.focusPoi(list[nextIndex].id);
    }

    focusPrevPoi() {
        const list = this.getPoiList();
        if (list.length === 0) return;
        const activeId = String(this.observer.get('poi.activeId') ?? '');
        const activeIndex = list.findIndex(poi => poi.id === activeId);
        const prevIndex = activeIndex >= 0 ? (activeIndex - 1 + list.length) % list.length : list.length - 1;
        this.focusPoi(list[prevIndex].id);
    }

    reorderPoi(sourceId: string, targetId: string) {
        if (!sourceId || !targetId || sourceId === targetId) {
            return;
        }

        const list = this.getPoiList();
        const sourceIndex = list.findIndex(poi => poi.id === sourceId);
        const targetIndex = list.findIndex(poi => poi.id === targetId);
        if (sourceIndex === -1 || targetIndex === -1) {
            return;
        }

        const reordered = [...list];
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, moved);
        this.setPoiList(reordered.map((poi, index) => ({
            ...poi,
            number: index + 1,
            title: poi.title || `POI ${index + 1}`
        })));
    }

    pulseMarkers() {
        this.pulsePoiId = null;
        this.pulseUntil = Date.now() + 650;
        this.renderNextFrame();
    }

    pulsePoi(id: string) {
        this.pulsePoiId = id;
        this.pulseUntil = Date.now() + 650;
        this.renderNextFrame();
    }

    clearPois() {
        this.hoveredPoiId = null;
        this.pinnedPoiId = null;
        this.setActivePoi(null);
        this.setPoiList([]);
    }

    updateOverlay(worldToScreen: (point: Vec3) => Vec3) {
        if (!this.overlay) return;

        const pois = this.getPoiList();
        const editEnabled = !!this.observer.get('poi.enabled');
        const showOverlay = this.shouldShowOverlay(pois.length);
        this.overlay.style.display = showOverlay ? '' : 'none';
        if (!showOverlay) {
            if (this.hoverLabelEl) {
                this.hoverLabelEl.style.display = 'none';
            }
            return;
        }

        const pulseActive = this.pulseUntil > Date.now();
        const activeIds = new Set<string>();

        pois.forEach((poi) => {
            activeIds.add(poi.id);
            let marker = this.markerEls.get(poi.id);
            if (!marker) {
                marker = document.createElement('div');
                marker.className = 'poi-marker';
                marker.setAttribute('role', 'button');
                marker.setAttribute('aria-label', `POI ${poi.number}`);
                marker.draggable = false;
                marker.addEventListener('mouseenter', () => {
                    this.hoveredPoiId = poi.id;
                    this.renderNextFrame();
                });
                marker.addEventListener('mouseleave', () => {
                    if (this.hoveredPoiId === poi.id) {
                        this.hoveredPoiId = null;
                        this.renderNextFrame();
                    }
                });
                marker.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.focusPoi(poi.id);
                });
                this.overlay?.appendChild(marker);
                this.markerEls.set(poi.id, marker);
            }
            marker.textContent = String(poi.number);
            marker.style.cursor = editEnabled ? 'grab' : 'default';
            marker.style.backgroundColor = poi.color || '#111111';
            marker.classList.toggle('poi-marker-pulse', pulseActive && (!this.pulsePoiId || this.pulsePoiId === poi.id));

            const screen = worldToScreen(new Vec3(poi.position[0], poi.position[1], poi.position[2]));
            const visible = screen.z > 0;
            this.poiScreenPositions.set(poi.id, { x: screen.x, y: screen.y, visible });
            marker.style.display = visible ? 'flex' : 'none';
            if (visible) {
                marker.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
            }
        });

        [...this.markerEls.entries()].forEach(([id, marker]) => {
            if (activeIds.has(id)) return;
            marker.remove();
            this.markerEls.delete(id);
            this.poiScreenPositions.delete(id);
        });

        if (!this.hoverLabelEl) return;

        const activePoi = pois.find(poi => poi.id === (this.pinnedPoiId ?? this.hoveredPoiId));
        const activeScreen = activePoi ? this.poiScreenPositions.get(activePoi.id) : null;
        if (!activePoi || !activeScreen?.visible) {
            this.hoverLabelEl.style.display = 'none';
            return;
        }

        if (this.hoverLabelTitleEl) {
            this.hoverLabelTitleEl.textContent = activePoi.title || `POI ${activePoi.number}`;
        }
        if (this.hoverLabelDescriptionEl) {
            const description = String(activePoi.description ?? '').trim();
            this.hoverLabelDescriptionEl.textContent = description;
            this.hoverLabelDescriptionEl.style.display = description ? 'block' : 'none';
        }
        this.hoverLabelEl.style.display = 'block';
        this.hoverLabelEl.style.transform = `translate(${activeScreen.x + 22}px, ${activeScreen.y}px) translateY(-50%)`;
    }
}

export { PoiController };
