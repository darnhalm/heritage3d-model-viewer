/**
 * Загрузка контента одного тайла и превращение его в entity PlayCanvas.
 *
 * Контент 3D Tiles 1.1 — обычный GLB, его читает штатный container-ассет движка. Формат
 * 1.0 заворачивает тот же GLB в `.b3dm`; разворачиваем его здесь, потому что своего парсера
 * у движка нет, а без этого недоступен единственный публичный сэмпл с настоящим
 * переключением уровней детализации (`TilesetWithDiscreteLOD`).
 */

import { Asset, Entity, Mat4, Quat, Vec3, type AppBase } from 'playcanvas';

/** Результат загрузки контента тайла. */
export type TileContentResult = {
    /** Корневая entity контента (ещё не привязана к сцене). */
    entity: Entity;
    /** Ассеты, которые нужно уничтожить при выгрузке тайла. */
    assets: Asset[];
    /** Приблизительный объём скачанного, байты. */
    bytes: number;
};

/**
 * Токен отмены: тайл может стать ненужным, пока его контент качается.
 *
 * `controller` прерывает сам HTTP-запрос. Ради этого файлы скачиваются здесь через `fetch`,
 * а движку отдаётся уже готовый буфер: у PlayCanvas Asset API отмены нет, и без своего
 * `fetch` уехавшая камера оставляла бы за собой хвост из уже ненужных загрузок, занимающих
 * слоты параллелизма.
 */
export type LoadToken = { cancelled: boolean; controller?: AbortController };

type ContainerResourceLike = {
    instantiateRenderEntity?: () => Entity;
};

/**
 * Развернуть `.b3dm` в GLB.
 *
 * Заголовок: magic(4) version(4) byteLength(4) featureTableJSONByteLength(4)
 * featureTableBinaryByteLength(4) batchTableJSONByteLength(4) batchTableBinaryByteLength(4),
 * дальше таблицы и GLB до конца файла.
 *
 * Из feature table берётся только `RTC_CENTER` — смещение «relative to center», которым
 * тайлы с большими координатами борются с потерей точности. Если его проигнорировать,
 * контент уедет в другую точку планеты.
 *
 * @param buffer - Содержимое `.b3dm`.
 * @returns GLB и, если он был, RTC-сдвиг.
 */
export function unwrapB3dm(buffer: ArrayBuffer): { glb: ArrayBuffer; rtcCenter: Vec3 | null } {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'b3dm') {
        throw new Error(`Ожидался b3dm, в файле magic "${magic}"`);
    }

    const featureTableJsonLength = view.getUint32(12, true);
    const featureTableBinLength = view.getUint32(16, true);
    const batchTableJsonLength = view.getUint32(20, true);
    const batchTableBinLength = view.getUint32(24, true);

    let rtcCenter: Vec3 | null = null;
    if (featureTableJsonLength > 0) {
        const text = new TextDecoder().decode(new Uint8Array(buffer, 28, featureTableJsonLength));
        try {
            const featureTable = JSON.parse(text);
            if (Array.isArray(featureTable.RTC_CENTER) && featureTable.RTC_CENTER.length === 3) {
                rtcCenter = new Vec3(featureTable.RTC_CENTER[0], featureTable.RTC_CENTER[1], featureTable.RTC_CENTER[2]);
            }
        } catch {
            // Битая feature table не повод не показывать геометрию.
        }
    }

    const glbOffset = 28 + featureTableJsonLength + featureTableBinLength +
        batchTableJsonLength + batchTableBinLength;
    return { glb: buffer.slice(glbOffset), rtcCenter };
}

/**
 * Загрузить содержимое blob-URL через container-ассет движка.
 *
 * @param app - Приложение.
 * @param url - Адрес blob.
 * @param filename - Имя, по которому движок выбирает парсер (для blob-URL это единственный
 * источник расширения).
 * @returns Загруженный ассет.
 */
