# ТЗ на доработку API Geoscan Cloud для интеграции с Heritage3D

Документ фиксирует опции, которые видны в интерфейсе Geoscan Cloud на примере проекта `peterburg_isaakievskij_sobor`, и переводит их в требования к API для интеграции с порталом Heritage3D.

Цель: портал Heritage3D должен управлять объектом через свой `H3DID`, а Geoscan Cloud должен выступать как техническая платформа хранения, обработки и просмотра модели.

## Статус документа

Эндпойнты в этом документе являются проектными требованиями к API Geoscan Cloud и рекомендуемой REST-структурой для обсуждения. Они описывают необходимые возможности интеграции, но не являются подтвержденной официальной спецификацией существующего API Geoscan Cloud.

Фактические URL, названия методов, схемы запросов/ответов, правила авторизации и доступность функций должны быть уточнены с командой Geoscan Cloud или приведены к их существующей API-спецификации.

Функциональные требования основаны на:

```text
1. Интерфейсе Geoscan Cloud, зафиксированном на скриншотах.
2. Публичной базе знаний Geoscan Cloud.
3. Предыдущем ТЗ storage-player API для Heritage3D.
4. Требованиях интеграции Heritage3D с внешним облачным viewer/storage.
```

## Авторизация и подпись доступа к API

Так как авторизация пользователей должна идти через Geoscan ID, доступ к API нужно строить через OAuth/OIDC. Пользователь логинится через Geoscan ID, после чего портал Heritage3D получает связанный профиль пользователя и access token. Все действия, которые пользователь выполняет сам — загрузка модели, редактирование сцены, создание POI, туров, изменение слоев, сохранение preview — должны выполняться от имени пользователя через:

```http
Authorization: Bearer <geoscan_user_access_token>
```

Geoscan Cloud должен проверять пользователя, его команду, роль, права на проект, папку, dataset или слой, а также вести audit log действий. Это нужно, чтобы было понятно, кто именно загрузил файл, изменил слой, создал тур, удалил объект или сохранил сцену.

Отдельно нужен сервисный доступ для backend Heritage3D. Он используется не для ручного редактирования, а для системных операций: связать `H3D_ID` и `TW_ID`, получить статус обработки, запросить preview, сформировать embed для публичной страницы, обновить статус ассета после webhook, синхронизировать технические данные. Для этого нужен service token или client credentials с ограниченными scopes.

Примеры scopes:

```text
geoscan:projects.read
geoscan:projects.write
geoscan:uploads.create
geoscan:uploads.process
geoscan:objects.read
geoscan:objects.write
geoscan:objects.delete
geoscan:drive.read
geoscan:drive.write
geoscan:embed.create
geoscan:viewer.editor
geoscan:billing.read
geoscan:team.read
```

Для встроенного редактора Geoscan Cloud нужна отдельная короткоживущая editor session. Портал запрашивает у Geoscan API `editorUrl` и `editorToken`, а затем открывает редактор в iframe. В этой сессии должны быть явно заданы разрешенные инструменты: слои, загрузка, POI, туры, измерения, preview, сохранение сцены. Сессия должна быть ограничена по времени и по allowed origins, чтобы редактор нельзя было использовать вне портала.

Для публичного просмотра модели нужен отдельный embed/viewer token. Он должен давать только права просмотра: открыть viewer, загрузить manifest, показать POI/туры, но не редактировать и не скачивать исходники, если скачивание запрещено. Geoscan Cloud отдает порталу `iframeUrl`, `manifestUrl`, `previewUrl` и короткоживущий `embedToken`, а портал сохраняет эти ссылки у себя и использует их на публичной странице модели.

Итого нужны четыре уровня доступа:

| Уровень доступа | Для чего используется | Кто использует |
|---|---|---|
| User access token | Действия пользователя: загрузка, редактирование, сохранение сцены, POI, туры, слои. | Браузер/портал от имени пользователя. |
| Service token | Системные действия backend Heritage3D: статусы, embed, preview, синхронизация, webhooks. | Backend Heritage3D. |
| Editor session token | Короткоживущая сессия встроенного редактора Geoscan Cloud. | iframe editor. |
| Embed/viewer token | Короткоживущий токен публичного или ограниченного просмотра. | iframe viewer. |

Также нужно предусмотреть подпись webhook-уведомлений от Geoscan Cloud в сторону Heritage3D и проверку `origin` для iframe/postMessage.

## 1. Идентификаторы

В Heritage3D модель Geoscan Cloud должна быть связана с общей цепочкой ID:

```text
H3DID / h3druObjectId -> twinId -> h3druAssetId -> geoscanProjectId / geoscanObjectId
```

| ID | Где живет | Назначение |
|---|---|---|
| `h3druObjectId / H3DID` | Heritage3D | Главный ID культурного объекта. |
| `twinId` | Heritage3D | Цифровое представление объекта, например Geoscan Cloud 3D. |
| `h3druAssetId` | Heritage3D | Запись ассета на стороне сайта. |
| `geoscanProjectId` | Geoscan Cloud | ID проекта Geoscan Cloud. |
| `geoscanObjectId` | Geoscan Cloud | ID конкретного объекта/слоя внутри проекта. |

## 2. Что видно в интерфейсе Geoscan Cloud

На примере проекта видны следующие блоки:

| Блок интерфейса | Что нужно в API |
|---|---|
| Рабочая область / дерево слоев | API проекта, групп, объектов, видимости и порядка. |
| Переключатели видимости объектов | API управления visibility. |
| Действия строки слоя | API удалить слой, подлететь к слою, скрыть/показать слой. |
| 3D-сцена | API manifest/embed/viewer settings. |
| Инструменты измерения | API измерений и единиц измерения. |
| Инструмент координаты/прицела | API получения координаты точки и системы координат. |
| Линия/отрезок | API для измерений/аннотаций. |
| Выделение областью | API selection/bounding region. |
| Режим сравнения | API compare mode: две сцены/слота, синхронизация камеры, выбор объектов. |
| Настройки viewer | API настроек отображения. |
| Тур/проигрывание | API camera tour/viewpoints. |
| Панель свойств объекта | API технических свойств объекта. |
| Download / delete у объекта | API скачивания и удаления с проверкой прав. |
| Меню создания в рабочей области | API создания слоя, группы, привязки набора данных и подключения картографического сервиса. |

## 3. Главный API управления файлами и наборами данных

Это основной контур интеграции. Heritage3D должен уметь управлять полным жизненным циклом данных в Geoscan Cloud: загрузить файл, настроить импорт, запустить обработку, получить опубликованный tileset/layer, изменить свойства, переместить в структуре диска, скачать или удалить.

Целевая цепочка:

```text
Drive item / folder
  -> upload
  -> upload configuration
  -> processing job
  -> dataset
  -> project layer / object
  -> published tileset / viewer object
```

Жизненный цикл:

| Шаг | Что происходит | Нужный API |
|---|---|---|
| 1 | Создать папку, объект или проект на диске. | `drive/folders`, `drive/objects`, `drive/projects` |
| 2 | Начать загрузку файла в проект или объект. | `POST uploads` |
| 3 | Проверить формат, размер, квоту, месячные лимиты и CRS. | validation + limits API |
| 4 | Создать временный upload item в рабочей области. | `upload.status`, `temporary`, `autoDeleteOnSessionEnd` |
| 5 | Если нужно, запросить настройки импорта: CRS, тип файла, локальные координаты. | `GET/PUT upload configuration` |
| 6 | Подтвердить настройки и запустить обработку. | `POST upload/process` |
| 7 | Получать статус загрузки, обработки и публикации. | `GET upload`, `GET processing-job`, webhook |
| 8 | После обработки получить dataset, layer/object и tileset. | `datasets`, `objects`, `technical-info` |
| 9 | Изменить название, дату съемки, папку, группу, порядок, видимость, внешний вид. | `PATCH drive item`, `PATCH object`, `PATCH appearance` |
| 10 | Скачать исходник, tileset/export или отчет. | `download-url`, `export` |
| 11 | Удалить upload, dataset, layer, project или drive item. | `DELETE` endpoints |

Минимальный набор endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/reference/supported-upload-formats` | Получить поддерживаемые типы файлов и правила CRS. |
| `GET` | `/geoscan/v1/organizations/{organizationId}/usage` | Получить тариф, хранилище, месячные лимиты и остатки. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/uploads` | Начать загрузку файла/архива. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}` | Получить статус upload item. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/configuration` | Получить обязательные настройки импорта. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/configuration` | Сохранить CRS, тип данных и другие параметры импорта. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/complete` | Подтвердить завершение передачи файла. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/process` | Запустить обработку и публикацию tileset. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}` | Отменить загрузку и удалить временный item. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/processing-jobs/{jobId}` | Получить статус обработки/публикации. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/datasets` | Получить наборы данных проекта. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/datasets/attach` | Прикрепить существующий dataset из диска. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}` | Получить опубликованный объект/слой viewer. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}` | Изменить название, группу, порядок, видимость. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/appearance` | Изменить opacity, display mode, bounding box. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/download` | Получить временную ссылку на скачивание. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}` | Удалить объект/слой из проекта. |
| `PATCH` | `/geoscan/v1/drive/items/{driveItemId}` | Переименовать, переместить или обновить metadata файла/проекта/объекта. |
| `DELETE` | `/geoscan/v1/drive/items/{driveItemId}` | Удалить элемент диска. |
| `POST` | `/geoscan/v1/webhooks/processing-status` | Webhook о готовности, ошибке обработки или публикации. |

Статусы upload:

| Статус | Когда используется |
|---|---|
| `created` | Upload item создан, файл еще не передан. |
| `uploading` | Идет передача файла. |
| `uploaded` | Файл передан, но еще не обработан. |
| `requires_upload_configuration` | Требуется настройка CRS, типа файла или других параметров. |
| `validation_failed` | Файл не прошел валидацию, обработка не начинается. |
| `processing` | Идет обработка. |
| `publishing` | Генерируется web-optimized tileset. |
| `ready` | Dataset/layer опубликован и готов к viewer/embed. |
| `failed` | Ошибка загрузки, обработки или публикации. |
| `cancelled` | Загрузка отменена пользователем или системой. |

Пример upload item:

```json
{
  "uploadId": "upload-01J...",
  "geoscanProjectId": "project-01J...",
  "title": "scull",
  "fileName": "scull.obj",
  "extension": ".obj",
  "status": "requires_upload_configuration",
  "temporary": true,
  "autoDeleteOnSessionEnd": true,
  "publishAfterUpload": true,
  "sizeBytes": 164469146,
  "progress": {
    "phase": "waiting_for_configuration",
    "percent": 100
  },
  "requiredConfiguration": [
    {
      "field": "coordinateSystem",
      "required": true,
      "defaultValue": "LOCAL:METERS"
    }
  ]
}
```

Пример результата после обработки:

