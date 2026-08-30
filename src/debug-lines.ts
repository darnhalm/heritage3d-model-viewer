import {
    BLEND_NORMAL,
    BUFFER_DYNAMIC,
    CULLFACE_NONE,
    FUNC_ALWAYS,
    FUNC_GREATER,
    PRIMITIVE_LINES,
    PRIMITIVE_TRIANGLES,
    SEMANTIC_BLENDINDICES,
    SEMANTIC_BLENDWEIGHT,
    SEMANTIC_NORMAL,
    SEMANTIC_POSITION,
    SEMANTIC_COLOR,
    SORTMODE_NONE,
    TYPE_FLOAT32,
    TYPE_UINT8,
    DepthState,
    Entity,
    GraphNode,
    Layer,
    Mesh,
    MeshInstance,
    Mat4,
    ShaderMaterial,
    Vec3,
    VertexBuffer,
    VertexFormat,
    VertexIterator
} from 'playcanvas';

import { App } from './app';

let debugLayerFront: Layer = null;
let debugLayerBack: Layer = null;

const v0 = new Vec3();
const v1 = new Vec3();
const v2 = new Vec3();
const up = new Vec3(0, 1, 0);
const mat = new Mat4();
// Восемь углов OBB — переиспользуются между вызовами (line() копирует значения сразу).
const obbCorners = [new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3()];
// 12 рёбер куба: пары углов, различающиеся ровно одним битом знака (bit2=X, bit1=Y, bit0=Z).
const obbEdges: [number, number][] = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
    [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]
];
// Шесть граней OBB для шахматной заливки: (полуось A в плоскости, B в плоскости, нормаль N,
// знак нормали). Ячейки грани строятся из A и B, положение грани — из sign·N.
const obbFaceAxes: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 1 | -1][] = [
    [0, 1, 2, 1], [0, 1, 2, -1],
    [1, 2, 0, 1], [1, 2, 0, -1],
    [2, 0, 1, 1], [2, 0, 1, -1]
];
// Скретч для граней/лент — без аллокаций в кадре (vertex() копирует значения сразу).
const sp0 = new Vec3();
const sp1 = new Vec3();
const sp2 = new Vec3();
const sp3 = new Vec3();
const sedge = new Vec3();
const sview = new Vec3();
const sperp = new Vec3();
const smid = new Vec3();
const unitBone = [
    [[0,    0,   0], [-0.5, 0, 0.3]],
    [[0,    0,   0], [0.5,  0, 0.3]],
    [[0,    0,   0], [0, -0.5, 0.3]],
    [[0,    0,   0], [0,  0.5, 0.3]],
    [[0,    0,   1], [-0.5, 0, 0.3]],
    [[0,    0,   1], [0.5,  0, 0.3]],
    [[0,    0,   1], [0, -0.5, 0.3]],
    [[0,    0,   1], [0,  0.5, 0.3]],
    [[0, -0.5, 0.3], [0.5,  0, 0.3]],
    [[0.5,  0, 0.3], [0,  0.5, 0.3]],
    [[0,  0.5, 0.3], [-0.5, 0, 0.3]],
    [[-0.5, 0, 0.3], [0, -0.5, 0.3]]
];

const vertexGLSL = /* glsl */`
attribute vec3 vertex_position;
attribute vec4 vertex_color;

varying vec2 zw;
varying vec4 vColor;

uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;

void main(void) {
    vColor = vertex_color;

    gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);

    // store z/w for later use in fragment shader
    zw = gl_Position.zw;

    // disable depth clipping
    gl_Position.z = 0.0;
}`;

const fragmentGLSL = /* glsl */`
precision highp float;

varying vec2 zw;
varying vec4 vColor;
uniform vec4 uColor;

void main(void) {
    gl_FragColor = vColor * uColor;

    // clamp depth in Z to [0, 1] range
    gl_FragDepth = max(0.0, min(1.0, (zw.x / zw.y + 1.0) * 0.5));
}`;

const vertexWGSL = /* wgsl */`
attribute vertex_position: vec3f;
attribute vertex_color: vec4f;

varying zw: vec2f;
varying vColor: vec4f;

uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    output.vColor = vertex_color;
    output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4(vertex_position, 1.0);

    // store z/w for later use in fragment shader
    output.zw = output.position.zw;

    // disable depth clipping
    output.position.z = 0.0;

    return output;
}
`;

