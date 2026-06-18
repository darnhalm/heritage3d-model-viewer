import { Observer } from '@playcanvas/observer';
import { Vec3 } from 'playcanvas';

type MicrophoneEntry = {
    id: string;
    name: string;
    position: [number, number, number];
};

type MicrophoneControllerArgs = {
    canvas: HTMLCanvasElement;
    observer: Observer;
};

class MicrophoneController {
    private canvas: HTMLCanvasElement;

    private observer: Observer;

    private overlay: HTMLDivElement | null = null;

    private markerEls = new Map<string, HTMLDivElement>();

    private microphones = new Map<string, MicrophoneEntry>();

    constructor(args: MicrophoneControllerArgs) {
        this.canvas = args.canvas;
        this.observer = args.observer;
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
        this.clearMicrophones();
        this.overlay?.remove();
        this.overlay = null;
    }

    moveMicrophone(id: string, name: string, position: { x: number; y: number; z: number }) {
        this.microphones.set(id, {
            id,
            name,
            position: [position.x, position.y, position.z]
        });

        if (!this.overlay) return;

        let marker = this.markerEls.get(id);
        if (!marker) {
            marker = document.createElement('div');
            marker.className = 'mic-marker';
            marker.draggable = false;
            marker.style.position = 'absolute';
            marker.style.pointerEvents = 'auto';
            this.overlay.appendChild(marker);
            this.markerEls.set(id, marker);
        }

        marker.innerHTML = `<span class="mic-icon">🎤</span><span class="mic-name">${name}</span>`;
    }

    clearMicrophones() {
        this.markerEls.forEach(marker => marker.remove());
        this.markerEls.clear();
        this.microphones.clear();
    }

    updateOverlay(worldToScreen: (point: Vec3) => Vec3) {
        if (!this.overlay) return;

        // Hide overlay if embed config disables POI-like items
        const embed = this.observer.get('ui.embed') as { enabled?: boolean; poi?: boolean } | undefined;
        if (embed?.enabled && !embed.poi) {
            this.overlay.style.display = 'none';
            return;
        }

        this.overlay.style.display = '';

        this.microphones.forEach((mic, id) => {
            const marker = this.markerEls.get(id);
            if (!marker) return;

            const screen = worldToScreen(new Vec3(mic.position[0], mic.position[1], mic.position[2]));
            const visible = screen.z > 0;
            marker.style.display = visible ? 'flex' : 'none';
            if (visible) {
                marker.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
            }
        });
    }
}

export { MicrophoneController };