function loadContainerAsset(app: AppBase, url: string, filename: string): Promise<Asset> {
    return new Promise((resolve, reject) => {
        const asset = new Asset(filename, 'container', { url, filename });
        asset.once('load', () => resolve(asset));
        asset.once('error', (err: string) => reject(new Error(String(err))));
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

/**
 * Загрузить контент тайла (один или несколько файлов) и собрать из него entity.
 *
 * Возвращаемая entity ещё не в сцене: привязывает её `TileManager`, он же ставит
 * трансформацию. Если во время загрузки тайл стал не нужен (`token.cancelled`), результат
 * уничтожается и наружу уходит `null`.
 *
 * Файлы одного тайла качаются параллельно: в 1.1 у тайла может быть несколько контентов,
 * и показать его можно только когда готовы все — последовательная загрузка просто
 * растянула бы ожидание.
 *
 * @param app - Приложение.
 * @param uris - Абсолютные URL контента.
 * @param token - Токен отмены.
 * @returns Контент или `null`, если загрузку отменили.
 */
export async function loadTileContent(
    app: AppBase,
    uris: string[],
    token: LoadToken
): Promise<TileContentResult | null> {
    const assets: Asset[] = [];
    const blobUrls: string[] = [];

    const cleanup = () => {
        assets.forEach((asset) => {
            app.assets.remove(asset);
            asset.unload();
        });
        blobUrls.forEach(u => URL.revokeObjectURL(u));
    };

    try {
        const parts = await Promise.all(uris.map(async (uri) => {
            const response = await fetch(uri, { signal: token.controller?.signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} на ${uri}`);
            }
            let buffer = await response.arrayBuffer();
            const bytes = buffer.byteLength;

            let rtcCenter: Vec3 | null = null;
            if (/\.b3dm(?:\?|$)/i.test(uri)) {
                const unwrapped = unwrapB3dm(buffer);
                buffer = unwrapped.glb;
                rtcCenter = unwrapped.rtcCenter;
            }

            const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
            blobUrls.push(blobUrl);

            // Расширение в имени — то, по чему движок выбирает парсер; у blob-URL другого
            // источника нет. `.gltf` c внешними буферами так не загрузить, но контентом
            // тайла в 3D Tiles 1.1 может быть только GLB.
            const asset = await loadContainerAsset(app, blobUrl, `${uri.split('/').pop() ?? 'tile'}.glb`);
            assets.push(asset);
            return { asset, rtcCenter, bytes };
        }));

        if (token.cancelled) {
            cleanup();
            return null;
        }

        const bytes = parts.reduce((sum, part) => sum + part.bytes, 0);
        const root = new Entity('tileContent');
        parts.forEach(({ asset, rtcCenter }) => {
            const resource = asset.resource as ContainerResourceLike | null;
            const entity = resource?.instantiateRenderEntity?.() ?? new Entity();
            if (rtcCenter) {
                // RTC_CENTER задан в системе тайла (Z-вверх), а контент под ним уже
                // повёрнут в Y-вверх, поэтому сдвиг ставится НАД поворотом — на
                // промежуточной entity.
                const holder = new Entity('rtc');
                holder.setLocalPosition(rtcCenter);
                holder.addChild(entity);
                root.addChild(holder);
            } else {
                root.addChild(entity);
            }
        });

        return { entity: root, assets, bytes };
    } catch (err) {
        cleanup();
        throw err;
    } finally {
        // Blob-URL нужен только на время разбора: GLB самодостаточен, дальше движок к
        // адресу не обращается. Не отозвать — значит держать копию файла в памяти вкладки
        // до перезагрузки страницы.
        blobUrls.forEach(u => URL.revokeObjectURL(u));
    }
}

/**
 * Уничтожить контент тайла: снять со сцены entity и выгрузить ассеты.
 *
 * Общие текстуры здесь не разделяются между тайлами — каждый тайл владеет своим
 * container-ассетом, поэтому выгрузка одного не может утащить ресурсы соседнего. Ценой
 * этого идёт дублирование данных, если два тайла ссылаются на один файл; для тайлсетов,
 * где каждый тайл — свой GLB, такого не бывает.
 *
 * @param app - Приложение.
 * @param entity - Entity контента.
 * @param assets - Ассеты контента.
 */
export function destroyTileContent(app: AppBase, entity: Entity | null, assets: Asset[]) {
    entity?.destroy();
    assets.forEach((asset) => {
        app.assets.remove(asset);
        asset.unload();
    });
}

/**
 * Поворот содержимого glTF (Y-вверх) в систему тайла (Z-вверх).
 *
 * Спецификация 3D Tiles требует этого явно: трансформации тайлов заданы в Z-вверх, а любой
 * glTF по определению Y-вверх.
 *
 * @returns Матрица поворота на +90° вокруг X.
 */
export function gltfUpAxisTransform(): Mat4 {
    return new Mat4().setTRS(Vec3.ZERO, new Quat().setFromEulerAngles(90, 0, 0), Vec3.ONE);
}
