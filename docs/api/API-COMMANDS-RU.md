# Справочник API портала 3D-наследие

Краткий справочник по HTTP API, iframe-встройке и `postMessage`-командам. Полная спецификация: [`openapi.yaml`](openapi.yaml). Локальная страница Swagger UI: [`swagger-ui.html`](swagger-ui.html).

## Базовая логика

```text
H3DRU_ID -> manifestUrl -> iframeUrl -> player -> media asset
```

Портал не передает плееру полную карточку объекта. Для открытия цифрового представления портал формирует `manifestUrl` на основе `H3DRU_ID`, а endpoint `/embed` возвращает готовый `iframeUrl` и `iframeHtml`.

Поддерживаемые типы просмотрщиков:

```text
PlayCanvas viewer
  GLB / glTF / web 3D

Geoscan / Agisoft Cloud viewer
  облачный проект / внешний embed

Gigapixel 2D viewer
  IIIF / DZI / tile pyramid
```

## Минимальный API для MVP

```text
GET  /api/v1/twins/{twinId}/manifest
Тип: чтение
Описание: получить manifest для плеера. В manifest входят H3DRU_ID, media URL, тип представления, права и viewerPolicy.

POST /api/v1/twins/{twinId}/embed
Тип: генерация встройки
Описание: сформировать iframeUrl и iframeHtml для PlayCanvas, Geoscan Cloud или Gigapixel viewer.

GET  /api/v1/players
Тип: чтение
Описание: получить список разрешенных плееров из реестра портала.

GET  /api/v1/players/{playerId}/policy
Тип: чтение
Описание: получить allowlist-политику плеера: статус, allowedOrigins, capabilities, tokenRequired.
```

## HTTP API портала

### Доступ

```text
GET  /api/v1/access-control/model
Тип: чтение
Описание: получить модель ролей, прав доступа и политик команд плеера.
```

### Объекты

```text
GET  /api/v1/objects
Тип: чтение / каталог
Описание: получить список культурных объектов с фильтрами.

POST /api/v1/objects
Тип: создание
Описание: создать культурный объект в портале.

GET  /api/v1/objects/{objectId}
Тип: чтение
Описание: получить карточку культурного объекта по постоянному H3DRU_ID.

PATCH /api/v1/objects/{objectId}
Тип: изменение
Описание: обновить метаданные культурного объекта.
```

### Цифровые двойники

```text
GET  /api/v1/objects/{objectId}/twins
Тип: чтение
Описание: получить список цифровых двойников, связанных с культурным объектом.

POST /api/v1/objects/{objectId}/twins
Тип: создание
Описание: создать черновик цифрового двойника для культурного объекта.

GET  /api/v1/twins/{twinId}
Тип: чтение
Описание: получить данные конкретного цифрового двойника.

PATCH /api/v1/twins/{twinId}
Тип: изменение
Описание: обновить цифровой двойник, качество, доступ или связь с Геоскан Облаком.

GET  /api/v1/twins/{twinId}/manifest
Тип: чтение
Описание: получить manifest для плеера: objectId, twinId, assetId, media URL, права, viewerPolicy.
```

### Загрузка и модерация

```text
POST /api/v1/twins/{twinId}/assets/upload-url
Тип: создание временной ссылки
Описание: получить короткоживущий upload URL для загрузки файла в media-хранилище или Геоскан Облако.

POST /api/v1/twins/{twinId}/assets
Тип: регистрация файла
Описание: зарегистрировать загруженный файл как MediaAsset и связать его с цифровым двойником.

POST /api/v1/twins/{twinId}/submit
Тип: изменение статуса
Описание: отправить цифровой двойник на модерацию.

GET  /api/v1/twins/{twinId}/processing-status
Тип: чтение статуса
Описание: получить статус загрузки, обработки, валидации или публикации цифрового двойника.

GET  /api/v1/twins/{twinId}/preview
Тип: чтение превью
Описание: получить thumbnail/poster/screenshot для карточки каталога или страницы объекта.

POST /api/v1/twins/{twinId}/preview
Тип: генерация превью
Описание: создать или обновить screenshot/thumbnail цифрового двойника после загрузки модели.
```

### Медиафайлы

```text
GET  /api/v1/assets/{assetId}
Тип: чтение
Описание: получить данные медиафайла: формат, URL хранения, checksum, размер и правила доступа.

GET  /api/v1/assets/{assetId}/download
Тип: скачивание
Описание: получить временную ссылку для скачивания asset, если это разрешено политикой доступа.
```

### Плееры и встройка