```json
{
  "uploadId": "upload-01J...",
  "status": "ready",
  "dataset": {
    "datasetId": "dataset-01J...",
    "dataType": "mesh_model",
    "sourceFileSizeBytes": 164469146,
    "coordinateSystem": "LOCAL:METERS"
  },
  "object": {
    "geoscanObjectId": "scull",
    "layerId": "layer-01J...",
    "visible": true
  },
  "tileset": {
    "tilesetId": "tileset-01J...",
    "tilesetSizeBytes": 39426458,
    "viewerReady": true
  }
}
```

Ошибки должны быть структурированными и пригодными для показа пользователю:

```json
{
  "code": "unsupported_file_format",
  "userMessage": "Формат .xyz не поддерживается для загрузки в Geoscan Cloud.",
  "fileName": "model.xyz",
  "supportedFormatsUrl": "/geoscan/v1/reference/supported-upload-formats"
}
```

Критично: операции удаления должны различать уровни:

| Что удаляется | Последствие |
|---|---|
| `upload` | Удаляется временный upload item до публикации. |
| `project object / layer` | Слой исчезает из рабочей области проекта; исходный dataset может сохраниться на диске, если он прикреплен отдельно. |
| `dataset` | Удаляется набор данных и связанные tileset/preview, если нет других ссылок. |
| `drive item` | Удаляется папка, объект или проект на уровне диска с учетом вложенных элементов и прав. |

## 4. API проекта и рабочей области

Нужно уметь получать структуру проекта, чтобы портал мог связать Geoscan Cloud проект с `H3DID` и выбрать нужный объект для embed.

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}` | Получить карточку проекта. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/workspace` | Получить дерево рабочей области: группы, слои, объекты. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects` | Получить список объектов проекта. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}` | Получить объект/слой проекта. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}` | Обновить название, видимость, порядок, группу. |

Минимальная структура объекта:

```json
{
  "geoscanProjectId": "d8fa8fda-efa8-403b-9710-d2eaf72fc29b",
  "geoscanObjectId": "Isaac_model_HiRes",
  "name": "Isaac_model_HiRes",
  "type": "model",
  "visible": true,
  "group": "Тур 1",
  "sortOrder": 10
}
```

В строке слоя рабочей области при выборе `Isaac_model_HiRes` видны быстрые действия:

| Иконка/действие UI | Назначение | API/JS API |
|---|---|---|
| Корзина | Удалить слой/объект из проекта. | `DELETE object` |
| Рамка/фокус | Подлететь к слою, вписать объект в экран. | `viewer.object.flyTo` |
| Глаз | Скрыть или показать слой. | `PATCH visible`, `viewer.object.setVisibility` |

Для подлета к объекту API должен отдавать bounding volume/extent объекта, а viewer должен уметь построить камеру по этому extent.

Дополнительные команды JS API/postMessage:

| Команда | Назначение |
|---|---|
| `viewer.object.flyTo` | Подлететь к объекту/слою по `geoscanObjectId`. |
| `viewer.object.setVisibility` | Скрыть или показать объект/слой. |
| `viewer.object.deleteRequested` | Запросить удаление слоя через внешний интерфейс портала, если удаление должно подтверждаться на стороне Heritage3D. |

Пример команды подлета:

```json
{
  "command": "viewer.object.flyTo",
  "payload": {
    "geoscanProjectId": "d8fa8fda-efa8-403b-9710-d2eaf72fc29b",
    "geoscanObjectId": "Isaac_model_HiRes",
    "durationSeconds": 1.2
  }
}
```

## 5. Настройки viewer

В панели настроек видны параметры:

| Параметр UI | Значение на экране | Нужный API-параметр |
|---|---|---|
| Вид | `Модель` | `viewMode` |
| Качество 3D | `Среднее` | `quality3d` |
| Базовая карта | `Sentinel`, сейчас disabled | `baseMap` |
| Трекбол | `Скрыть` | `trackball` |
| Система координат | `(EPSG::4326) WGS 84` | `coordinateSystem` |
| Система мер | `Метры` | `measurementSystem` |
| Сохранить ракурс | кнопка | `defaultCamera`, `preview` |

Для `quality3d` в UI доступны значения:

| UI значение | API значение |
|---|---|
| `Низкое` | `low` |
| `Среднее` | `medium` |
| `Высокое` | `high` |
| `Высшее` | `ultra` |

Для `viewMode` в UI доступны значения:

| UI значение | API значение | Комментарий |
|---|---|---|
| `Земля` | `earth` | Режим карты/земной поверхности. |
| `Модель` | `model` | Режим просмотра 3D-модели. |

Для `trackball` в UI доступны значения:

| UI значение | API значение |
|---|---|
| `Показать` | `visible` |
| `Скрыть` | `hidden` |

`trackball` управляет отображением навигационного контролла/ориентира в viewer и должен поддерживаться в embed-настройках, чтобы портал мог открыть viewer сразу с показанным или скрытым трекболом.

Набор доступных настроек зависит от `viewMode`: например, в режиме `Модель` видны `Качество 3D`, `Трекбол`, `Система координат`, `Система мер` и кнопка `Сохранить ракурс`; параметры базовой карты могут быть недоступны.

Если параметр недоступен в текущем режиме, API должен возвращать состояние доступности, чтобы портал мог корректно заблокировать контрол. На скриншоте `Базовая карта: Sentinel` отображается как disabled.

Для `baseMap` на скриншоте режима `Земля` доступно значение:

| UI значение | API значение | Комментарий |
|---|---|---|
| `Sentinel` | `sentinel` | Базовая спутниковая карта для режима `earth`. |

API должен возвращать `baseMap.disabled = false` в режиме `earth` и `baseMap.disabled = true` в режиме `model`, если карта не применяется к просмотру модели.

Для `coordinateSystem` в UI используется выпадающий список с поиском и большим справочником систем координат. На скриншоте видны варианты:

| UI значение | API значение |
|---|---|
| `(EPSG::4324) WGS 72BE` | `EPSG:4324` |
| `(EPSG::63246405) WGS 72BE (deg)` | `EPSG:63246405` |
| `(EPSG::4326) WGS 84` | `EPSG:4326` |
| `(EPSG::63266408) WGS 84 (DM)` | `EPSG:63266408` |
| `(EPSG::63266409) WGS 84 (DMH)` | `EPSG:63266409` |

Нужен отдельный API справочника CRS, чтобы портал не хранил огромную простыню координат локально и мог искать по EPSG-коду или названию.

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/reference/coordinate-systems?query={query}&limit=50` | Поиск систем координат по EPSG-коду или названию. |
| `GET` | `/geoscan/v1/reference/coordinate-systems/{coordinateSystemId}` | Получить одну систему координат. |

Пример ответа поиска:

```json
{
  "items": [
    {
      "id": "EPSG:4326",
      "authority": "EPSG",
      "code": "4326",
      "name": "WGS 84",
      "label": "(EPSG::4326) WGS 84",
      "unit": "degree"
    }
  ],
  "total": 1
}
```

Для `measurementSystem` в UI доступны значения:

| UI значение | API значение | Комментарий |
|---|---|---|
| `Метры` | `meters` | Метрическая система измерений. |
| `Футы` | `feet` | Международные футы. |
| `Футы (США)` | `us_survey_feet` | US survey feet, если требуется совместимость с геодезическими данными США. |

`measurementSystem` должен применяться к инструментам измерений, отображению координат/дистанций, значениям высоты и embed-настройкам viewer.

```json
{
  "viewMode": {
    "value": "model",
    "availableValues": ["model"],
    "disabled": false
  },
  "quality3d": {
    "value": "medium",
    "availableValues": ["low", "medium", "high", "ultra"],
    "disabled": false
  },
  "baseMap": {
    "value": "sentinel",
    "availableValues": ["sentinel"],
    "disabled": true,
    "disabledReason": "base_map_not_available_for_current_view"
  }
}
```

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/viewer-settings` | Получить настройки viewer по умолчанию для проекта. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/viewer-settings` | Сохранить настройки viewer проекта. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/viewer-settings` | Получить настройки viewer для конкретного объекта. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/viewer-settings` | Сохранить настройки viewer объекта. |

Пример:

```json
{
  "viewMode": "model",
  "quality3d": "medium",
  "baseMap": "sentinel",
  "trackball": "hidden",
  "coordinateSystem": "EPSG:4326",
  "coordinateSystemLabel": "WGS 84",
  "measurementSystem": "meters"
}
```

## 6. Ракурсы и камеры

Кнопка `Сохранить ракурс` в UI используется для сохранения первоначального положения камеры и создания preview/poster текущего вида. Это не только пользовательский сохраненный viewpoint, а настройки стартового вида модели для карточки, embed и первого открытия viewer.

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/viewpoints` | Получить сохраненные ракурсы проекта. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/viewpoints` | Создать ракурс. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/viewpoints/{viewpointId}` | Получить один ракурс. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/viewpoints/{viewpointId}` | Обновить название/параметры ракурса. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/viewpoints/{viewpointId}` | Удалить ракурс. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/default-view` | Получить стартовую камеру и preview проекта. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/default-view` | Сохранить текущую камеру как стартовый вид и создать/обновить preview. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/default-view` | Получить стартовую камеру и preview объекта. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/default-view` | Сохранить текущую камеру как стартовый вид объекта и создать/обновить preview. |

Пример:

```json
{
  "viewpointId": "front-dome",
  "title": "Главный купол",
  "cameraPosition": [30.12, 59.93, 120.0],
  "cameraTarget": [30.12, 59.93, 40.0],
  "cameraUp": [0, 0, 1],
  "zoom": 1.0
}
```

Пример сохранения стартового вида:

```json
{
  "cameraPosition": [30.12, 59.93, 120.0],
  "cameraTarget": [30.12, 59.93, 40.0],
  "cameraUp": [0, 0, 1],
  "zoom": 1.0,
  "createPreview": true,
  "preview": {
    "format": "jpg",
    "width": 1280,
    "height": 720
  }
}
```

Пример ответа:

```json
{
  "defaultCamera": {
    "cameraPosition": [30.12, 59.93, 120.0],
    "cameraTarget": [30.12, 59.93, 40.0],
    "cameraUp": [0, 0, 1],
    "zoom": 1.0
  },
  "preview": {
    "previewUrl": "https://cloud.geoscan.ru/api/projects/.../preview.jpg",
    "width": 1280,
    "height": 720,
    "createdAt": "2026-05-25T12:00:00Z"
  }
}
```

### 6.1. Туры и группы рабочей области

На скриншоте рабочей области виден режим `Презентация`: в дереве есть `Группа 1`, внутри нее `Тур 1`, а внутри тура отображается элемент `test`. Отдельным объектом/слоем в рабочей области отображается модель `Isaac_model_HiRes`. У группы, тура и модели есть управление видимостью/раскрытием, а кнопка `+` открывает меню создания:

| Действие UI | Что нужно в API |
|---|---|
| `Создать тур` | Создать tour внутри проекта или выбранной группы. |
| `Создать группу` | Создать группу/папку в рабочей области проекта. |
| Раскрыть/свернуть группу или тур | Получать и сохранять структуру дерева workspace. |
| Переключить видимость модели | Управлять `visible` у объекта/слоя. |
| Переключить видимость группы/тура | Массово применять видимость к вложенным элементам или хранить состояние контейнера. |
| Элемент `test` внутри тура | Хранить шаги тура: название, ракурс, целевой объект, порядок, длительность. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/workspace` | Получить дерево рабочей области: группы, туры, объекты, элементы туров. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/workspace/groups` | Создать группу в рабочей области. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/workspace/groups/{groupId}` | Переименовать группу, изменить порядок, родителя или видимость. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/workspace/groups/{groupId}` | Удалить группу с проверкой вложенных элементов. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/tours` | Создать тур в проекте или выбранной группе. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/tours` | Получить список туров проекта. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}` | Получить тур со списком шагов. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}` | Обновить название, группу, порядок, видимость и настройки тура. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}` | Удалить тур. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items` | Добавить шаг/точку в тур. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}` | Обновить шаг тура: название, порядок, ракурс, длительность. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}` | Удалить шаг тура. |

Важно по модели данных:

```text
Project
  Tour 1
    POI / tourItem: test
  Tour 2
    POI / tourItem: ...
  Model layer: Isaac_model_HiRes