const fragmentWGSL = /* wgsl */`
varying zw: vec2f;
varying vColor: vec4f;

uniform uColor: vec4f;

@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;

    output.color = input.vColor * uniform.uColor;

    // В WebGPU z клипового пространства уже лежит в [0, 1] — пересчёт из диапазона GL
    // [-1, 1] здесь не нужен, иначе вся отладочная геометрия уезжает в дальнюю
    // половину буфера глубины и прячется за моделью.
    output.fragDepth = clamp(zw.x / zw.y, 0.0, 1.0);

    return output;
}
`;

/**
 * Создать (однократно) отладочные слои — задний и передний — и подключить их к камере.
 * Общие для линий и заливки, чтобы отладка рисовалась одним проходом поверх сцены.
 *
 * @param app - Приложение.
 * @param camera - Камера, к которой подключаются слои.
 */
function ensureDebugLayers(app: App, camera: Entity): void {
    if (debugLayerFront) {
        return;
    }
    debugLayerBack = new Layer({
        enabled: true,
        name: 'Debug Layer Behind',
        opaqueSortMode: SORTMODE_NONE,
        transparentSortMode: SORTMODE_NONE,
        passThrough: true,
        overrideClear: true
    });

    debugLayerFront = new Layer({
        enabled: true,
        name: 'Debug Layer',
        opaqueSortMode: SORTMODE_NONE,
        transparentSortMode: SORTMODE_NONE,
        passThrough: true,
        overrideClear: true
    });

    const layers = app.scene.layers;
    const worldLayer = layers.getLayerByName('World');
    const idx = layers.getTransparentIndex(worldLayer);

    layers.insert(debugLayerBack, idx);
    layers.insert(debugLayerFront, idx + 1);

    camera.camera.layers = camera.camera.layers.concat([debugLayerBack.id, debugLayerFront.id]);
}

/**
 * Аргументы шейдера отладочной геометрии (позиция + цвет вершины). Общие для линий и заливки.
 *
 * @param uniqueName - Уникальное имя для кеша шейдеров движка.
 * @returns Объект аргументов для `ShaderMaterial`.
 */
function debugShaderArgs(uniqueName: string) {
    return {
        uniqueName,
        attributes: {
            vertex_position: SEMANTIC_POSITION,
            vertex_color: SEMANTIC_COLOR
        },
        vertexGLSL,
        fragmentGLSL,
        vertexWGSL,
        fragmentWGSL
    };
}

class DebugLines {
    app: App;

    mesh: Mesh;

    meshInstances: MeshInstance[];

    vertexFormat: VertexFormat;

    vertexCursor: number;

    vertexData: Float32Array;

    colorData: Uint32Array;

    depthState = new DepthState();

    constructor(app: App, camera: Entity, backLayer = true) {
        const device = app.graphicsDevice;

        ensureDebugLayers(app, camera);

        const vertexFormat = new VertexFormat(device, [
            { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_COLOR, components: 4, type: TYPE_UINT8, normalize: true }
        ]);

        // construct the mesh
        const mesh = new Mesh(device);
        mesh.vertexBuffer = new VertexBuffer(device, vertexFormat, 8192, { usage: BUFFER_DYNAMIC });
        mesh.primitive[0].type = PRIMITIVE_LINES;
        mesh.primitive[0].base = 0;
        mesh.primitive[0].indexed = false;
        mesh.primitive[0].count = 0;

        const shaderArgs = debugShaderArgs('debug-lines');

        const frontMaterial = new ShaderMaterial(shaderArgs);
        frontMaterial.setParameter('uColor', [1, 1, 1, 0.7]);
        frontMaterial.blendType = BLEND_NORMAL;
        frontMaterial.update();

        const frontInstance = new MeshInstance(mesh, frontMaterial, new GraphNode());
        frontInstance.cull = false;
        frontInstance.visible = false;

        debugLayerFront.addMeshInstances([frontInstance], true);

        this.meshInstances = [frontInstance];

        // construct back
        if (backLayer) {
            const backMaterial = new ShaderMaterial(shaderArgs);
            backMaterial.setParameter('uColor', [0.5, 0.5, 0.5, 0.5]);
            backMaterial.blendType = BLEND_NORMAL;
            backMaterial.depthState.func = FUNC_GREATER;
            backMaterial.depthState.write = false;
            backMaterial.update();

            const backInstance = new MeshInstance(mesh, backMaterial, new GraphNode());
            backInstance.cull = false;
            backInstance.visible = false;

            debugLayerBack.addMeshInstances([backInstance], true);

            this.meshInstances.push(backInstance);
        }

        this.app = app;
        this.mesh = mesh;

        this.vertexFormat = vertexFormat;
        this.vertexCursor = 0;
        this.vertexData = new Float32Array(this.mesh.vertexBuffer.lock());
        this.colorData = new Uint32Array(this.mesh.vertexBuffer.lock());
    }