```text
GET  /api/v1/players
Тип: чтение
Описание: получить список разрешенных плееров из реестра портала.

GET  /api/v1/players/{playerId}/capabilities
Тип: чтение
Описание: получить возможности плеера: форматы, команды, функции просмотра.

GET  /api/v1/players/{playerId}/policy
Тип: чтение
Описание: получить allowlist-политику плеера: allowedOrigins, trustLevel, статус и требования к токену.

GET  /api/v1/viewer-url
Тип: чтение / генерация URL
Описание: получить URL viewer для встройки цифрового двойника.

GET  /api/v1/embed-presets
Тип: чтение
Описание: получить пресеты встройки: full, compact, minimal и их UI-настройки.

POST /api/v1/twins/{twinId}/embed
Тип: генерация iframe
Описание: сформировать iframeUrl и iframeHtml для выбранного цифрового двойника и разрешенного playerId.
```

### Каталог и справочники

```text
GET  /api/v1/search
Тип: поиск
Описание: найти опубликованные объекты, цифровые двойники или assets.

GET  /api/v1/dictionaries/object-types
Тип: справочник
Описание: получить справочник типов культурных объектов.

GET  /api/v1/dictionaries/licenses
Тип: справочник
Описание: получить справочник лицензий и правовых режимов.
```

### Протокол сообщений плеера

```text
GET  /api/v1/player-messaging/protocol
Тип: чтение документации
Описание: получить описание postMessage-протокола: команды, события, capabilities и legacy-сообщения.
```

## postMessage команды плеера

Эти команды идут не в backend API, а в iframe-плеер через `window.postMessage`. Разрешенные команды определяются `viewerPolicy`.

```text
COMMAND player.loadManifest
Тип: команда портала к плееру
Описание: загрузить manifest в iframe-плеер.

COMMAND camera.reset
Тип: команда портала к плееру
Описание: сбросить камеру в исходное положение.

COMMAND camera.fit
Тип: команда портала к плееру
Описание: вписать объект в кадр.

COMMAND poi.focus
Тип: команда портала к плееру
Описание: перейти к конкретной точке интереса.

COMMAND poi.clear
Тип: команда портала к плееру
Описание: снять активную точку интереса.

COMMAND poi.next
Тип: команда портала к плееру
Описание: перейти к следующей точке интереса.

COMMAND poi.previous
Тип: команда портала к плееру
Описание: перейти к предыдущей точке интереса.

COMMAND animation.seek
Тип: команда портала к плееру
Описание: перейти к нужному времени или кадру анимации.

COMMAND animation.play
Тип: команда портала к плееру
Описание: запустить анимацию.

COMMAND animation.pause
Тип: команда портала к плееру
Описание: остановить анимацию.

COMMAND annotation.create
Тип: команда портала к плееру
Описание: создать аннотацию, если это разрешено viewerPolicy.

COMMAND asset.download
Тип: команда / действие
Описание: инициировать скачивание asset, если это разрешено политикой доступа.
```

## События от плеера

```text
EVENT player.ready
Тип: событие плеера
Описание: плеер готов принимать команды.

EVENT player.loaded
Тип: событие плеера
Описание: модель или manifest успешно загружены.

EVENT player.error
Тип: событие плеера
Описание: произошла ошибка загрузки или работы плеера.

EVENT poi.selected
Тип: событие плеера
Описание: пользователь выбрал точку интереса.

EVENT poi.cleared
Тип: событие плеера
Описание: активная точка интереса сброшена.

EVENT animation.time
Тип: событие плеера
Описание: изменилось время, кадр или прогресс анимации.
```

## Текущие legacy-команды viewer

```text
COMMAND focus-poi
Тип: legacy-команда
Описание: сфокусироваться на POI по id.

COMMAND open-poi
Тип: legacy-команда
Описание: открыть POI по id.

COMMAND clear-poi
Тип: legacy-команда
Описание: сбросить активный POI.

COMMAND next-poi
Тип: legacy-команда
Описание: перейти к следующему POI.

COMMAND prev-poi
Тип: legacy-команда
Описание: перейти к предыдущему POI.

COMMAND seek-animation
Тип: legacy-команда
Описание: перейти к времени или кадру анимации.

COMMAND play-animation
Тип: legacy-команда
Описание: запустить анимацию.

COMMAND pause-animation
Тип: legacy-команда
Описание: остановить анимацию.

COMMAND freeze-animation
Тип: legacy-команда
Описание: зафиксировать анимацию на времени или кадре.
```

## Текущие legacy-события

```text
EVENT poi-selected
Тип: legacy-событие
Описание: выбран POI.

EVENT poi-cleared
Тип: legacy-событие
Описание: активный POI сброшен.

EVENT animation-time
Тип: legacy-событие
Описание: изменилось время или кадр анимации.
```