```

Один проект может содержать много туров. Точка POI создается внутри конкретного тура и отображается вложенным элементом в дереве рабочей области слева. Меню создания точки вызывается кнопкой под шестеренкой в правой части viewer. API создания точки должен всегда принимать `tourId`, чтобы не было точки без привязки к туру.

Пример структуры workspace:

```json
{
  "geoscanProjectId": "d8fa8fda-efa8-403b-9710-d2eaf72fc29b",
  "mode": "presentation",
  "items": [
    {
      "id": "group-1",
      "type": "group",
      "title": "Группа 1",
      "visible": true,
      "expanded": true,
      "sortOrder": 10,
      "children": [
        {
          "id": "tour-1",
          "type": "tour",
          "title": "Тур 1",
          "visible": true,
          "expanded": true,
          "sortOrder": 10,
          "children": [
            {
              "id": "tour-item-test",
              "type": "tourItem",
              "title": "test",
              "viewpointId": "viewpoint-test",
              "sortOrder": 10
            }
          ]
        }
      ]
    },
    {
      "id": "Isaac_model_HiRes",
      "type": "model",
      "title": "Isaac_model_HiRes",
      "visible": true,
      "sortOrder": 20
    }
  ]
}
```

Пример создания тура:

```json
{
  "title": "Тур 1",
  "groupId": "group-1",
  "visible": true,
  "sortOrder": 10,
  "settings": {
    "autoplay": false,
    "loop": false,
    "defaultStepDurationSeconds": 5
  }
}
```

### 6.2. Точки POI внутри тура

На скриншоте выбран элемент `test` внутри `Тур 1`. В центре viewer отображается маркер точки с номером `1` и карточка с названием/описанием. В правой панели открываются свойства выбранной точки.

| Блок UI | Что означает | Нужный API-параметр |
|---|---|---|
| Дерево слева: `Тур 1 -> test` | Точка является дочерним элементом тура. | `tourId`, `tourItemId`, `sortOrder` |
| Верх правой панели: `test` | Название точки. | `title` |
| Иконка камеры в правой панели | Сделать скриншот текущего положения камеры для точки. | `preview`, `cameraSnapshot` |
| Иконка удаления в правой панели | Удалить точку из тура. | `DELETE tourItem` |
| Preview справа | Скриншот камеры, который показывается при переходе к точке. | `previewUrl` |
| Характеристики: `Длительность 5 секунд` | Время показа точки в туре. | `durationSeconds` |
| Характеристики: `Описание test` | Описание точки. | `description` |
| Маркер в сцене | Позиция POI на модели. | `position`, `normal`, `number` |

Нужные endpoints для POI/точек тура:

| Method | Endpoint | Назначение |
|---|---|---|
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items` | Создать точку POI внутри тура. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}` | Получить свойства точки. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}` | Обновить название, описание, длительность, позицию, камеру или порядок точки. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}/preview` | Сделать скриншот текущего положения камеры и сохранить preview точки. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}` | Удалить точку из тура. |

Пример точки тура:

```json
{
  "tourItemId": "tour-item-test",
  "tourId": "tour-1",
  "type": "poi",
  "number": 1,
  "title": "test",
  "description": "test",
  "durationSeconds": 5,
  "sortOrder": 10,
  "position": [30.12, 59.93, 45.0],
  "normal": [0, 0, 1],
  "camera": {
    "position": [30.1205, 59.9302, 120.0],
    "target": [30.12, 59.93, 45.0],
    "up": [0, 0, 1],
    "zoom": 1.0
  },
  "preview": {
    "previewUrl": "https://cloud.geoscan.ru/api/projects/.../tours/tour-1/items/tour-item-test/preview.jpg",
    "width": 1280,
    "height": 720,
    "createdAt": "2026-05-25T12:00:00Z"
  }
}
```

### 6.3. Плеер туров в viewer

В обычном viewer, не только в админке, отображается компактный плеер тура: выбор тура, текущий шаг, прогресс и кнопки назад/воспроизведение/вперед. На скриншоте выбран `Тур 1`, отображается `1 / 1 Обзорная точка`.

Для портала Heritage3D нужно уметь управлять этим плеером через настройки embed и стартовые настройки проекта/объекта:

| UI элемент | Что нужно в API |
|---|---|
| Выпадающий список `Тур 1` | Список доступных туров и выбор тура по умолчанию. |
| `1 / 1 Обзорная точка` | Текущий шаг, общее количество шагов, название точки. |
| Прогресс-бар | Текущий прогресс воспроизведения тура/точки. |
| Кнопка назад | Перейти к предыдущей точке тура. |
| Кнопка play/pause | Запустить или остановить воспроизведение тура. |
| Кнопка вперед | Перейти к следующей точке тура. |

Нужные настройки:

| Параметр | Тип | Назначение |
|---|---|---|
| `tourPlayer.enabled` | boolean | Показывать или скрывать плеер туров в viewer/embed. |
| `tourPlayer.defaultTourId` | string/null | Тур, выбранный по умолчанию при открытии viewer. |
| `tourPlayer.autoplayOnLoad` | boolean | Запускать воспроизведение тура сразу после загрузки модели. |
| `tourPlayer.loop` | boolean | Повторять тур после последней точки. |
| `tourPlayer.showProgress` | boolean | Показывать прогресс-бар. |
| `tourPlayer.showStepTitle` | boolean | Показывать название текущей точки. |

Эти параметры должны поддерживаться в `viewer-settings` и в запросе на создание embed.

Пример:

```json
{
  "tourPlayer": {
    "enabled": true,
    "defaultTourId": "tour-1",
    "autoplayOnLoad": false,
    "loop": false,
    "showProgress": true,
    "showStepTitle": true
  }
}
```

Команды JS API/postMessage для внешнего управления плеером:

| Команда | Назначение |
|---|---|
| `viewer.tour.play` | Запустить текущий тур. |
| `viewer.tour.pause` | Поставить тур на паузу. |
| `viewer.tour.stop` | Остановить тур и сбросить прогресс. |
| `viewer.tour.next` | Перейти к следующей точке. |
| `viewer.tour.prev` | Перейти к предыдущей точке. |
| `viewer.tour.open` | Открыть конкретный тур по `tourId`. |
| `viewer.tour.openItem` | Открыть конкретную точку тура по `tourId` и `tourItemId`. |

События от viewer:

| Событие | Назначение |
|---|---|
| `viewer.tourSelected` | Пользователь выбрал тур. |
| `viewer.tourStarted` | Тур запущен. |
| `viewer.tourPaused` | Тур поставлен на паузу. |
| `viewer.tourCompleted` | Тур завершен. |
| `viewer.tourItemChanged` | Активная точка тура изменилась. |

Уточнения из документации:

| Поведение | Требование к API |
|---|---|
| Слой тура — именованная коллекция точек обзора, воспроизводимых последовательно. | `tour.items` должен сохранять порядок и поддерживать reorder через `sortOrder`. |
| Новая точка обзора создается с именем по умолчанию, длительностью `5 секунд`, текущей камерой и пустым описанием. | `POST tour items` может принимать минимум позицию точки, остальные значения заполняются сервером/viewer. |
| Позицию точки можно менять перетаскиванием в 3D-сцене. | `PATCH tourItem.position` и событие `viewer.tourItemMoved`. |
| Встраивание тура может скрывать все панели и инструменты, оставляя только player. | Embed должен поддерживать preset/flags для `tour_player_only`. |

Пример embed для режима только с проигрывателем тура:

```json
{
  "preset": "tour_player_only",
  "ui": {
    "showToolbar": false,
    "showLayerTree": false,
    "showProperties": false,
    "showMeasurements": false,
    "showTour": true
  },
  "tourPlayer": {
    "enabled": true,
    "defaultTourId": "tour-1",
    "autoplayOnLoad": false
  }
}
```

Панель свойств тура показывает отдельные настройки и характеристики тура:

| Блок UI | Поле/действие | Нужный API-параметр |
|---|---|---|
| Заголовок | `Тур 1` | `title` |
| Действия в заголовке | download/export | endpoint экспорта тура |
| Действия в заголовке | delete | endpoint удаления тура |
| Внешний вид | `Заливка #42E0DB` | `appearance.fillColor` |
| Характеристики | `СК EPSG:4326 (WGS 84)` | `coordinateSystem` |
| Характеристики | `Размер 565 байт` | `sizeBytes` |
| Иконка копирования у блоков | копирование значения/JSON | API должен отдавать значения в машинном виде |

Дополнительные endpoints для свойств тура:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/properties` | Получить свойства тура для панели. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/appearance` | Обновить внешний вид тура, например цвет заливки. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/download` | Получить временную ссылку на экспорт/скачивание тура. |

Пример свойств тура:

```json
{
  "tourId": "tour-1",
  "title": "Тур 1",
  "appearance": {
    "fillColor": "#42E0DB"
  },
  "technicalInfo": {
    "coordinateSystem": "EPSG:4326",
    "coordinateSystemLabel": "WGS 84",
    "sizeBytes": 565
  },
  "actions": {
    "canDownload": true,
    "canDelete": true,
    "canEditAppearance": true
  }
}
```

## 7. Свойства объекта / слоя

После выбора `Isaac_model_HiRes` видна панель свойств:

| Блок UI | Поля |
|---|---|
| Преобразования | перемещение, вращение/ориентация, масштаб/габариты или область трансформации. |
| Внешний вид | непрозрачность, ограничивающий кубоид, режим отображения: например `Цвета` или `Высоты`. |
| Диапазон высот | минимум, максимум, slider; фактически работает как обрезка/фильтр модели по высоте. |
| Характеристики | СК исходного файла, размер исходного файла, СК набора тайлов, размер набора тайлов. |
| Действия | download, delete. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/properties` | Получить свойства объекта. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/appearance` | Обновить внешний вид объекта. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/transform` | Обновить преобразования объекта: позиция, поворот, масштаб. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/height-range` | Обновить диапазон высот. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/technical-info` | Получить технические характеристики. |

