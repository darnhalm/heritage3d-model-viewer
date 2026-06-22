import { Observer } from '@playcanvas/observer';
import { Vec3 } from 'playcanvas';

export type SceneHelperEntry = {
    id: string;
    name: string;
    type?: string;
    group?: string;
    color?: string;
    position: [number, number, number];
    /** Имя Google Material Icon (ligature), напр. "headphones"/"hearing"/"mic". */
    icon?: string;
    /** Можно ли выбирать/двигать этот хелпер. false → клик игнорируется (фиксирован). */
    editable?: boolean;
};

type MicrophoneControllerArgs = {
    canvas: HTMLCanvasElement;
    observer: Observer;
    onSelect?: (id: string) => void;
};

const isMicHelper = (value: string) => /^mic(?:[_-]|$)/i.test(value) || /^mic[A-Z0-9]/.test(value);

class MicrophoneController {
    private canvas: HTMLCanvasElement;

    private observer: Observer;

    private onSelect?: (id: string) => void;

    private overlay: HTMLDivElement | null = null;

    private markerEls = new Map<string, HTMLDivElement>();

    private helpers = new Map<string, SceneHelperEntry>();

    constructor(args: MicrophoneControllerArgs) {
        this.canvas = args.canvas;
        this.observer = args.observer;
        this.onSelect = args.onSelect;
        this.initOverlay();
    }

    private initOverlay() {
        const wrapper = this.canvas.parentElement;
        if (!wrapper) return;

        this.overlay = document.createElement('div');
        this.overlay.className = 'mic-overlay';
        this.overlay.style.position = 'absolute';
        this.overlay.style.inset = '0';
        this.overlay.style.pointerEvents = 'none';
        this.overlay.style.zIndex = '22'; // Above standard POIs
        wrapper.appendChild(this.overlay);
    }

    dispose() {
        this.clearHelpers();
        this.overlay?.remove();
        this.overlay = null;
    }

    setHelper(helper: SceneHelperEntry) {
        this.helpers.set(helper.id, helper);
        this.ensureMarker(helper);
    }

    setHelpers(helpers: SceneHelperEntry[]) {
        const activeIds = new Set<string>();
        helpers.forEach((helper) => {
            activeIds.add(helper.id);
            this.setHelper(helper);
        });
        [...this.helpers.keys()].forEach((id) => {
            if (!activeIds.has(id)) this.removeHelper(id);
        });
    }

    moveMicrophone(id: string, name: string, position: { x: number; y: number; z: number }) {
        this.setHelper({
            id,
            name: name || id,
            type: 'audio-source',
            group: 'mic',
            position: [position.x, position.y, position.z]
        });
    }

    private ensureMarker(helper: SceneHelperEntry) {
        if (!this.overlay) return;

        let marker = this.markerEls.get(helper.id);
        if (!marker) {
            marker = document.createElement('div');
            marker.className = 'mic-marker';
            marker.draggable = false;
            marker.style.position = 'absolute';
            marker.style.pointerEvents = 'auto';
            marker.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                // Фиксированный хелпер (editable === false) нельзя выбрать/двигать —
                // напр. микрофоны в публичном плеере (двигается только слушатель).
                const current = this.helpers.get(helper.id);
                if (current?.editable === false) return;
                this.observer.set('helpers.activeId', helper.id);
                this.onSelect?.(helper.id);
            });
            this.overlay.appendChild(marker);
            this.markerEls.set(helper.id, marker);
        }

        const label = helper.name || helper.id;
        // Material-иконка, если задана; иначе эмодзи по типу (микрофон/прочее).
        const iconHtml = helper.icon
            ? `<span class="mic-icon material-icons">${helper.icon}</span>`
            : `<span class="mic-icon">${isMicHelper(helper.id) || isMicHelper(label) ? '🎤' : '●'}</span>`;
        marker.innerHTML = `${iconHtml}<span class="mic-name">${label}</span>`;
        marker.style.setProperty('--helper-color', helper.color || '#f5b642');
    }

    clearMicrophones() {
        [...this.helpers.keys()]
        .filter(id => {
            const helper = this.helpers.get(id);
            return helper?.group === 'mic' || helper?.type === 'audio-source' || isMicHelper(id) || isMicHelper(helper?.name ?? '');
        })
        .forEach(id => this.removeHelper(id));
    }

    clearHelpers(group?: string) {
        const ids = [...this.helpers.keys()].filter((id) => !group || this.helpers.get(id)?.group === group);
        ids.forEach(id => this.removeHelper(id));
    }

    private removeHelper(id: string) {
        this.markerEls.get(id)?.remove();
        this.markerEls.delete(id);
        this.helpers.delete(id);
    }

    getHelper(id: string) {
        return this.helpers.get(id) ?? null;
    }

    updateHelperPosition(id: string, position: { x: number; y: number; z: number }) {
        const helper = this.helpers.get(id);
        if (!helper) return;
        this.helpers.set(id, {
            ...helper,
            position: [position.x, position.y, position.z]
        });
    }

    clearAll() {
        this.markerEls.forEach(marker => marker.remove());
        this.markerEls.clear();
        this.helpers.clear();
    }

    updateOverlay(worldToScreen: (point: Vec3) => Vec3) {
        if (!this.overlay) return;

        // Hide overlay if embed config disables POI-like items
        const embed = this.observer.get('ui.embed') as { enabled?: boolean; poi?: boolean } | undefined;
        if (embed?.enabled && !embed.poi) {
            this.overlay.style.display = 'none';
            return;
        }

        const helpersVisible = !!this.observer.get('helpers.visible');
        this.overlay.style.display = helpersVisible ? '' : 'none';
        if (!helpersVisible) return;

        const activeGroup = String(this.observer.get('helpers.group') ?? 'all');
        const editable = !!this.observer.get('helpers.editable');
        const activeId = String(this.observer.get('helpers.activeId') ?? '');

        this.helpers.forEach((helper, id) => {
            const marker = this.markerEls.get(id);
            if (!marker) return;
            const groupVisible = activeGroup === 'all' || helper.group === activeGroup || helper.type === activeGroup;
            if (!groupVisible) {
                marker.style.display = 'none';
                return;
            }

            const screen = worldToScreen(new Vec3(helper.position[0], helper.position[1], helper.position[2]));
            const visible = screen.z > 0;
            marker.style.display = visible ? 'flex' : 'none';
            if (visible) {
                marker.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
            }
            marker.style.cursor = editable ? 'grab' : 'default';
            marker.classList.toggle('mic-marker-active', id === activeId);
        });
    }
}

export { MicrophoneController };
