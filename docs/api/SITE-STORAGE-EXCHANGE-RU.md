# Схема обмена портала и сервера хранения

Основной Canvas: [`site-storage-two-canvases.canvas`](obsidian/site-storage-two-canvases.canvas)

Версия для draw.io: [`site-storage-two-canvases.drawio`](drawio/site-storage-two-canvases.drawio)

Старый компактный Canvas: [`site-storage-exchange.canvas`](obsidian/site-storage-exchange.canvas)

## Основная идея

Сайт 3D-наследие и сервер хранения решают разные задачи.

Сайт хранит культурный объект, сквозной `H3DID`, метаданные, связи с реестрами, права, статус публикации и страницу каталога. Сервер хранения хранит файлы, технические статусы, preview, POI, signed URLs и embed для плеера.

## Левая зона: сайт / портал

Главный ID на сайте:

```text
h3druObjectId / H3DID
```

Примерная структура:

```text
h3druObjectId
  -> twinId
    -> h3druAssetId
      -> storageAssetId
```

Портал отвечает за:

- карточку культурного объекта;
- CIDOC CRM / Dublin Core профиль;
- externalIds: ЕГРОКН, Госкаталог, КАМИС, Геоскан Cloud UUID;
- организацию и владельца;
- роли и права;
- статус публикации;
- каталог и публичную страницу;
- выбор активного цифрового двойника и плеера.

## Правая зона: сервер хранения / плеер

Главный технический ID на сервере:

```text
storageAssetId
```

Сервер хранения отвечает за:

- прием файлов;
- `storageKey` в S3/object storage;
- processing status;
- preview/poster/screenshot;
- POI JSON;
- fileUrl / downloadUrl;
- embed iframe;
- webhooks о статусе.

## Команды обмена

| Направление | Endpoint | Что передается |
|---|---|---|
| Сайт -> Сервер | `POST /storage/v1/uploads` | `twinId`, `h3druAssetId`, fileName, contentType, sizeBytes |
| Сайт -> Сервер | `POST /storage/v1/uploads/{uploadId}/complete` | checksum, sizeBytes |
| Сервер -> Сайт | `StorageAsset` | `storageAssetId`, `h3druAssetId`, `twinId`, `storageKey`, status |
| Сайт -> Сервер | `GET /storage/v1/assets/{storageAssetId}/status` | запрос статуса обработки |
| Сервер -> Сайт | `POST /storage/v1/webhooks/asset-status` | webhook о готовности/ошибке |
| Сайт -> Сервер | `GET /storage/v1/assets/{storageAssetId}/preview` | preview для каталога |
| Сайт -> Сервер | `GET /storage/v1/assets/{storageAssetId}/poi` | POI для PlayCanvas |
| Сайт -> Сервер | `PUT /storage/v1/assets/{storageAssetId}/poi` | сохранение POI |
| Сайт -> Сервер | `POST /storage/v1/embed` | параметры viewer |
| Сервер -> Сайт | `StorageEmbedResponse` | `iframeUrl`, `iframeHtml`, query |
| Сайт -> Сервер | `GET /storage/v1/assets/{storageAssetId}/download-url` | временная ссылка для скачивания |

## Главное разделение

```text
H3DID / h3druObjectId = объект культуры на сайте
storageAssetId = технический файл на сервере хранения
```

Портал знает, какой файл относится к какому объекту. Сервер хранения знает, где лежит файл и как его выдать плееру.
