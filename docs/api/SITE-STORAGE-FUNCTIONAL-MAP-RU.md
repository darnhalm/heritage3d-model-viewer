# Функциональная связка API сайта и storage/player

Слева endpoints сайта, справа endpoints сервера хранения/плеера. Важная идея: методы не обязаны совпадать. `GET` сайта может внутри вызывать `POST` storage, если сайт отдает готовый результат пользователю, а внутри формирует его на storage.

## Связки по функциям

| Endpoint сайта | Endpoint storage/player | Зачем связаны |
|---|---|---|
| `POST /site/v1/twins/{twinId}/assets` | `POST /storage/v1/uploads` | сайт создает запись и запрашивает uploadUrl |
| `POST /storage/v1/uploads/{uploadId}/complete` | `POST /site/v1/assets/{h3druAssetId}/link-storage` | storage возвращает storageAssetId, сайт сохраняет связку |
| `GET /site/v1/assets/{h3druAssetId}` | `GET /storage/v1/assets/{storageAssetId}` | сайт может подтянуть технический статус файла |
| `GET /site/v1/assets/{h3druAssetId}` | `GET /storage/v1/assets/{storageAssetId}/status` | сайт проверяет processing status |
| `GET /site/v1/catalog/objects` | `GET /storage/v1/assets/{storageAssetId}/preview` | каталог берет preview для карточек |
| `GET /site/v1/catalog/objects/{slugOrH3DID}` | `GET /storage/v1/assets/{storageAssetId}/preview` | страница объекта берет preview/poster |
| `GET /site/v1/catalog/objects/{slugOrH3DID}` | `GET /storage/v1/assets/{storageAssetId}/file-url` | страница/viewer получает fileUrl при необходимости |
| `GET /site/v1/objects/{h3druObjectId}/embed` | `POST /storage/v1/embed` | GET сайта внутри вызывает POST storage embed |
| `POST /site/v1/assets/{h3druAssetId}/embed` | `POST /storage/v1/embed` | POST сайта внутри вызывает POST storage embed |
| `GET /site/v1/assets/{h3druAssetId}/poi` | `GET /storage/v1/assets/{storageAssetId}/poi` | GET сайта проксирует GET storage POI |
| `PUT /site/v1/assets/{h3druAssetId}/poi` | `PUT /storage/v1/assets/{storageAssetId}/poi` | PUT сайта проксирует PUT storage POI |
| `GET /site/v1/assets/{h3druAssetId}/download` | `GET /storage/v1/assets/{storageAssetId}/download-url` | сайт проверяет права и запрашивает signed downloadUrl |
| `POST /site/v1/assets/{h3druAssetId}/archive` | `POST /storage/v1/assets/{storageAssetId}/archive` | сайт проверяет права и отправляет в архив |
| `POST /site/v1/assets/{h3druAssetId}/restore` | `POST /storage/v1/assets/{storageAssetId}/restore` | сайт проверяет права и восстанавливает из архива |
| `DELETE /site/v1/assets/{h3druAssetId}` | `DELETE /storage/v1/assets/{storageAssetId}` | сайт проверяет права и удаляет storage asset |
| `POST /storage/v1/webhooks/asset-status` | `POST /site/v1/webhooks/storage/asset-status` | storage сам вызывает POST endpoint сайта |

## Правило

```text
API сайта = H3DID, карточка, каталог, права, публикация.
API storage/player = storageAssetId, файлы, preview, POI, embed, download.
Endpoint сайта может вызывать endpoint storage с другим HTTP-методом.
```
