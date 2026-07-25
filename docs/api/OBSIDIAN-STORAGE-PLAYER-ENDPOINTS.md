# API сервера хранения и плееров

Эта карта для Obsidian описывает только API сервера хранения и плееров. Здесь нет API портала, карточек культурного объекта, CIDOC CRM, Dublin Core, КАМИС, Госкаталога и ЕГРОКН.

Источник спецификации: `storage-player-openapi.yaml`

Всего endpoints: 15

## Навигация

- [[#Upload]]
- [[#Assets]]
- [[#Processing]]
- [[#Preview]]
- [[#POI]]
- [[#Download]]
- [[#Embed]]
- [[#Webhooks]]
- [[#Параметры embed]]
- [[#PostMessage команды плеера]]
- [[#Что не входит в этот API]]

## Карта endpoints

```mermaid
flowchart LR
  Portal["Портал 3D-наследие"]
  Storage["Сервер хранения / плееров"]
  Player["Плеер<br/>PlayCanvas / Geoscan / Gigapixel"]

  Portal --> Upload
  Portal --> Assets
  Portal --> Preview
  Portal --> POI
  Portal --> Processing
  Portal --> Download
  Portal --> Embed
  Storage --> Player
  Storage --> Webhooks
  Webhooks --> Portal

  subgraph Upload["Upload"]
    U1["POST /storage/v1/uploads<br/>Получить uploadUrl"]
    U2["POST /storage/v1/uploads/{uploadId}/complete<br/>Подтвердить загрузку"]
  end

  subgraph Assets["Assets"]
    A1["GET /storage/v1/assets/{storageAssetId}<br/>Техническая карточка файла"]
    A2["GET /storage/v1/assets/{storageAssetId}/file-url<br/>URL файла для просмотра"]
    A3["DELETE /storage/v1/assets/{storageAssetId}<br/>Удалить файл"]
    A4["POST /storage/v1/assets/{storageAssetId}/archive<br/>Переместить в архив"]
    A5["POST /storage/v1/assets/{storageAssetId}/restore<br/>Восстановить из архива"]
  end

  subgraph Processing["Processing"]
    PR1["GET /storage/v1/assets/{storageAssetId}/status<br/>Статус обработки"]
  end

  subgraph Preview["Preview"]
    PV1["GET /storage/v1/assets/{storageAssetId}/preview<br/>Получить превью"]
    PV2["POST /storage/v1/assets/{storageAssetId}/preview<br/>Создать/обновить превью"]
  end

  subgraph POI["POI"]
    P1["GET /storage/v1/assets/{storageAssetId}/poi<br/>Получить точки интереса"]
    P2["PUT /storage/v1/assets/{storageAssetId}/poi<br/>Сохранить точки интереса"]
  end

  subgraph Download["Download"]
    D1["GET /storage/v1/assets/{storageAssetId}/download-url<br/>Временная ссылка для скачивания"]
  end

  subgraph Embed["Embed"]
    E1["POST /storage/v1/embed<br/>Сформировать iframe"]
  end

  subgraph Webhooks["Webhooks"]
    W1["POST /storage/v1/webhooks/asset-status<br/>Webhook о статусе файла"]
  end

  U1 --> U2 --> A1
  A1 --> A2
  A1 --> PR1
  PR1 --> PV1
  PR1 --> E1
  A1 --> P1
  P1 --> P2
  A1 --> D1
```

## Список endpoints

### Upload

| Method | Endpoint | Описание |
|---|---|---|
| `POST` | `/storage/v1/uploads` | Получить временную ссылку для загрузки файла. [details](#post-storagev1uploads) |
| `POST` | `/storage/v1/uploads/{uploadId}/complete` | Подтвердить завершение загрузки. [details](#post-storagev1uploadidcomplete) |

### Assets

| Method | Endpoint | Описание |
|---|---|---|
| `GET` | `/storage/v1/assets/{storageAssetId}` | Получить техническую карточку файла. [details](#get-storagev1assetsstorageassetid) |
| `GET` | `/storage/v1/assets/{storageAssetId}/file-url` | Получить URL файла для просмотра. [details](#get-storagev1assetsstorageassetidfile-url) |
| `DELETE` | `/storage/v1/assets/{storageAssetId}` | Удалить файл или пометить его на удаление. [details](#delete-storagev1assetsstorageassetid) |
| `POST` | `/storage/v1/assets/{storageAssetId}/archive` | Переместить файл в архивный класс хранения. [details](#post-storagev1assetsstorageassetidarchive) |
| `POST` | `/storage/v1/assets/{storageAssetId}/restore` | Восстановить файл из архивного класса хранения. [details](#post-storagev1assetsstorageassetidrestore) |

### Processing

| Method | Endpoint | Описание |
|---|---|---|
| `GET` | `/storage/v1/assets/{storageAssetId}/status` | Получить статус загрузки/обработки файла. [details](#get-storagev1assetsstorageassetidstatus) |

### Preview

| Method | Endpoint | Описание |
|---|---|---|
| `GET` | `/storage/v1/assets/{storageAssetId}/preview` | Получить превью файла. [details](#get-storagev1assetsstorageassetidpreview) |
| `POST` | `/storage/v1/assets/{storageAssetId}/preview` | Создать или обновить превью файла. [details](#post-storagev1assetsstorageassetidpreview) |

### POI

| Method | Endpoint | Описание |
|---|---|---|
| `GET` | `/storage/v1/assets/{storageAssetId}/poi` | Получить точки интереса для PlayCanvas-плеера. [details](#get-storagev1assetsstorageassetidpoi) |
| `PUT` | `/storage/v1/assets/{storageAssetId}/poi` | Сохранить точки интереса для PlayCanvas-плеера. [details](#put-storagev1assetsstorageassetidpoi) |

### Download

| Method | Endpoint | Описание |
|---|---|---|
| `GET` | `/storage/v1/assets/{storageAssetId}/download-url` | Получить временную ссылку для скачивания. [details](#get-storagev1assetsstorageassetiddownload-url) |

### Embed

| Method | Endpoint | Описание |
|---|---|---|
| `POST` | `/storage/v1/embed` | Получить iframe для файла или облачного проекта. [details](#post-storagev1embed) |

### Webhooks

| Method | Endpoint | Описание |
|---|---|---|
| `POST` | `/storage/v1/webhooks/asset-status` | Webhook о статусе файла в сторону портала. [details](#post-storagev1webhooksasset-status) |

## Детали endpoints

### POST /storage/v1/uploads

<a id="post-storagev1uploads"></a>

- Блок: Upload
- Назначение: получить временную ссылку для загрузки файла.
- Auth: `serviceBearerAuth`
- Request schema: `CreateUploadRequest`
- Response: `201 UploadUrlResponse`

### POST /storage/v1/uploads/{uploadId}/complete

<a id="post-storagev1uploadidcomplete"></a>

- Блок: Upload
- Назначение: подтвердить завершение загрузки.
- Auth: `serviceBearerAuth`
- Path parameter: `uploadId`
- Request schema: `CompleteUploadRequest`
- Response: `201 StorageAsset`

### GET /storage/v1/assets/{storageAssetId}

<a id="get-storagev1assetsstorageassetid"></a>

- Блок: Assets
- Назначение: получить техническую карточку файла.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `200 StorageAsset`

### DELETE /storage/v1/assets/{storageAssetId}

<a id="delete-storagev1assetsstorageassetid"></a>

- Блок: Assets
- Назначение: удалить файл или пометить его на удаление.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `202 StorageOperation`

### GET /storage/v1/assets/{storageAssetId}/file-url

<a id="get-storagev1assetsstorageassetidfile-url"></a>

- Блок: Assets
- Назначение: получить URL файла для просмотра.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `200 FileUrlResponse`

### POST /storage/v1/assets/{storageAssetId}/archive

<a id="post-storagev1assetsstorageassetidarchive"></a>

- Блок: Assets
- Назначение: переместить файл в архивный класс хранения.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `202 StorageOperation`

### POST /storage/v1/assets/{storageAssetId}/restore

<a id="post-storagev1assetsstorageassetidrestore"></a>

- Блок: Assets
- Назначение: восстановить файл из архивного класса хранения.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Request schema: `RestoreArchiveRequest`
- Response: `202 StorageOperation`

### GET /storage/v1/assets/{storageAssetId}/status

<a id="get-storagev1assetsstorageassetidstatus"></a>

- Блок: Processing
- Назначение: получить статус загрузки/обработки файла.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `200 ProcessingStatus`

### GET /storage/v1/assets/{storageAssetId}/preview

<a id="get-storagev1assetsstorageassetidpreview"></a>

- Блок: Preview
- Назначение: получить превью файла.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Query parameter: `size`
- Response: `200 PreviewAsset`

### POST /storage/v1/assets/{storageAssetId}/preview

<a id="post-storagev1assetsstorageassetidpreview"></a>

- Блок: Preview
- Назначение: создать или обновить превью файла.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Request schema: `CreatePreviewRequest`
- Response: `202 StorageOperation`

### GET /storage/v1/assets/{storageAssetId}/poi

<a id="get-storagev1assetsstorageassetidpoi"></a>

- Блок: POI
- Назначение: получить точки интереса для PlayCanvas-плеера.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `200 PoiListResponse`

### PUT /storage/v1/assets/{storageAssetId}/poi

<a id="put-storagev1assetsstorageassetidpoi"></a>

- Блок: POI
- Назначение: сохранить точки интереса для PlayCanvas-плеера.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Request schema: `UpdatePoiListRequest`
- Response: `200 PoiListResponse`

### GET /storage/v1/assets/{storageAssetId}/download-url

<a id="get-storagev1assetsstorageassetiddownload-url"></a>

- Блок: Download
- Назначение: получить временную ссылку для скачивания.
- Auth: `serviceBearerAuth`
- Path parameter: `storageAssetId`
- Response: `200 DownloadUrlResponse`

### POST /storage/v1/embed

<a id="post-storagev1embed"></a>

- Блок: Embed
- Назначение: получить iframe для файла или облачного проекта.
- Auth: `serviceBearerAuth`
- Request schema: `CreateStorageEmbedRequest`
- Response: `200 StorageEmbedResponse`

### POST /storage/v1/webhooks/asset-status

<a id="post-storagev1webhooksasset-status"></a>

- Блок: Webhooks
- Назначение: webhook о статусе файла в сторону портала.
- Auth: `webhookSignature`
- Request schema: `AssetStatusWebhook`
- Response: `202`

## Параметры embed

`POST /storage/v1/embed` должен уметь собрать готовый `iframeUrl` и `iframeHtml`.

Для PlayCanvas viewer используются параметры:

| Параметр | Значение | Назначение |
|---|---|---|
| `load` / `assetUrl` | URL файла | Файл модели для загрузки. |
| `embed` | `0` / `1` | Включить iframe-режим. |
| `ui` | `full` / `compact` / `minimal` | Пресет интерфейса. |
| `lang` | `ru` / `en` / `zh` | Язык интерфейса. |
| `autoplay` | `0` / `1` | Запускать сразу или ждать клика. |
| `panel` | `0` / `1` | Показывать боковую панель. |
| `poi` | `0` / `1` | Показывать точки интереса. |
| `tour` | `0` / `1` | Показывать навигацию по точкам. |
| `measure` | `0` / `1` | Разрешить измерения. |
| `info` | `0` / `1` | Показывать информационные элементы. |
| `modelInfo` | `0` / `1` | Показывать техническую информацию о модели. |
| `controls` | `0` / `1` | Показывать кнопки управления. |
| `fullscreen` | `0` / `1` | Разрешить полноэкранный режим. |
| `fit` | `0` / `1` | Показывать кнопку вписать модель. |
| `reset` | `0` / `1` | Показывать кнопку сброса камеры. |
| `cameraPosition` | `x,y,z` | Начальная позиция камеры. |
| `cameraFocus` | `x,y,z` | Начальная точка фокуса камеры. |

## PostMessage команды плеера

Команды от страницы сайта во viewer:

| Command | Описание |
|---|---|
| `focus-poi` | Перейти к точке интереса по `id`. |
| `open-poi` | Открыть точку интереса, сейчас работает как `focus-poi`. |
| `clear-poi` | Снять активную точку. |
| `next-poi` | Перейти к следующей точке. |
| `prev-poi` | Перейти к предыдущей точке. |
| `seek-animation` | Перейти к времени/кадру анимации. |
| `play-animation` | Запустить анимацию. |
| `pause-animation` | Остановить анимацию. |
| `freeze-animation` | Зафиксировать анимацию на времени/кадре. |

События от viewer к странице сайта:

| Event | Описание |
|---|---|
| `poi-selected` | Активирована точка интереса. |
| `poi-cleared` | Активная точка сброшена. |
| `animation-time` | Изменилось время анимации. |

## Что не входит в этот API

- карточка культурного объекта;
- CIDOC CRM;
- Dublin Core;
- КАМИС, Госкаталог, ЕГРОКН;
- каталог сайта;
- портальная модерация;
- пользовательские роли портала;
- выбор активного цифрового двойника.
