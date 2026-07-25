# API сервера хранения и плееров

Это отдельное ТЗ для разработчиков сервера хранения, облачной платформы и плееров. Здесь нет API карточек культурных объектов, CIDOC CRM, Dublin Core, КАМИС, Госкаталога и ЕГРОКН.

Полная Swagger-спецификация: [`storage-player-openapi.yaml`](storage-player-openapi.yaml). Локальная страница Swagger UI: [`storage-player-swagger-ui.html`](storage-player-swagger-ui.html).

## Что делает сервер хранения

```text
получает файл
хранит файл
возвращает fileUrl / signedUrl
создает preview / poster / screenshot
хранит и возвращает POI для PlayCanvas-плеера
возвращает processing status
возвращает downloadUrl
архивирует / восстанавливает файлы
для облачного viewer может возвращать внешний embed
```

## Основные endpoints

```text
POST /storage/v1/uploads
Получить uploadUrl для прямой загрузки файла.
Если лимит хранилища исчерпан, сервер возвращает ошибку `quota_exceeded`
с данными тарифа, лимита, использованного места и текстом для пользователя.

POST /storage/v1/uploads/{uploadId}/complete
Подтвердить загрузку и зарегистрировать файл как storage asset.

GET /storage/v1/assets/{storageAssetId}
Получить техническую карточку файла.

GET /storage/v1/assets/{storageAssetId}/file-url
Получить URL файла для просмотра.

GET /storage/v1/assets/{storageAssetId}/status
Получить статус обработки.

GET /storage/v1/assets/{storageAssetId}/preview
Получить thumbnail/poster/screenshot.

POST /storage/v1/assets/{storageAssetId}/preview
Создать или обновить preview.

GET /storage/v1/assets/{storageAssetId}/poi
Получить список точек интереса для PlayCanvas-плеера.

PUT /storage/v1/assets/{storageAssetId}/poi
Сохранить список точек интереса для PlayCanvas-плеера.

GET /storage/v1/assets/{storageAssetId}/download-url
Получить временную ссылку для скачивания.

POST /storage/v1/assets/{storageAssetId}/archive
Переместить файл в архивный класс хранения.

POST /storage/v1/assets/{storageAssetId}/restore
Восстановить файл из архива.

DELETE /storage/v1/assets/{storageAssetId}
Удалить файл или пометить на удаление.

POST /storage/v1/embed
Получить iframe для файла или облачного проекта. В запросе можно передать параметры встройки.

POST /storage/v1/webhooks/asset-status
Webhook о статусе файла в сторону портала.
```

## Ошибка лимита хранилища

Если организация на базовом тарифе имеет лимит 50 ГБ и новый файл уже не помещается,
сервер хранения не должен выдавать `uploadUrl`. Вместо этого он возвращает ошибку:

```http
409 QuotaExceeded
```

Пример ответа:

```json
{
  "code": "quota_exceeded",
  "message": "Невозможно загрузить файл: лимит хранилища на базовом тарифе исчерпан.",
  "details": {
    "organizationId": "h3dru:organization:01JORG",
    "planCode": "base",
    "planName": "Базовый",
    "limitBytes": 53687091200,
    "limitHuman": "50 ГБ",
    "usedBytes": 53519319040,
    "usedHuman": "49.84 ГБ",
    "requestedBytes": 524288000,
    "requestedHuman": "500 МБ",
    "availableBytes": 167772160,
    "availableHuman": "160 МБ",
    "canRetry": false,
    "userMessage": "На базовом тарифе доступно 50 ГБ. Сейчас свободно 160 МБ, а файл занимает 500 МБ. Удалите лишние файлы или увеличьте лимит хранилища."
  }
}
```

Фронтенд сайта показывает пользователю `details.userMessage`, а технические поля
использует для интерфейса тарифа, прогресс-бара хранилища и кнопки перехода к
увеличению лимита.

## Что остается на стороне портала

```text
культурные объекты
H3DRU_ID как бизнес-сущности
CIDOC CRM
Dublin Core
КАМИС / Госкаталог / ЕГРОКН
каталог
модерация
права пользователей
выбор активного цифрового двойника
портальный manifest
```

## Точки интереса PlayCanvas

Для нашего PlayCanvas-плеера уже есть готовая структура POI. Поэтому серверу хранения не нужно понимать музейную семантику точки, ему достаточно хранить и отдавать технический JSON:

```json
{
  "id": "poi-1716280000000-1",
  "number": 1,
  "title": "Главный фасад",
  "description": "Краткое описание точки.",
  "color": "#000000",
  "duration": 1,
  "holdTime": 2,
  "position": [1.25, 0.5, -2.1],
  "normal": [0, 1, 0],
  "camera": {
    "position": [2, 2, 2],
    "focus": [0, 0, 0],
    "fov": 45
  }
}
```