    private static matrixMad(result: Mat4, mat: Mat4, factor: number) {
        if (factor > 0) {
            for (let i = 0; i < 16; ++i) {
                result.data[i] += mat.data[i] * factor;
            }
        }
    }

    clear(): void {
        this.vertexCursor = 0;
    }

    box(min: Vec3, max: Vec3, clr = 0xffffffff): void {
        this.line(new Vec3(min.x, min.y, min.z), new Vec3(max.x, min.y, min.z), clr);
        this.line(new Vec3(max.x, min.y, min.z), new Vec3(max.x, min.y, max.z), clr);
        this.line(new Vec3(max.x, min.y, max.z), new Vec3(min.x, min.y, max.z), clr);
        this.line(new Vec3(min.x, min.y, max.z), new Vec3(min.x, min.y, min.z), clr);

        this.line(new Vec3(min.x, max.y, min.z), new Vec3(max.x, max.y, min.z), clr);
        this.line(new Vec3(max.x, max.y, min.z), new Vec3(max.x, max.y, max.z), clr);
        this.line(new Vec3(max.x, max.y, max.z), new Vec3(min.x, max.y, max.z), clr);
        this.line(new Vec3(min.x, max.y, max.z), new Vec3(min.x, max.y, min.z), clr);

        this.line(new Vec3(min.x, min.y, min.z), new Vec3(min.x, max.y, min.z), clr);
        this.line(new Vec3(max.x, min.y, min.z), new Vec3(max.x, max.y, min.z), clr);
        this.line(new Vec3(max.x, min.y, max.z), new Vec3(max.x, max.y, max.z), clr);
        this.line(new Vec3(min.x, min.y, max.z), new Vec3(min.x, max.y, max.z), clr);
    }

    /**
     * Ориентированный габаритный ящик по центру и трём полуосям (не обязательно ортогональным).
     *
     * @param center - Центр ящика в мировых координатах.
     * @param ax - Первая полуось (длина = половина размера вдоль неё).
     * @param ay - Вторая полуось.
     * @param az - Третья полуось.
     * @param clr - Цвет рёбер в формате 0xAABBGGRR.
     */
    obb(center: Vec3, ax: Vec3, ay: Vec3, az: Vec3, clr = 0xffffffff): void {
        let i = 0;
        for (let sx = -1; sx <= 1; sx += 2) {
            for (let sy = -1; sy <= 1; sy += 2) {
                for (let sz = -1; sz <= 1; sz += 2) {
                    obbCorners[i].set(
                        center.x + sx * ax.x + sy * ay.x + sz * az.x,
                        center.y + sx * ax.y + sy * ay.y + sz * az.y,
                        center.z + sx * ax.z + sy * ay.z + sz * az.z
                    );
                    i++;
                }
            }
        }
        for (let e = 0; e < obbEdges.length; ++e) {
            this.line(obbCorners[obbEdges[e][0]], obbCorners[obbEdges[e][1]], clr);
        }
    }

