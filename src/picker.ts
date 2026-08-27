import { AppBase, Entity, Picker as PickerPC, Vec3, Vec4 } from 'playcanvas';

const float32 = new Float32Array(1);
const uint8 = new Uint8Array(float32.buffer);
const two = new Vec4(2, 2, 2, 1);
const one = new Vec4(1, 1, 1, 0);

/**
 * Во сколько раз сторона буфера пикинга меньше стороны канваса.
 *
 * `pick` перерисовывает слой World целиком ради одного пикселя, то есть стоит примерно
 * лишнего кадра сцены. Половина стороны — вчетверо меньше растеризации. Платим точностью
 * порядка одного CSS-пикселя: это видно только на силуэтах, а вызывающая сторона там, где
 * попадает CPU-рейкаст, и так предпочитает его (см. `selection-controller`).
 */
const PICK_SCALE = 0.5;

/**
 * Загнать целую координату в диапазон буфера.
 *
 * @param v - Координата.
 * @param max - Наибольший допустимый индекс.
 * @returns Координата внутри `0..max`.
 */
const clampIndex = (v: number, max: number) => Math.min(max, Math.max(0, v));

class Picker {
    app: AppBase;

    camera: Entity;

    picker: PickerPC | null;

    constructor(app: AppBase, camera: Entity) {
        this.app = app;
        this.camera = camera;
        this.picker = null;
    }

    async pick(x: number, y: number) {
        const { app, camera } = this;
        const { graphicsDevice } = app;
        const { canvas } = graphicsDevice;
        const width = Math.max(1, Math.round(canvas.clientWidth * PICK_SCALE));
        const height = Math.max(1, Math.round(canvas.clientHeight * PICK_SCALE));

        // Координаты приходят в CSS-пикселях канваса — переводим в тексел буфера пикинга.
        // Считаем от центра CSS-пикселя (`+ 0.5`), иначе при уменьшении буфера выборка
        // систематически съезжает к левому верхнему углу блока.
        const px = clampIndex(Math.floor((x + 0.5) * PICK_SCALE), width - 1);
        const scaledY = clampIndex(Math.floor((y + 0.5) * PICK_SCALE), height - 1);
        const py = graphicsDevice.isWebGL2 ? height - scaledY - 1 : scaledY;

        // construct picker on demand
        if (!this.picker) {
            this.picker = new PickerPC(this.app, width, height);
        }

        // render scene, read depth
        const { picker } = this;
        picker.resize(width, height);
        picker.prepare(camera.camera, app.scene, [app.scene.layers.getLayerByName('World')]);
        const renderTarget = (picker as any).renderTarget;
        const pixels = await renderTarget.colorBuffer.read(px, py, 1, 1, {
            renderTarget,
            immediate: true
        });

        for (let i = 0; i < 4; ++i) {
            uint8[i] = pixels[i];
        }
        const depth = float32[0];

        // 255, 255, 255, 255 === NaN
        if (!isFinite(depth)) {
            return null;
        }

        // clip space. Прочитанная глубина принадлежит текселу целиком, поэтому обратно
        // распрямляем его центр, а не угол — иначе появляется сдвиг в полтексела.
        const pos = new Vec4((px + 0.5) / width, (py + 0.5) / height, depth, 1).mul(two).sub(one);

        if (!graphicsDevice.isWebGL2) {
            pos.y *= -1;
        }

        // homogeneous view space
        camera.camera.projectionMatrix.clone().invert().transformVec4(pos, pos);

        // perform perspective divide
        pos.mulScalar(1.0 / pos.w);

        // view to world space
        const pos3 = new Vec3(pos.x, pos.y, pos.z);
        camera.getWorldTransform().transformPoint(pos3, pos3);

        return pos3;
    }
}

export { Picker };