Пример свойств:

```json
{
  "transform": {
    "position": [0, 0, 0],
    "rotation": [0, 0, 0],
    "scale": [1, 1, 1],
    "units": "m"
  },
  "appearance": {
    "opacity": 1.0,
    "boundingBoxEnabled": false,
    "displayMode": "heightmap"
  },
  "heightRange": {
    "min": -83.583,
    "max": 24.517,
    "sourceMin": -83.583,
    "sourceMax": 145.862,
    "clippingEnabled": true,
    "unit": "m"
  },
  "technicalInfo": {
    "sourceCoordinateSystem": "LOCAL:METERS",
    "sourceCoordinateSystemLabel": "Local Coordinates (m)",
    "sourceFileSizeBytes": 164469146,
    "sourceFileSizeHuman": "156.85 МБ",
    "tilesetCoordinateSystem": "LOCAL:METERS",
    "tilesetCoordinateSystemLabel": "Local Coordinates (m)",
    "tilesetSizeBytes": 39426458,
    "tilesetSizeHuman": "37.59 МБ"
  }
}
```

На панели объекта также видны быстрые иконки преобразований:

| Иконка/действие UI | Назначение | API-параметр |
|---|---|---|
| Перемещение | Сдвинуть объект в сцене. | `transform.position` |
| Вращение/ориентация | Повернуть объект. | `transform.rotation` |
| Габариты/область | Изменить масштаб или рамку трансформации. | `transform.scale`, `boundingBox` |

Ограничивающий кубоид в блоке `Внешний вид` включается отдельным переключателем и должен поддерживать reset к исходному состоянию.

```json
{
  "appearance": {
    "opacity": 1.0,
    "boundingBoxEnabled": true
  }
}
```

Отдельно нужно зафиксировать две функции viewer:

| Функция | Что делает | Нужный API-параметр |
|---|---|---|
| Обрезка модели по высоте | Показывает только часть модели в заданном диапазоне высот. | `heightRange.clippingEnabled`, `heightRange.min`, `heightRange.max`. |
| Карта высот | Переключает режим отображения с исходных цветов/текстур на цветовую шкалу высот. | `appearance.displayMode = heightmap`. |

Эти параметры должны поддерживаться и в настройках объекта, и в embed, чтобы портал мог открывать модель сразу в нужном режиме:

```json
{
  "appearance": {
    "displayMode": "heightmap",
    "opacity": 1.0,
    "boundingBoxEnabled": false
  },
  "heightRange": {
    "clippingEnabled": true,
    "min": -83.583,
    "max": 24.517,
    "unit": "m"
  }
}
```

## 8. Загрузка / импорт

В верхней панели проекта есть иконка загрузки. Для Heritage3D важно, чтобы загрузка могла запускаться с сайта, а Geoscan Cloud возвращал проект/объект/статус.

В обычной рабочей области кнопка `+` открывает меню:

| Действие UI | Что нужно в API |
|---|---|
| `Создать слой` | Создать новый слой в проекте. |
| `Создать группу` | Создать группу/папку в рабочей области. |
| `Прикрепить набор данных` | Связать существующий dataset с проектом/слоем. |
| `Добавить картографический веб-сервис` | Подключить внешний WMS/WMTS/TMS/XYZ-сервис как слой карты. |

Отдельно рядом с `+` в верхней части дерева рабочей области видна кнопка с иконкой облака. По нажатию этой кнопки открывается окно `Загрузить данные`. Она должна запускать загрузку нового набора данных или файла в проект.

Окно `Загрузить данные` перед выбором файла показывает требования к форматам. API должен отдавать эти требования машинно, чтобы портал мог валидировать файл до загрузки и показывать пользователю одинаковый список поддерживаемых форматов.

| Тип данных | Поддерживаемые форматы |
|---|---|
| Облако точек | Cesium3DTiles `(.zip, .3tz)`, `.obj`, `.ply`, `.las`, `.laz`, `.e57`, `.pts`, `.ptx`, `.pcd` |
| Тайловая модель | Cesium3DTiles `(.zip, .3tz)` |
| Растровая карта | `.tif`, `.tiff`, `.geotiff` |
| ЦММ | `.tif`, `.tiff`, `.geotiff` |
| Модель | `.obj`, `.3ds`, `.ctm`, `.dae`, `.ply`, `.glb`, `.stl`, `.abc`, `.fbx`, `.dxf`, `.u3d`, `.osgb`, `.osgt` |
| Векторный слой | Shapefile `(.zip)`, `.dxf`, `.dgn`, `.geojson`, `.gml`, `.gpkg` |

Система координат для загрузки: `WGS84 (EPSG::4326)`, трансформируемые или локальные системы координат.

| Method | Endpoint | Назначение |
|---|---|---|
| `POST` | `/geoscan/v1/projects` | Создать проект Geoscan Cloud под объект Heritage3D. |
| `GET` | `/geoscan/v1/reference/supported-upload-formats` | Получить поддерживаемые типы данных, расширения и требования к CRS. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/uploads` | Начать загрузку файла/архива. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/complete` | Завершить загрузку. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}` | Получить статус загрузки. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/processing-jobs/{jobId}` | Получить статус обработки. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/layers` | Создать слой в рабочей области. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/layers/{layerId}/attach-dataset` | Прикрепить существующий набор данных к слою. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/datasets` | Получить доступные наборы данных для прикрепления. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/map-services` | Добавить картографический веб-сервис. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/map-services` | Получить подключенные картографические веб-сервисы. |

Пример справочника форматов:

```json
{
  "coordinateSystemRequirement": {
    "default": "EPSG:4326",
    "label": "WGS84 (EPSG::4326)",
    "allowedTypes": ["wgs84", "transformable", "local"]
  },
  "types": [
    {
      "dataType": "point_cloud",
      "title": "Облако точек",
      "extensions": [".zip", ".3tz", ".obj", ".ply", ".las", ".laz", ".e57", ".pts", ".ptx", ".pcd"],
      "formats": ["Cesium3DTiles", "OBJ", "PLY", "LAS", "LAZ", "E57", "PTS", "PTX", "PCD"]
    },
    {
      "dataType": "mesh_model",
      "title": "Модель",
      "extensions": [".obj", ".3ds", ".ctm", ".dae", ".ply", ".glb", ".stl", ".abc", ".fbx", ".dxf", ".u3d", ".osgb", ".osgt"]
    },
    {
      "dataType": "vector_layer",
      "title": "Векторный слой",
      "extensions": [".zip", ".dxf", ".dgn", ".geojson", ".gml", ".gpkg"]
    }
  ]
}
```

При `POST /uploads` Geoscan Cloud должен проверять расширение, тип данных, размер файла, квоту и допустимость системы координат до выдачи upload URL.

После выбора/загрузки модели справа обязательно появляется панель настройки загрузки. На скриншоте выбран файл/слой `scull`, сверху доступно удаление, внутри блока показано состояние `Требуется настройка загрузки...`, прогресс и обязательное поле `Система координат`. Для локальных моделей доступно значение `Local Coordinates (m)`. Подтверждение настроек выполняется кнопкой с галочкой.

Это означает, что upload lifecycle должен иметь отдельный промежуточный статус: файл выбран/загружен, но обработку нельзя начинать, пока пользователь не подтвердил параметры импорта.

По документации Geoscan Cloud:

| Ситуация | Требование к API |
|---|---|
| Файл невалиден | Загрузка не начинается, ошибка валидации отображается в правой панели. |
| Невалидный файл не удалили вручную | Временный item автоматически удаляется при выходе из проекта/сессии. |
| CRS не распознан | Загрузка приостанавливается до настройки системы координат. |
| CRS не настроили | Временный item автоматически удаляется при выходе из проекта/сессии. |
| CRS локальный | Данные размещаются по умолчанию в `longitude = 0`, `latitude = 0`, `height = 0`. |
| Файл валиден и CRS распознан/настроен | После загрузки файл автоматически публикуется: создается web-optimized tileset. |

Для этого в upload item нужны поля `temporary`, `autoDeleteOnSessionEnd`, `validationErrors`, `publishAfterUpload`.

| UI элемент | Что нужно в API |
|---|---|
| Название `scull` | Временный upload item / будущий слой. |
| Корзина | Отменить загрузку и удалить временный item. |
| `Требуется настройка загрузки...` | Статус `requires_upload_configuration`. |
| Progress bar | Прогресс загрузки или подготовки. |
| `Система координат` | Обязательный параметр import configuration. |
| `Local Coordinates (m)` | Значение CRS для локальной метрической системы. |
| Галочка | Подтвердить настройки и запустить обработку. |

Дополнительные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/configuration` | Получить требуемые параметры настройки загрузки. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/configuration` | Сохранить параметры импорта: CRS, тип данных, единицы и прочее. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}/process` | Подтвердить настройки и запустить обработку. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/uploads/{uploadId}` | Отменить загрузку и удалить временный item. |

Пример статуса upload item:

```json
{
  "uploadId": "upload-01J...",
  "title": "scull",
  "status": "requires_upload_configuration",
  "temporary": true,
  "autoDeleteOnSessionEnd": true,
  "publishAfterUpload": true,
  "progress": {
    "phase": "waiting_for_configuration",
    "percent": 100
  },
  "requiredConfiguration": [
    {
      "field": "coordinateSystem",
      "required": true,
      "defaultValue": "LOCAL:METERS",
      "availableValues": [
        {
          "id": "LOCAL:METERS",
          "label": "Local Coordinates (m)",
          "unit": "m"
        },
        {
          "id": "EPSG:4326",
          "label": "(EPSG::4326) WGS 84",
          "unit": "degree"
        }
      ]
    }
  ]
}
```

Пример подтверждения настроек:

```json
{
  "dataType": "mesh_model",
  "coordinateSystem": "LOCAL:METERS",
  "localOrigin": {
    "longitude": 0,
    "latitude": 0,
    "height": 0
  },
  "measurementSystem": "meters",
  "title": "scull"
}
```

Для некоторых расширений тип данных нельзя определить однозначно. Например, при загрузке `.ply` справа появляется дополнительное обязательное поле `Тип файла` с поиском и вариантами:

| UI значение | API значение |
|---|---|
| `Модель` | `mesh_model` |
| `Облако точек` | `point_cloud` |

API должен возвращать такие случаи в `requiredConfiguration`, чтобы фронтенд показывал выбор типа файла до запуска обработки.

Пример для `sphere.compressed.ply`:

```json
{
  "uploadId": "upload-01JPLY",
  "title": "sphere.compressed",
  "extension": ".ply",
  "status": "requires_upload_configuration",
  "requiredConfiguration": [
    {
      "field": "coordinateSystem",
      "required": true,
      "defaultValue": "LOCAL:METERS",
      "availableValues": [
        {
          "id": "LOCAL:METERS",
          "label": "Local Coordinates (m)",
          "unit": "m"
        }
      ]
    },
    {
      "field": "dataType",
      "required": true,
      "defaultValue": null,
      "availableValues": [
        {
          "id": "mesh_model",
          "label": "Модель"
        },
        {
          "id": "point_cloud",
          "label": "Облако точек"
        }
      ]
    }
  ]
}
```

Пример создания слоя:

```json
{
  "title": "Новый слой",
  "type": "model",
  "groupId": null,
  "visible": true,
  "sortOrder": 30
}
```

Пример прикрепления набора данных:

```json
{
  "datasetId": "dataset-01J...",
  "layerType": "model",
  "title": "Isaac_model_HiRes",
  "visible": true
}
```

Окно `Прикрепить` показывает файловый/датасетный диск пользователя. Пользователь выбирает данные, которые нужно прикрепить к текущему проекту. На скриншоте:

```text
Проект: peterburg_isaakievskij_sobor
Диск:
  Heritage 3D
  DEMO_Geoscan
  Palmira_2019