    line(v0: Vec3, v1: Vec3, clr = 0xffffffff): void {
        if (this.vertexCursor >= this.vertexData.length / 8) {
            const oldVBuffer = this.mesh.vertexBuffer;
            const byteSize = oldVBuffer.lock().byteLength * 2;
            const arrayBuffer = new ArrayBuffer(byteSize);

            this.mesh.vertexBuffer = new VertexBuffer(
                this.app.graphicsDevice,
                oldVBuffer.getFormat(),
                oldVBuffer.getNumVertices() * 2,
                { usage: BUFFER_DYNAMIC, data: arrayBuffer }
            );
            this.vertexData = new Float32Array(arrayBuffer);
            this.colorData = new Uint32Array(arrayBuffer);

            this.colorData.set(new Uint32Array(oldVBuffer.lock()));
        }

        const vertex = this.vertexCursor;
        const vertexData = this.vertexData;
        const colorData = this.colorData;
        vertexData[vertex * 8 + 0] = v0.x;
        vertexData[vertex * 8 + 1] = v0.y;
        vertexData[vertex * 8 + 2] = v0.z;
        colorData[vertex * 8 + 3] = clr;
        vertexData[vertex * 8 + 4] = v1.x;
        vertexData[vertex * 8 + 5] = v1.y;
        vertexData[vertex * 8 + 6] = v1.z;
        colorData[vertex * 8 + 7] = clr;
        this.vertexCursor++;
    }

    generateNormals(vertexBuffer: VertexBuffer, worldMat: Mat4, length: number, skinMatrices: Array<Mat4>) {
        const it = new VertexIterator(vertexBuffer);
        const positions = it.element[SEMANTIC_POSITION];
        const normals = it.element[SEMANTIC_NORMAL];
        const blendIndices = it.element[SEMANTIC_BLENDINDICES];
        const blendWeights = it.element[SEMANTIC_BLENDWEIGHT];

        if (!positions || !normals) {
            return;
        }

        const numVertices = vertexBuffer.getNumVertices();
        const p0 = new Vec3();
        const p1 = new Vec3();
        const skinMat = new Mat4();

        for (let i = 0; i < numVertices; ++i) {
            // get local/morphed positions and normals
            p0.set(positions.get(0), positions.get(1), positions.get(2));
            p1.set(normals.get(0), normals.get(1), normals.get(2));

            if (blendIndices && blendWeights && skinMatrices) {
                // transform by skinning matrices
                skinMat.copy(Mat4.ZERO);
                for (let j = 0; j < 4; ++j) {
                    DebugLines.matrixMad(
                        skinMat,
                        skinMatrices[blendIndices.get(j)],
                        blendWeights.get(j)
                    );
                }
                skinMat.mul2(worldMat, skinMat);
                skinMat.transformPoint(p0, p0);
                skinMat.transformVector(p1, p1);
            } else {
                worldMat.transformPoint(p0, p0);
                worldMat.transformVector(p1, p1);
            }

            p1.normalize().mulScalar(length).add(p0);

            this.line(p0, p1);

            it.next();
        }
    }

    // render a bone originating at p0 and ending at p1
    bone(p0: Vec3, p1: Vec3, clr = 0xffffffff) {
        mat.setLookAt(p0, p1, up);

        v0.sub2(p1, p0);
        const len = v0.length();
        const transform = (v: Vec3, va: number[]) => {
            v0.set(va[0] * len * 0.3, va[1] * len * 0.3, va[2] * -len);
            mat.transformPoint(v0, v);
        };

        unitBone.forEach((line) => {
            transform(v1, line[0]);
            transform(v2, line[1]);
            this.line(v1, v2, clr);
        });
    }

    // render a colored axis at the given matrix orientation and size
    axis(m: Mat4, size = 1) {
        m.getTranslation(v0);
        m.getScale(v2);

        // ignore matrix scale
        v2.set(size / v2.x, size / v2.y, size / v2.z);

        m.getX(v1).mul(v2).add(v0);
        this.line(v0, v1, 0xff0000ff);

        m.getY(v1).mul(v2).add(v0);
        this.line(v0, v1, 0xff00ff00);

        m.getZ(v1).mul(v2).add(v0);
        this.line(v0, v1, 0xffff0000);
    }