`position` и `normal` нужны, чтобы поставить маркер на поверхности модели. `camera` нужен, чтобы при клике по точке плеер мог перелететь в сохраненный ракурс. На странице сайта управление идет через `postMessage`: `focus-poi`, `open-poi`, `clear-poi`, `next-poi`, `prev-poi`, а плеер возвращает события `poi-selected` и `poi-cleared`.

## Параметры embed-встройки

Сервер хранения/плеера должен уметь собрать готовый `iframeUrl` и `iframeHtml`, чтобы сайт не склеивал query string вручную.

Минимальный запрос:

```json
{
  "storageAssetId": "st_01JASSET",
  "h3druObjectId": "h3dru:object:01JOBJABCDEF1234567890",
  "h3druAssetId": "h3dru:asset:01JASSET",
  "playerType": "playcanvas_3d",
  "lang": "ru",
  "preset": "compact",
  "autoplay": false,
  "accessMode": "public",
  "tokenTtlSeconds": 3600,
  "ui": {
    "panel": false,
    "poi": true,
    "tour": true,
    "measure": false,
    "info": true,
    "modelInfo": false,
    "controls": true,
    "fullscreen": true,
    "fit": true,
    "reset": true
  },
  "camera": {
    "position": [2, 2, 2],
    "focus": [0, 0, 0]
  },
  "manifestUrl": null,
  "assetUrl": null,
  "width": 960,
  "height": 640,
  "title": "3D Viewer",
  "allowFullscreen": true,
  "referrerPolicy": "strict-origin-when-cross-origin",
  "sandbox": ["allow-scripts", "allow-same-origin", "allow-popups"]
}
```

Ответ API должен вернуть не только готовый HTML, но и разложенные параметры,
чтобы фронт мог показать/проверить, из чего собрана встройка:

```json
{
  "playerType": "playcanvas_3d",
  "embedSource": "storage_generated",
  "iframeUrl": "https://player.example.ru/viewer/?manifest=https%3A%2F%2Fstorage.example.ru%2Fmanifest%2Fst_01JASSET&embed=1&ui=compact&lang=ru&autoplay=0&panel=0&poi=1&tour=1&measure=0&info=1&modelInfo=0&controls=1&fullscreen=1&fit=1&reset=1",
  "iframeHtml": "<iframe title=\"3D Viewer\" src=\"https://player.example.ru/viewer/?...\" width=\"960\" height=\"640\" allow=\"fullscreen; xr-spatial-tracking\" allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\" sandbox=\"allow-scripts allow-same-origin allow-popups\"></iframe>",
  "externalEmbedUrl": null,
  "embedToken": null,
  "tokenExpiresAt": null,
  "manifestUrl": "https://storage.example.ru/manifest/st_01JASSET",
  "assetUrl": null,
  "query": {
    "manifest": "https://storage.example.ru/manifest/st_01JASSET",
    "embed": "1",
    "ui": "compact",
    "lang": "ru",
    "autoplay": "0",
    "panel": "0",
    "poi": "1",
    "tour": "1",
    "measure": "0",
    "info": "1",
    "modelInfo": "0",
    "controls": "1",
    "fullscreen": "1",
    "fit": "1",
    "reset": "1",
    "cameraPosition": "2,2,2",
    "cameraFocus": "0,0,0"
  },
  "iframe": {
    "src": "https://player.example.ru/viewer/?...",
    "title": "3D Viewer",
    "width": 960,
    "height": 640,
    "allow": "fullscreen; xr-spatial-tracking",
    "allowFullscreen": true,
    "referrerPolicy": "strict-origin-when-cross-origin",
    "sandbox": ["allow-scripts", "allow-same-origin", "allow-popups"]
  }
}
```

Для PlayCanvas viewer request превращается в query-параметры:

```text
load / assetUrl - ссылка на файл модели
embed=1 - режим iframe
ui=full|compact|minimal - пресет интерфейса
lang=ru|en|zh - язык
autoplay=0|1 - запускать сразу или ждать клика
panel=0|1 - боковая панель
poi=0|1 - точки интереса
tour=0|1 - навигация по точкам
measure=0|1 - измерения
info=0|1 - информационные элементы
modelInfo=0|1 - техническая информация о модели
controls=0|1 - кнопки управления
fullscreen=0|1 - полноэкранный режим
fit=0|1 - кнопка вписать модель
reset=0|1 - кнопка сброса камеры
cameraPosition=x,y,z - начальная позиция камеры
cameraFocus=x,y,z - точка фокуса камеры
```