Выбрано: 0 элементов
Кнопка "Прикрепить" disabled
```

Для этого сценария нужен API навигации по диску и выбора элементов:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/drive/items?parentId={parentId}` | Получить папки и наборы данных в диске пользователя. |
| `GET` | `/geoscan/v1/drive/items/{driveItemId}` | Получить карточку папки или набора данных. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/datasets/attach` | Прикрепить выбранные элементы диска к проекту. |

Пример элемента диска:

```json
{
  "driveItemId": "drive-folder-heritage-3d",
  "type": "folder",
  "title": "Heritage 3D",
  "parentId": null,
  "canAttach": false,
  "childrenAvailable": true
}
```

Пример прикрепления выбранных элементов:

```json
{
  "items": [
    {
      "driveItemId": "dataset-palmira-2019-model",
      "attachAs": "layer",
      "layerType": "model",
      "title": "Palmira_2019"
    }
  ]
}
```

Ответ:

```json
{
  "attached": [
    {
      "driveItemId": "dataset-palmira-2019-model",
      "datasetId": "dataset-01J...",
      "layerId": "layer-01J...",
      "title": "Palmira_2019"
    }
  ],
  "skipped": []
}
```

Кнопка `Прикрепить` должна быть доступна только если `selectedCount > 0` и выбранные элементы имеют `canAttach = true`.

Пример добавления картографического веб-сервиса:

```json
{
  "title": "Ортофото",
  "serviceType": "wmts",
  "url": "https://example.org/wmts",
  "layerName": "orthophoto",
  "coordinateSystem": "EPSG:3857",
  "visible": true,
  "opacity": 1.0
}
```

Нужно предусмотреть ошибки:

```json
{
  "code": "quota_exceeded",
  "userMessage": "Недостаточно места в хранилище. Доступно 1.2 ГБ, требуется 4.5 ГБ.",
  "limitBytes": 53687091200,
  "usedBytes": 52400000000,
  "requestedBytes": 4500000000
}
```

## 9. Диск и организация файлов в Geoscan Cloud

Отдельно от окна проекта в Geoscan Cloud есть раздел `Диск`, который отвечает за организацию файлов, папок, проектов и объектов внутри облака. Это не рабочая область viewer, а уровень хранения и навигации по данным пользователя/организации.

По документации Geoscan Cloud структура диска делится на три основные сущности:

```text
Folder
  папка для организации проектов, объектов и других папок
  максимальная глубина вложенности: 10 уровней

Object
  именованная коллекция проектов одной территории/объекта
  проекты внутри объекта отражают состояние в разные даты съемки
  при открытии объекта по умолчанию открывается проект с самой поздней датой съемки

Project
  коллекция готовых геопространственных наборов данных
  содержит группы, datasets/слои и документы, например отчеты об измерениях
```

На скриншоте видны:

| UI элемент | Что нужно в API |
|---|---|
| Левое меню `Диск`, `Команда`, `Брендирование`, `Безопасность` | API организации/аккаунта и разделов управления. |
| Breadcrumb `Диск / Heritage 3D / Санкт-Петербург` | Иерархия папок и текущий путь. |
| Поиск | Поиск по папкам, проектам и объектам на диске. |
| Сортировка `Дата изменения` | Сортировка элементов диска. |
| Карточки объектов/проектов | Список элементов с preview, названием, датой съемки, датой изменения и размером. |
| Checkbox на карточке | Множественный выбор элементов. |
| Меню `...` на карточке | Контекстные действия: открыть, переименовать, переместить, удалить, скачать и т.д. |
| Блок `Добавить +` | Создать проект, объект или папку. |

Меню `Добавить +` содержит действия:

| Действие UI | Нужный API |
|---|---|
| `Создать проект` | Создать cloud project в текущей папке. |
| `Создать объект` | Создать cloud object/dataset item в текущей папке. |
| `Создать папку` | Создать папку на диске. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/drive/items?parentId={parentId}&query={query}&sort={sort}` | Получить элементы диска в папке с поиском и сортировкой. |
| `GET` | `/geoscan/v1/drive/items/{driveItemId}` | Получить элемент диска: папку, проект или объект. |
| `GET` | `/geoscan/v1/drive/items/{driveItemId}/breadcrumbs` | Получить путь до текущего элемента. |
| `POST` | `/geoscan/v1/drive/folders` | Создать папку. |
| `POST` | `/geoscan/v1/drive/projects` | Создать проект в папке диска. |
| `POST` | `/geoscan/v1/drive/objects` | Создать объект в папке диска. |
| `PATCH` | `/geoscan/v1/drive/items/{driveItemId}` | Переименовать, переместить или обновить метаданные элемента. |
| `DELETE` | `/geoscan/v1/drive/items/{driveItemId}` | Удалить элемент диска с проверкой прав. |
| `POST` | `/geoscan/v1/drive/items/bulk-action` | Выполнить действие над выбранными элементами. |

Для `drive/items` нужно отдавать `type`: `folder`, `object`, `project`, `dataset`, `document`, а также `capturedAt` для проектов, чтобы объект мог выбирать проект по дате съемки.

Дополнительные endpoints для объектов как коллекций проектов:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/drive/objects/{objectId}/projects` | Получить проекты объекта, отсортированные по дате съемки. |
| `GET` | `/geoscan/v1/drive/objects/{objectId}/default-project` | Получить проект объекта, который должен открываться по умолчанию. |
| `PATCH` | `/geoscan/v1/drive/projects/{projectId}/captured-at` | Изменить дату съемки проекта. |

Пример элемента диска:

```json
{
  "driveItemId": "drive-project-peterburg-isaakievskij-sobor",
  "type": "project",
  "title": "peterburg_isaakievskij_sobor",
  "parentId": "folder-sankt-peterburg",
  "previewUrl": "https://cloud.geoscan.ru/api/drive/items/.../preview.jpg",
  "capturedAt": "2025-11-25",
  "updatedAt": "2026-05-25T12:00:00Z",
  "sizeBytes": 3156800000,
  "sizeHuman": "2.94 ГБ",
  "permissions": {
    "canOpen": true,
    "canRename": true,
    "canMove": true,
    "canDelete": true,
    "canDownload": true
  }
}
```

Пример создания папки:

```json
{
  "parentId": "folder-heritage-3d",
  "title": "Санкт-Петербург"
}
```

Пример bulk action:

```json
{
  "action": "move",
  "itemIds": [
    "drive-project-peterburg-isaakievskij-sobor",
    "drive-project-kronstadt-naval-cathedral"
  ],
  "targetParentId": "folder-archive"
}
```

Для Heritage3D важно различать:

```text
Drive item
  папка, проект или объект в облачном диске Geoscan Cloud

Project workspace
  внутренняя структура конкретного проекта: слои, группы, туры, POI, настройки viewer
```

Связь с Heritage3D должна хранить не только `geoscanProjectId`, но при необходимости и `driveItemId`, чтобы портал мог открывать объект в нужной папке облака и прикреплять данные из диска.

## 10. Команда, рабочая группа и роли

В разделе `Команда` видна структура пользователей текущей организации/рабочей группы Geoscan Cloud. Это важно для Heritage3D, потому что права на создание, загрузку, удаление, публикацию и прикрепление данных зависят от роли пользователя.

На скриншоте:

| UI элемент | Что нужно в API |
|---|---|
| Текущая организация `GEOSCAN` | Получить текущую организацию/рабочую группу. |
| Раздел `Команда` | Получить участников организации. |
| Поиск | Искать участников по имени или email. |
| Сортировка `Роль` | Сортировать участников по роли. |
| Таблица `Роль / Имя` | Список участников с ролью, именем и email. |
| Checkbox | Множественный выбор участников. |
| Кнопка `+ Добавить` | Пригласить или добавить участника. |
| Меню `...` | Действия над участником: изменить роль, удалить, повторить приглашение. |

Видимые роли:

| UI значение | API значение | Назначение |
|---|---|---|
| `Владелец` | `owner` | Полные права, управление организацией и счетом. |
| `Администратор` | `admin` | Управление участниками, проектами и настройками. |
| `Участник` | `member` | Работа с доступными проектами и данными. |
| `Внешний` | `external` | Ограниченная работа с общими данными: просмотр и аналитика. |

В модальном окне `Добавить` пользователь выбирает роль до добавления людей в команду. Список ролей должен приходить из API вместе с описанием прав, потому что текст используется прямо в UI.

На скриншоте в списке ролей:

| Роль | Описание в UI |
|---|---|
| `Внешний` | Может работать с общими данными с правами: просмотр, аналитика. |
| `Участник` | Может работать с общими данными с правами: просмотр, аналитика, редактирование или управление. |
| `Администратор` | Может управлять участниками команды и данными на диске команды. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/organizations/current` | Получить текущую организацию/рабочую группу пользователя. |
| `GET` | `/geoscan/v1/organizations/{organizationId}/roles` | Получить доступные роли и описания прав для формы добавления участника. |
| `GET` | `/geoscan/v1/organizations/{organizationId}/members?query={query}&sort={sort}` | Получить участников команды с поиском и сортировкой. |
| `POST` | `/geoscan/v1/organizations/{organizationId}/members/invitations` | Пригласить пользователя в команду. |
| `PATCH` | `/geoscan/v1/organizations/{organizationId}/members/{memberId}` | Изменить роль или статус участника. |
| `DELETE` | `/geoscan/v1/organizations/{organizationId}/members/{memberId}` | Удалить участника из команды. |
| `POST` | `/geoscan/v1/organizations/{organizationId}/members/bulk-action` | Массовые действия над выбранными участниками. |

Пример участника:

```json
{
  "memberId": "member-01J...",
  "organizationId": "org-geoscan",
  "role": "admin",
  "roleLabel": "Администратор",
  "name": "Zakhar Petrov",
  "email": "z.petrov@geoscan.ru",
  "status": "active",
  "isCurrentUser": false,
  "permissions": {
    "canChangeRole": true,
    "canRemove": true
  }
}
```

Пример приглашения:

```json
{
  "email": "user@example.org",
  "role": "member",
  "message": "Приглашаем в рабочую группу Heritage3D."
}
```

Пример справочника ролей:

```json
{
  "roles": [
    {
      "id": "external",
      "label": "Внешний",
      "description": "Может работать с общими данными с правами: просмотр, аналитика.",
      "permissions": ["view", "analytics"]
    },
    {
      "id": "member",
      "label": "Участник",
      "description": "Может работать с общими данными с правами: просмотр, аналитика, редактирование или управление.",
      "permissions": ["view", "analytics", "edit", "manage_assigned"]
    },
    {
      "id": "admin",
      "label": "Администратор",
      "description": "Может управлять участниками команды и данными на диске команды.",
      "permissions": ["view", "analytics", "edit", "manage_data", "manage_members"]
    }
  ]
}
```

Ограничения по ролям из документации:

| Правило | Требование к API |
|---|---|
| При приглашении нельзя сразу назначить `Администратор`. | `POST invitations` должен запрещать `role = admin` и возвращать понятную ошибку. |
| Пользователи, приглашенные в проект по email, добавляются в команду как `external`. | API sharing/invite должен возвращать созданного team member и роль `external`. |
| `admin` имеет полный доступ к диску и команде, но не управляет безопасностью и брендированием. | Effective permissions должны разделять `canManageMembers`, `canEditSecuritySettings`, `canEditBranding`. |
| `member` и `external` по умолчанию не имеют доступа к данным диска без роли в каталоге. | Доступ к drive items должен считаться через catalog roles. |

Пример ошибки при попытке пригласить администратора:

```json
{
  "code": "admin_role_not_allowed_on_invite",
  "userMessage": "По соображениям безопасности роль Администратор нельзя назначить при приглашении. Добавьте пользователя с другой ролью и измените роль после присоединения."
}
```

### 10.1. Роли в каталогах и наследование доступа

В Geoscan Cloud кроме роли в команде есть роль в каталоге. Она назначается на папку, объект или проект и наследуется вниз по иерархии. Если ниже по иерархии назначена прямая роль с более высокими правами, активной становится прямая роль; если ниже назначена роль с более низкими правами, активной остается унаследованная роль.

Роли каталогов:

| UI значение | API значение | Права |
|---|---|---|
| `Менеджер` | `manager` | Просмотр, скачивание, редактирование, удаление, sharing, создание вложенных каталогов, управление ролями. |
| `Редактор` | `editor` | Просмотр, скачивание, редактирование, создание вложенных каталогов, без удаления и управления ролями. |
| `Аналитик` | `analyst` | Просмотр, скачивание, создание и управление аннотациями: векторные слои, инспекции, туры. |
| `Зритель` | `viewer` | Только просмотр и скачивание. |
| `Без доступа` | `none` | Нет прямого доступа. |

Ограничение: пользователю с командной ролью `external` нельзя назначить роль каталога выше `analyst`.

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/drive/items/{driveItemId}/access` | Получить прямые, унаследованные и активные роли для элемента диска. |
| `PUT` | `/geoscan/v1/drive/items/{driveItemId}/access/{memberId}` | Назначить прямую роль пользователя на каталог. |
| `DELETE` | `/geoscan/v1/drive/items/{driveItemId}/access/{memberId}` | Удалить прямую роль пользователя на каталог. |

Пример:

```json
{
  "driveItemId": "drive-project-peterburg-isaakievskij-sobor",
  "memberId": "member-01J...",
  "teamRole": "member",
  "directCatalogRole": "analyst",
  "inheritedCatalogRole": "viewer",
  "activeCatalogRole": "analyst",
  "permissions": {
    "canView": true,
    "canDownload": true,
    "canEdit": false,
    "canDelete": false,
    "canManageAnnotations": true,
    "canManageAccess": false
  }
}
```

Для API интеграции важно, чтобы Geoscan Cloud мог вернуть не только роль в организации, но и effective permissions для конкретного проекта/drive item:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/permissions/me` | Получить права текущего пользователя на проект. |
| `GET` | `/geoscan/v1/drive/items/{driveItemId}/permissions/me` | Получить права текущего пользователя на элемент диска. |

Пример прав:

```json
{
  "canView": true,
  "canUpload": true,
  "canEdit": true,
  "canDelete": false,
  "canManageMembers": false,
  "canPublish": true
}
```

### 10.2. Тариф, лимиты и использование

В левом нижнем блоке интерфейса показан текущий тариф и использование хранилища. На скриншоте:

```text
Бесплатный тариф
Хранение
177.9 ГБ / 5 ТБ
3.5% занято
```

Эти данные обязательно нужны в API, потому что портал должен заранее понимать лимиты загрузки, показывать пользователю состояние тарифа и корректно обрабатывать превышение квот.

Нужные данные:

| UI/данные | API-параметр | Назначение |
|---|---|---|
| Название тарифа | `plan.name` | Показать текущий тариф. |
| Код тарифа | `plan.code` | Логика ограничений и апгрейда. |
| Хранилище использовано | `storage.usedBytes` | Прогресс и проверка загрузки. |
| Лимит хранилища | `storage.limitBytes` | Максимальный объем данных. |
| Процент занято | `storage.usedPercent` | UI прогресс-бара. |
| Месячные лимиты | `monthlyLimits` | Лимиты на загрузки, обработку, трафик, операции или публикации. |
| Сброс месячных лимитов | `billingPeriod.endsAt` | Когда обновляются месячные лимиты. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/organizations/{organizationId}/billing/plan` | Получить текущий тариф организации. |
| `GET` | `/geoscan/v1/organizations/{organizationId}/usage` | Получить использование ресурсов и лимиты. |
| `GET` | `/geoscan/v1/organizations/{organizationId}/limits` | Получить все лимиты тарифа, включая месячные. |

Пример:

```json
{
  "organizationId": "org-geoscan",
  "plan": {
    "code": "free",
    "name": "Бесплатный тариф"
  },
  "storage": {
    "usedBytes": 190803843482,
    "usedHuman": "177.9 ГБ",
    "limitBytes": 5497558138880,
    "limitHuman": "5 ТБ",
    "usedPercent": 3.5
  },
  "monthlyLimits": {
    "uploads": {
      "used": 12,
      "limit": 100,
      "remaining": 88
    },
    "processingJobs": {
      "used": 8,
      "limit": 50,
      "remaining": 42
    },
    "egressBytes": {
      "usedBytes": 21474836480,
      "usedHuman": "20 ГБ",
      "limitBytes": 107374182400,
      "limitHuman": "100 ГБ",
      "remainingBytes": 85899345920,
      "remainingHuman": "80 ГБ"
    }
  },
  "billingPeriod": {
    "startsAt": "2026-05-01T00:00:00Z",
    "endsAt": "2026-06-01T00:00:00Z"
  }
}
```

При создании upload Geoscan Cloud должен учитывать и общий лимит хранилища, и месячные лимиты тарифа. Если лимит превышен, API должен возвращать структурированную ошибку с `userMessage`, текущим тарифом, лимитом, использованным объемом и временем сброса месячного лимита.

## 11. Брендирование

В разделе `Брендирование` настраиваются данные организации, которые отображаются на главной странице, во встроенных проектах, проектах с доступом и отчетах. Для Heritage3D это важно, если Geoscan Cloud viewer/embed должен показывать бренд портала или организации-владельца.

На скриншоте видны поля:

| UI поле | API-параметр | Комментарий |
|---|---|---|
| `Название` | `name` | Название бренда/организации, например `Geoscan`. |
| `Сайт` | `websiteUrl` | Сайт организации. |
| `Шапка главной страницы` | `logos.mainHeader` | SVG-файл до 200 КБ. |
| `Шапка встроенных проектов` | `logos.embeddedProjectsHeader` | SVG-файл до 200 КБ, используется в embed. |
| `Шапка проектов с доступом` | `logos.sharedProjectsHeader` | SVG-файл до 200 КБ. |
| `Шапка отчётов об измерениях / обследованиях` | `logos.reportsHeader` | SVG-файл до 200 КБ. |

У логотипов есть действия:

| Действие UI | Что нужно в API |
|---|---|
| Загрузить файл | Upload SVG-логотипа. |
| Привязать/выбрать существующий | Использовать уже загруженный brand asset. |
| Сбросить | Вернуть логотип по умолчанию. |
| `Применить изменения` | Сохранить branding settings. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/organizations/{organizationId}/branding` | Получить настройки брендинга. |
| `PUT` | `/geoscan/v1/organizations/{organizationId}/branding` | Сохранить название, сайт и выбранные логотипы. |
| `POST` | `/geoscan/v1/organizations/{organizationId}/branding/assets` | Загрузить SVG-логотип или другой brand asset. |
| `DELETE` | `/geoscan/v1/organizations/{organizationId}/branding/assets/{assetId}` | Удалить brand asset или сбросить логотип. |

Пример:

```json
{
  "organizationId": "org-geoscan",
  "name": "Geoscan",
  "websiteUrl": "https://www.geoscan.ru",
  "logos": {
    "mainHeader": {
      "assetId": "brand-logo-main",
      "url": "https://cloud.geoscan.ru/api/branding/assets/brand-logo-main.svg",
      "fileName": "main-logo.svg",
      "contentType": "image/svg+xml",
      "sizeBytes": 15240
    },
    "embeddedProjectsHeader": {
      "assetId": "brand-logo-embed",
      "url": "https://cloud.geoscan.ru/api/branding/assets/brand-logo-embed.svg",
      "fileName": "embed-logo.svg",
      "contentType": "image/svg+xml",
      "sizeBytes": 18420
    },
    "sharedProjectsHeader": null,
    "reportsHeader": null
  },
  "constraints": {
    "allowedContentTypes": ["image/svg+xml"],
    "maxFileSizeBytes": 204800
  }
}
```

В embed API нужно предусмотреть параметр, позволяющий включать/выключать брендированную шапку:

```json
{
  "branding": {
    "enabled": true,
    "useOrganizationBranding": true,
    "logoContext": "embeddedProjectsHeader"
  }
}
```

## 12. Безопасность организации

В разделе `Безопасность` настраиваются ограничения для приглашений и доступа к данным команды. Эти параметры должны быть доступны через API, потому что портал Heritage3D должен понимать, можно ли приглашать пользователей с внешними email-доменами и можно ли открывать данные без авторизации.

На скриншоте видны настройки:

| UI поле | API-параметр | Назначение |
|---|---|---|
| `Разрешённые домены` | `allowedInviteDomains` | Список доменов, с которых можно приглашать пользователей. |
| `Ограничить новые приглашения разрешёнными доменами` | `restrictInvitationsToAllowedDomains` | Запретить приглашения вне allowlist. |
| Домен `geoscan.ru` | `allowedInviteDomains[]` | Разрешенный домен. |
| `Запретить неавторизованный доступ` | `denyUnauthorizedTeamDataAccess` | Запретить доступ к данным команды для неавторизованных пользователей. |
| `Применить изменения` | save security settings | Сохранить настройки безопасности. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/organizations/{organizationId}/security-settings` | Получить настройки безопасности организации. |
| `PUT` | `/geoscan/v1/organizations/{organizationId}/security-settings` | Сохранить настройки безопасности. |
| `POST` | `/geoscan/v1/organizations/{organizationId}/security-settings/validate-invitation` | Проверить, можно ли пригласить email с учетом доменных ограничений. |

Пример:

```json
{
  "organizationId": "org-geoscan",
  "restrictInvitationsToAllowedDomains": true,
  "allowedInviteDomains": ["geoscan.ru"],
  "denyUnauthorizedTeamDataAccess": false,
  "permissions": {
    "canEditSecuritySettings": true
  }
}
```

Пример ошибки при приглашении пользователя с запрещенным доменом:

```json
{
  "code": "invite_domain_not_allowed",
  "userMessage": "Пользователей можно приглашать только с разрешенных доменов: geoscan.ru.",
  "email": "user@example.org",
  "allowedInviteDomains": ["geoscan.ru"]
}
```

Для embed и публичных ссылок важно учитывать `denyUnauthorizedTeamDataAccess`: если настройка включена, Geoscan Cloud не должен выдавать публичный viewer/embed без авторизации или без временного access token.

## 13. Личный кабинет и уведомления пользователя

В правом верхнем меню профиля доступны личный кабинет, настройки, портал поддержки, соглашение и выход. Это настройки конкретного пользователя, а не организации. Для Heritage3D важно получать профиль пользователя, email и настройки уведомлений, потому что обработка, публикация и ошибки загрузки должны сопровождаться уведомлениями.

В меню профиля видны:

| UI элемент | Что нужно в API |
|---|---|
| Имя `Geoscan Demo` | Профиль пользователя. |
| Email `agisoft-cloud-demo@geoscan.ru` | Email пользователя для уведомлений. |
| `Личный кабинет` | Ссылка/endpoint на профиль. |
| `Настройки` | User settings. |
| `Портал поддержки` | URL поддержки. |
| `Соглашение` | URL пользовательского соглашения. |
| `Выйти` | Logout/session revoke. |

На экране настроек виден блок `Уведомления по электронной почте`:

| Настройка UI | API-параметр | Комментарий |
|---|---|---|
| `Информация о транзакциях (обязательно)` | `emailNotifications.transactions` | Обязательная настройка, нельзя отключить. |
| `Уведомления о приглашениях (обязательно)` | `emailNotifications.invitations` | Обязательная настройка, нельзя отключить. |
| `Когда обработка или публикация проекта выполнена или завершилась ошибкой` | `emailNotifications.processingAndPublishing` | Уведомления о статусе обработки/публикации. |
| `При нехватке дискового пространства или времени обработки` | `emailNotifications.quotaAndProcessingLimits` | Уведомления о лимитах. |
| `Новости и объявления` | `emailNotifications.newsAndAnnouncements` | Маркетинговые/информационные уведомления. |

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/users/me` | Получить профиль текущего пользователя. |
| `GET` | `/geoscan/v1/users/me/settings` | Получить личные настройки пользователя. |
| `PUT` | `/geoscan/v1/users/me/settings/email-notifications` | Сохранить настройки email-уведомлений. |
| `GET` | `/geoscan/v1/users/me/navigation-links` | Получить ссылки на поддержку, соглашение и личный кабинет. |
| `POST` | `/geoscan/v1/auth/logout` | Завершить сессию пользователя. |

Пример настроек уведомлений:

```json
{
  "userId": "user-01J...",
  "email": "agisoft-cloud-demo@geoscan.ru",
  "emailNotifications": {
    "transactions": {
      "enabled": true,
      "required": true
    },
    "invitations": {
      "enabled": true,
      "required": true
    },
    "processingAndPublishing": {
      "enabled": true,
      "required": false
    },
    "quotaAndProcessingLimits": {
      "enabled": true,
      "required": false
    },
    "newsAndAnnouncements": {
      "enabled": true,
      "required": false
    }
  }
}
```

События, которые должны уметь инициировать email-уведомления:

| Событие | Когда отправлять |
|---|---|
| `processing.completed` | Обработка проекта/файла успешно завершена. |
| `processing.failed` | Обработка завершилась ошибкой. |
| `publishing.completed` | Публикация проекта успешно завершена. |
| `publishing.failed` | Публикация завершилась ошибкой. |
| `quota.storage_low` | Недостаточно дискового пространства. |
| `quota.processing_time_low` | Недостаточно времени обработки или месячного лимита. |
| `invitation.created` | Пользователь приглашен в команду. |

## 14. Встраиваемый редактор Geoscan Cloud

Для функций, требующих интерактивной 3D-сцены, портал не должен заново реализовывать редактор Geoscan Cloud через REST API. Нужен отдельный режим встройки: `Geoscan Cloud embedded editor`.

Этот режим используется на странице добавления и редактирования модели портала Heritage3D. Пользователь остается на портале, но редактирует 3D-сцену во встроенном редакторе Geoscan Cloud.

Редактор должен позволять управлять:

```text
слоями и видимостью;
загрузкой и настройкой импорта;
положением / трансформацией модели;
стартовой камерой;
preview через "Сохранить вид";
POI;
турами;
измерениями;
системами координат и единицами измерения;
режимом сравнения, если он доступен;
сохранением сцены.
```

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `POST` | `/geoscan/v1/editor-sessions` | Создать короткоживущую сессию встроенного редактора. |
| `GET` | `/geoscan/v1/editor-sessions/{editorSessionId}` | Получить статус editor session. |
| `POST` | `/geoscan/v1/editor-sessions/{editorSessionId}/save` | Сохранить сцену из редактора. |
| `POST` | `/geoscan/v1/editor-sessions/{editorSessionId}/publish` | Опубликовать/обновить viewer manifest и embed после редактирования. |

Пример создания editor session:

```json
{
  "h3druObjectId": "h3d:object:01J...",
  "twId": "tw_01J...",
  "geoscanProjectId": "project_123",
  "allowedOrigins": ["https://heritage3d.ru"],
  "allowedTools": [
    "upload",
    "layers",
    "transform",
    "viewerSettings",
    "tours",
    "poi",
    "measurements",
    "preview",
    "saveScene"
  ],
  "tokenTtlSeconds": 3600
}
```

Пример ответа:

```json
{
  "editorSessionId": "editor-session-01J...",
  "editorUrl": "https://cloud.geoscan.ru/embed/editor/projects/project_123?session=...",
  "editorToken": "eyJ...",
  "tokenExpiresAt": "2026-05-26T15:00:00Z",
  "allowedOrigins": ["https://heritage3d.ru"],
  "allowedTools": [
    "upload",
    "layers",
    "transform",
    "viewerSettings",
    "tours",
    "poi",
    "measurements",
    "preview",
    "saveScene"
  ]
}
```

После сохранения сцены редактор должен вернуть порталу событие через `postMessage` и/или позволить backend Heritage3D запросить результат публикации через API.

Примеры событий:

| Событие | Назначение |
|---|---|
| `geoscan.editor.ready` | Редактор загружен и готов. |
| `geoscan.scene.saved` | Сцена сохранена пользователем. |
| `geoscan.project.updated` | В проекте изменились слои, POI, туры, измерения или настройки. |
| `geoscan.preview.created` | Создано или обновлено preview. |
| `geoscan.publish.ready` | Готовы `manifestUrl`, `iframeUrl`, `previewUrl`. |
| `geoscan.editor.error` | Ошибка редактора или сохранения. |

Пример результата сохранения/публикации:

```json
{
  "twId": "tw_01J...",
  "geoscanProjectId": "project_123",
  "manifestUrl": "https://cloud.geoscan.ru/api/viewer/manifests/project_123.json",
  "iframeUrl": "https://cloud.geoscan.ru/embed/projects/project_123?...",
  "previewUrl": "https://cloud.geoscan.ru/api/projects/project_123/preview.jpg",
  "updatedAt": "2026-05-26T15:00:00Z"
}
```

Портал Heritage3D сохраняет у себя `twId`, `geoscanProjectId`, `manifestUrl`, `iframeUrl`, `previewUrl`, статус публикации и дату обновления. Само состояние 3D-сцены, слоев, туров и POI хранится в Geoscan Cloud.

## 15. Embed для Heritage3D

Порталу нужен endpoint, который возвращает готовые данные для встройки Geoscan viewer.

По документации Geoscan Cloud у внешнего доступа есть два режима:

| Режим | Поведение |
|---|---|
| Доступ по ссылке | Проект становится доступен без входа всем, у кого есть ссылка, если это не запрещено настройками безопасности команды. |
| Доступ по коду встраивания | Генерируется HTML iframe с преднастроенными параметрами отображения. |

Ссылка общего доступа сохраняет текущий вид через query-параметры:

```text
https://cloud.geoscan.ru/shared/projects/{projectId}?position=longitude,latitude,height&orientation=heading,pitch,roll
```

Где `position` управляет положением камеры, а `orientation` — направлением, тангажом и креном.

Важно: ссылка проекта остается неизменной. Если доступ по ссылке выключили, а затем включили снова, старая ссылка снова начинает работать.