    // generate skeleton
    generateSkeleton(node: GraphNode, showBones: boolean, showAxes: boolean, selectedNode: GraphNode) {
        const recurse = (curr: GraphNode, selected: boolean) => {
            if (curr.enabled) {
                selected ||= (curr === selectedNode);

                // render child links
                for (let i = 0; i < curr.children.length; ++i) {
                    const child = curr.children[i];
                    if (showBones) {
                        this.bone(curr.getPosition(), child.getPosition(), selected ? 0xffffff00 : 0xffffffff);
                    }
                    recurse(child, selected);
                }

                // render axis
                if (showAxes) {
                    const parent = node.parent;
                    if (parent) {
                        v0.sub2(curr.getPosition(), parent.getPosition());
                        this.axis(curr.getWorldTransform(), v0.length() * 0.05);
                    }
                }
            }
        };
        recurse(node, false);
    }

    update() {
        const empty = this.vertexCursor === 0;
        if (!empty) {
            this.meshInstances.forEach((m) => {
                m.visible = true;
            });
            this.mesh.vertexBuffer.unlock();
            this.mesh.primitive[0].count = this.vertexCursor * 2;
            this.vertexCursor = 0;
        } else {
            this.meshInstances.forEach((m) => {
                m.visible = false;
            });
        }
    }
}

/**
 * Полупрозрачная заливка отладочных объёмов треугольниками с additive-блендом.
 *
 * В отличие от `DebugLines` (каркас), рисует грани: пересечения объёмов складываются и
 * становятся ярче — получается «плотностный» вид, где вложенные боксы не сливаются в кашу
 * из рёбер. Аддитивный бленд не зависит от порядка отрисовки (сортировка не нужна), глубина
 * не пишется (боксы не перекрывают друг друга), но тестируется — реальная геометрия сцены
 * закрывает грани за собой.
 */
class DebugSolid {
    app: App;

    mesh: Mesh;

    meshInstance: MeshInstance;

    vertexCursor: number;

    vertexData: Float32Array;

    colorData: Uint32Array;

    constructor(app: App, camera: Entity, overlay = true) {
        const device = app.graphicsDevice;

        ensureDebugLayers(app, camera);

        const vertexFormat = new VertexFormat(device, [
            { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_COLOR, components: 4, type: TYPE_UINT8, normalize: true }
        ]);

        const mesh = new Mesh(device);
        mesh.vertexBuffer = new VertexBuffer(device, vertexFormat, 8192, { usage: BUFFER_DYNAMIC });
        mesh.primitive[0].type = PRIMITIVE_TRIANGLES;
        mesh.primitive[0].base = 0;
        mesh.primitive[0].indexed = false;
        mesh.primitive[0].count = 0;

        const material = new ShaderMaterial(debugShaderArgs('debug-solid'));
        material.setParameter('uColor', [1, 1, 1, 1]);
        // Контуры рисуем поверх модели, а опциональную заливку — с обычным тестом глубины.
        // Запись глубины в обоих случаях выключена: прозрачная геометрия не должна менять
        // видимость модели и следующих отладочных примитивов.
        material.blendType = BLEND_NORMAL;
        material.cull = CULLFACE_NONE;
        if (overlay) {
            material.depthState.func = FUNC_ALWAYS;
        }
        material.depthState.write = false;
        material.update();

        const instance = new MeshInstance(mesh, material, new GraphNode());
        instance.cull = false;
        instance.visible = false;
        debugLayerFront.addMeshInstances([instance], true);

        this.app = app;
        this.mesh = mesh;
        this.meshInstance = instance;
        this.vertexCursor = 0;
        this.vertexData = new Float32Array(mesh.vertexBuffer.lock());
        this.colorData = new Uint32Array(mesh.vertexBuffer.lock());
    }

    clear(): void {
        this.vertexCursor = 0;
    }

    // Записать одну вершину (позиция + цвет 0xAABBGGRR), при нехватке места удвоив буфер.
    private vertex(p: Vec3, clr: number): void {
        if (this.vertexCursor >= this.vertexData.length / 4) {
            const oldVBuffer = this.mesh.vertexBuffer;
            const byteSize = oldVBuffer.lock().byteLength * 2;
            const arrayBuffer = new ArrayBuffer(byteSize);

            this.mesh.vertexBuffer = new VertexBuffer(
                this.app.graphicsDevice,
                oldVBuffer.getFormat(),
                oldVBuffer.getNumVertices() * 2,
                { usage: BUFFER_DYNAMIC, data: arrayBuffer }
            );
            this.vertexData = new Float32Array(arrayBuffer);
            this.colorData = new Uint32Array(arrayBuffer);
            this.colorData.set(new Uint32Array(oldVBuffer.lock()));
        }

        const i = this.vertexCursor * 4;
        this.vertexData[i] = p.x;
        this.vertexData[i + 1] = p.y;
        this.vertexData[i + 2] = p.z;
        this.colorData[i + 3] = clr;
        this.vertexCursor++;
    }

    // Прямоугольник из двух треугольников (углы по кругу a→b→c→d).
    private quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, clr: number): void {
        this.vertex(a, clr);
        this.vertex(b, clr);
        this.vertex(c, clr);
        this.vertex(a, clr);
        this.vertex(c, clr);
        this.vertex(d, clr);
    }

    /**
     * Залить шесть граней OBB сплошняком. Интенсивность (альфа `clr`) задаёт вызывающий —
     * шахматное чередование альфы у соседних блоков делает границу между ними читаемой.
     *
     * @param center - Центр бокса.
     * @param ax - Первая полуось.
     * @param ay - Вторая полуось.
     * @param az - Третья полуось.
     * @param clr - Цвет граней (0xAABBGGRR); альфа в старшем байте задаёт интенсивность.
     */
    obbFaces(center: Vec3, ax: Vec3, ay: Vec3, az: Vec3, clr = 0x40ffffff): void {
        const axes = [ax, ay, az];
        for (let f = 0; f < obbFaceAxes.length; ++f) {
            const face = obbFaceAxes[f];
            const a = axes[face[0]];
            const b = axes[face[1]];
            const n = axes[face[2]];
            const sign = face[3];
            const cx = center.x + sign * n.x;
            const cy = center.y + sign * n.y;
            const cz = center.z + sign * n.z;
            // Четыре угла грани: центр грани ± A ± B.
            sp0.set(cx - a.x - b.x, cy - a.y - b.y, cz - a.z - b.z);
            sp1.set(cx + a.x - b.x, cy + a.y - b.y, cz + a.z - b.z);
            sp2.set(cx + a.x + b.x, cy + a.y + b.y, cz + a.z + b.z);
            sp3.set(cx - a.x + b.x, cy - a.y + b.y, cz - a.z + b.z);
            this.quad(sp0, sp1, sp2, sp3, clr);
        }
    }

    /**
     * Полупрозрачная сфера, заданная тремя полуосями сущности.
     *
     * Собирается из четырёхугольников по широтам и долготам — отдельного примитива для сферы
     * у нас нет, а `quad` уже умеет всё нужное. На полюсах четырёхугольник вырождается в
     * треугольник, это допустимо и лишних артефактов не даёт.
     *
     * @param center - Центр сферы.
     * @param ax - Первая полуось; её длина задаёт радиус.
     * @param ay - Вторая полуось.
     * @param az - Третья полуось.
     * @param clr - Цвет (0xAABBGGRR); альфа в старшем байте задаёт интенсивность.
     */
    sphereFaces(center: Vec3, ax: Vec3, ay: Vec3, az: Vec3, clr = 0x40ffffff): void {
        const LAT = 12;
        const LON = 24;
        const put = (target: Vec3, lat: number, lon: number) => {
            const cosLat = Math.cos(lat);
            const sinLat = Math.sin(lat);
            const cosLon = Math.cos(lon);
            const sinLon = Math.sin(lon);
            target.set(
                center.x + ax.x * cosLat * cosLon + ay.x * sinLat + az.x * cosLat * sinLon,
                center.y + ax.y * cosLat * cosLon + ay.y * sinLat + az.y * cosLat * sinLon,
                center.z + ax.z * cosLat * cosLon + ay.z * sinLat + az.z * cosLat * sinLon
            );
        };

        for (let i = 0; i < LAT; ++i) {
            const lat0 = -Math.PI / 2 + (i / LAT) * Math.PI;
            const lat1 = -Math.PI / 2 + ((i + 1) / LAT) * Math.PI;
            for (let j = 0; j < LON; ++j) {
                const lon0 = (j / LON) * Math.PI * 2;
                const lon1 = ((j + 1) / LON) * Math.PI * 2;
                put(sp0, lat0, lon0);
                put(sp1, lat0, lon1);
                put(sp2, lat1, lon1);
                put(sp3, lat1, lon0);
                this.quad(sp0, sp1, sp2, sp3, clr);
            }
        }
    }

    /**
     * Полупрозрачные грани усечённой пирамиды/ортографического фрустума камеры.
     * Углы идут по кругу: верх-лево, верх-право, низ-право, низ-лево.
     *
     * @param nearCorners - Четыре угла ближнего сечения.
     * @param farCorners - Четыре угла дальнего сечения.
     * @param sideClr - Цвет боковых граней (0xAABBGGRR).
     * @param capClr - Цвет дальнего сечения (0xAABBGGRR).
     */
    frustumFaces(nearCorners: Vec3[], farCorners: Vec3[], sideClr = 0x12ffff00, capClr = 0x0800ffff): void {
        if (nearCorners.length < 4 || farCorners.length < 4) {
            return;
        }
        for (let i = 0; i < 4; ++i) {
            const next = (i + 1) % 4;
            this.quad(nearCorners[i], nearCorners[next], farCorners[next], farCorners[i], sideClr);
        }
        this.quad(farCorners[0], farCorners[1], farCorners[2], farCorners[3], capClr);
    }

    // Толстая линия p0→p1 как повёрнутая к камере лента шириной ~`width·dist` (постоянная в
    // пикселях). Ширина растёт с расстоянием, поэтому на экране толщина примерно одинаковая.
    private thickLine(p0: Vec3, p1: Vec3, camPos: Vec3, width: number, clr: number): void {
        smid.set((p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5, (p0.z + p1.z) * 0.5);
        sview.sub2(camPos, smid);
        const dist = sview.length() || 1;
        sview.mulScalar(1 / dist);
        sedge.sub2(p1, p0);
        if (sedge.lengthSq() < 1e-12) {
            return;
        }
        sedge.normalize();
        sperp.cross(sedge, sview);
        const plen = sperp.length();
        if (plen < 1e-6) {
            return;
        }
        sperp.mulScalar((width * dist) / plen);
        sp0.set(p0.x - sperp.x, p0.y - sperp.y, p0.z - sperp.z);
        sp1.set(p1.x - sperp.x, p1.y - sperp.y, p1.z - sperp.z);
        sp2.set(p1.x + sperp.x, p1.y + sperp.y, p1.z + sperp.z);
        sp3.set(p0.x + sperp.x, p0.y + sperp.y, p0.z + sperp.z);
        this.quad(sp0, sp1, sp2, sp3, clr);
    }

    /**
     * 12 рёбер OBB толстыми лентами, повёрнутыми к камере (контуры блока).
     *
     * @param center - Центр бокса.
     * @param ax - Первая полуось.
     * @param ay - Вторая полуось.
     * @param az - Третья полуось.
     * @param camPos - Позиция камеры (для ориентации лент).
     * @param width - Полуширина в долях расстояния (~постоянная толщина в пикселях).
     * @param clr - Цвет (0xAABBGGRR).
     */
    obbEdgesThick(center: Vec3, ax: Vec3, ay: Vec3, az: Vec3, camPos: Vec3, width: number, clr: number): void {
        let i = 0;
        for (let sx = -1; sx <= 1; sx += 2) {
            for (let sy = -1; sy <= 1; sy += 2) {
                for (let sz = -1; sz <= 1; sz += 2) {
                    obbCorners[i].set(
                        center.x + sx * ax.x + sy * ay.x + sz * az.x,
                        center.y + sx * ax.y + sy * ay.y + sz * az.y,
                        center.z + sx * ax.z + sy * ay.z + sz * az.z
                    );
                    i++;
                }
            }
        }
        for (let e = 0; e < obbEdges.length; ++e) {
            this.thickLine(obbCorners[obbEdges[e][0]], obbCorners[obbEdges[e][1]], camPos, width, clr);
        }
    }

    update(): void {
        if (this.vertexCursor === 0) {
            this.meshInstance.visible = false;
            return;
        }
        this.meshInstance.visible = true;
        this.mesh.vertexBuffer.unlock();
        this.mesh.primitive[0].count = this.vertexCursor;
        this.vertexCursor = 0;
    }
}

export {
    DebugLines,
    DebugSolid
};