| Method | Endpoint | Назначение |
|---|---|---|
| `POST` | `/geoscan/v1/embed` | Сформировать embed для проекта/объекта. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/sharing` | Получить настройки общего доступа проекта. |
| `PUT` | `/geoscan/v1/projects/{geoscanProjectId}/sharing` | Включить/выключить доступ по ссылке и embed-коду. |

Запрос:

```json
{
  "h3druObjectId": "h3dru:object:01J...",
  "twinId": "twin_123",
  "h3druAssetId": "asset_123",
  "geoscanProjectId": "d8fa8fda-efa8-403b-9710-d2eaf72fc29b",
  "geoscanObjectId": "Isaac_model_HiRes",
  "accessMode": "public",
  "viewerSettings": {
    "viewMode": "model",
    "quality3d": "medium",
    "baseMap": "sentinel",
    "trackball": "hidden",
    "coordinateSystem": "EPSG:4326",
    "measurementSystem": "meters",
    "appearance": {
      "displayMode": "heightmap",
      "opacity": 1.0
    },
    "heightRange": {
      "clippingEnabled": true,
      "min": -83.583,
      "max": 24.517,
      "unit": "m"
    }
  },
  "ui": {
    "showToolbar": true,
    "showLayerTree": false,
    "showProperties": false,
    "showAttribution": true,
    "showMeasurements": true,
    "showTour": true
  },
  "tourPlayer": {
    "enabled": true,
    "defaultTourId": "tour-1",
    "autoplayOnLoad": false,
    "loop": false,
    "showProgress": true,
    "showStepTitle": true
  },
  "sharing": {
    "linkAccessEnabled": true,
    "embedAccessEnabled": true,
    "cameraUrlParams": {
      "position": [31.477498, 59.839118, 2818.128528],
      "orientation": [360, -90, 0]
    },
    "embedOptions": {
      "width": 1280,
      "height": 720,
      "autoplay": false,
      "showProjectTitle": true,
      "showPanelsAndTools": true
    }
  }
}
```

Ответ:

```json
{
  "iframeUrl": "https://cloud.geoscan.ru/embed/projects/...?...",
  "iframeHtml": "<iframe ...></iframe>",
  "embedToken": "eyJ...",
  "tokenExpiresAt": "2026-05-25T23:00:00Z",
  "manifestUrl": "https://cloud.geoscan.ru/api/..."
}
```

## 16. Скачивание / удаление

В панели объекта видны кнопки download и delete. Для Heritage3D эти действия должны идти через портал с проверкой прав.

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}/download` | Получить временную ссылку на скачивание. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/objects/{geoscanObjectId}` | Удалить объект из проекта. |

Важно: пользователь на сайте не должен напрямую удалять объект в Geoscan Cloud. Портал проверяет роль и вызывает Geoscan API сервисным токеном.

## 17. Инструменты измерений и координат

В viewer видны инструменты измерений, координат, линии и выделения области.

Инструмент линейки работает по точкам: пользователь ставит последовательность точек на модели, viewer соединяет их линиями и показывает дистанцию. Если контур замкнут, инструмент должен рассчитывать площадь, а также периметр.

Нужные возможности API/JS API:

| Команда | Назначение |
|---|---|
| `viewer.measure.start` | Включить режим измерения. |
| `viewer.measure.clear` | Очистить измерения. |
| `viewer.measure.create` | Создать измерение из массива точек. |
| `viewer.measure.update` | Обновить точки измерения. |
| `viewer.measure.delete` | Удалить конкретное измерение. |
| `viewer.coordinate.pick` | Получить координату точки. |
| `viewer.line.create` | Создать линию/отрезок. |
| `viewer.selection.start` | Начать выделение области. |
| `viewer.selection.clear` | Очистить выделение. |
| `viewer.camera.set` | Установить камеру. |
| `viewer.viewpoint.open` | Перейти к сохраненному ракурсу. |

События от viewer:

| Событие | Назначение |
|---|---|
| `viewer.ready` | Плеер загружен. |
| `viewer.objectSelected` | Выбран объект/слой. |
| `viewer.cameraChanged` | Изменилась камера. |
| `viewer.measurementCreated` | Создано измерение. |
| `viewer.measurementUpdated` | Измерение изменено: добавлена/перемещена/удалена точка. |
| `viewer.measurementDeleted` | Измерение удалено. |
| `viewer.coordinatePicked` | Пользователь выбрал координату. |
| `viewer.error` | Ошибка загрузки/доступа. |

Для сохранения измерений в проекте нужны endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/measurements` | Получить измерения проекта. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/measurements` | Создать измерение по точкам. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}` | Получить одно измерение. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}` | Обновить точки, название или стиль измерения. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}` | Удалить измерение. |

Пример измерения:

```json
{
  "measurementId": "measurement-1",
  "type": "polygon",
  "title": "Обмер участка кровли",
  "closed": true,
  "points": [
    {
      "position": [30.12, 59.93, 45.0],
      "coordinateSystem": "EPSG:4326"
    },
    {
      "position": [30.121, 59.93, 45.4],
      "coordinateSystem": "EPSG:4326"
    },
    {
      "position": [30.121, 59.931, 45.2],
      "coordinateSystem": "EPSG:4326"
    }
  ],
  "result": {
    "distance": 12.4,
    "perimeter": 35.8,
    "area": 48.2,
    "unit": "m",
    "areaUnit": "m2"
  },
  "style": {
    "lineColor": "#ffffff",
    "pointColor": "#ffffff",
    "lineStyle": "dashed"
  }
}
```

Если `closed = false`, API/viewer возвращает только длину линии в `result.distance`. Если `closed = true`, дополнительно возвращаются `result.perimeter` и `result.area`.

По документации Geoscan Cloud векторные слои и измерения шире, чем простая линейка:

| Возможность | Что нужно в API |
|---|---|
| Векторный слой | Создание, переименование, цвет дочерних геометрий, удаление, undo delete, экспорт `.geojson`. |
| Точка | Позиция WGS84, цвет, пользовательские атрибуты, копирование координат, экспорт `.geojson`. |
| Ломаная | Длина, горизонтальная длина, уклон, разность высот, редактирование вершин, экспорт `.geojson`. |
| Полигон | Площадь и периметр, редактирование вершин, экспорт `.geojson`. |
| Объем | Расчет объема насыпи/выемки по полигону, выбор поверхности и базовой плоскости. |
| Профиль высот | Построение профиля вдоль ломаной с заданным шагом, экспорт `.csv`. |
| Отчет об измерениях | Документ по векторному слою со сводкой по геометриям и измеренным свойствам. |

Дополнительные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/vector-layers` | Создать векторный слой. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/vector-layers/{layerId}/export.geojson` | Экспортировать векторный слой. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}/volume` | Рассчитать объем для полигона. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}/elevation-profile` | Построить профиль высот по ломаной. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}/elevation-profile.csv` | Экспортировать профиль высот. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/vector-layers/{layerId}/measurement-report` | Сгенерировать отчет об измерениях. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/documents/{documentId}/download` | Скачать отчет/документ проекта. |

Пример расширенного результата для ломаной:

```json
{
  "measurementId": "polyline-1",
  "type": "polyline",
  "result": {
    "distance": 42.1,
    "horizontalDistance": 39.8,
    "slopePercent": 5.7,
    "heightDifference": 2.3,
    "unit": "m"
  }
}
```

Типы базовой плоскости для объема:

| UI значение | API значение |
|---|---|
| `Аппроксимация` | `best_fit` |
| `Средний уровень` | `mean_level` |
| `Максимальный уровень` | `max_level` |
| `Минимальный уровень` | `min_level` |
| `Заданный уровень` | `custom_level` |

Если геометрия полигона или ломаной изменилась после расчета, результаты объема или профиля высот должны помечаться как устаревшие/сбрасываться, чтобы не показывать неверные значения.

## 18. Режим сравнения

Режим сравнения вызывается кнопкой в вертикальной панели viewer: самая нижняя кнопка, на две позиции ниже шестеренки. В этом режиме экран делится на две части вертикальным разделителем. Слева отображается панель с двумя слотами сравнения, каждый слот может иметь свой проект/объект, цветовую метку и видимость слоя.

На скриншоте оба слота показывают проект `peterburg_isaakievskij_sobor` и слой `Isaac_model_HiRes`, но API должен поддерживать сравнение разных объектов/версий/проектов, если у пользователя есть права.

| UI элемент | Что нужно в API |
|---|---|
| Верхний слот сравнения | `left` или `A`: проект, объект, видимость, цветовая метка. |
| Нижний слот сравнения | `right` или `B`: проект, объект, видимость, цветовая метка. |
| Вертикальный разделитель | Положение split-view, например `splitPosition = 0.5`. |
| Синяя/зеленая кнопки у разделителя | Переключение активной стороны или управление split. |
| Иконки глаза в слотах | Независимое управление видимостью слоя в каждом слоте. |
| Сцены слева/справа | Синхронизированная камера для визуального сравнения. |

Нужные настройки viewer/embed:

| Параметр | Тип | Назначение |
|---|---|---|
| `compare.enabled` | boolean | Включить режим сравнения при открытии viewer. |
| `compare.defaultLayout` | string | Тип раскладки: `vertical_split`. |
| `compare.splitPosition` | number | Положение разделителя от 0 до 1. |
| `compare.syncCamera` | boolean | Синхронизировать камеру между двумя сценами. |
| `compare.left` | object | Первый слот сравнения. |
| `compare.right` | object | Второй слот сравнения. |

Пример:

```json
{
  "compare": {
    "enabled": true,
    "defaultLayout": "vertical_split",
    "splitPosition": 0.5,
    "syncCamera": true,
    "left": {
      "slotId": "left",
      "label": "peterburg_isaakievskij_sobor",
      "color": "#4A90E2",
      "geoscanProjectId": "project-current",
      "geoscanObjectId": "Isaac_model_HiRes",
      "visible": true
    },
    "right": {
      "slotId": "right",
      "label": "peterburg_isaakievskij_sobor",
      "color": "#5AD65A",
      "geoscanProjectId": "project-compare",
      "geoscanObjectId": "Isaac_model_HiRes",
      "visible": true
    }
  }
}
```

Нужные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/compare-presets` | Получить сохраненные пресеты сравнения проекта. |
| `POST` | `/geoscan/v1/projects/{geoscanProjectId}/compare-presets` | Создать пресет сравнения. |
| `GET` | `/geoscan/v1/projects/{geoscanProjectId}/compare-presets/{comparePresetId}` | Получить один пресет сравнения. |
| `PATCH` | `/geoscan/v1/projects/{geoscanProjectId}/compare-presets/{comparePresetId}` | Обновить слоты, split position или синхронизацию камеры. |
| `DELETE` | `/geoscan/v1/projects/{geoscanProjectId}/compare-presets/{comparePresetId}` | Удалить пресет сравнения. |

Команды JS API/postMessage:

| Команда | Назначение |
|---|---|
| `viewer.compare.enable` | Включить режим сравнения. |
| `viewer.compare.disable` | Выключить режим сравнения. |
| `viewer.compare.setSlots` | Задать левый и правый слот сравнения. |
| `viewer.compare.setSplitPosition` | Установить положение разделителя. |
| `viewer.compare.setSyncCamera` | Включить/выключить синхронизацию камеры. |
| `viewer.compare.setVisibility` | Изменить видимость объекта в конкретном слоте. |

События от viewer:

| Событие | Назначение |
|---|---|
| `viewer.compareEnabled` | Режим сравнения включен. |
| `viewer.compareDisabled` | Режим сравнения выключен. |
| `viewer.compareSlotChanged` | Изменился объект/проект в слоте. |
| `viewer.compareSplitChanged` | Пользователь изменил положение разделителя. |
| `viewer.compareCameraSynced` | Камера синхронизирована между слотами. |

## 19. Что нужно от Geoscan Cloud для минимальной интеграции

Минимальный набор API:

```text
1. Создать проект.
2. Загрузить модель/архив.
3. Получить статус обработки.
4. Получить список объектов проекта.
5. Получить technicalInfo объекта.
6. Получить/сохранить viewerSettings.
7. Получить/сохранить viewpoints.
8. Сформировать embed.
9. Получить preview.
10. Получить download URL.
11. Удалить объект по подтвержденной команде портала.
12. Получать webhook о готовности/ошибке обработки.
13. Включать режим сравнения и передавать слоты сравнения в embed.
14. Создавать короткоживущую editor session для встроенного редактора.
15. Выдавать editor token, embed token и проверять allowed origins.
16. Поддерживать service token для backend Heritage3D и user token для действий пользователя.
```

## 20. Что остается на стороне Heritage3D

Geoscan Cloud не должен хранить полную карточку культурного объекта.

На стороне Heritage3D остаются:

```text
H3DID
Dublin Core
CIDOC CRM
КАМИС / Госкаталог / ЕГРОКН
организация-владелец
коллекции
статьи
права доступа
модерация
статусы публикации
```

Geoscan Cloud хранит техническое представление: проект, объекты, файлы, тайлы, preview, настройки viewer и embed.
