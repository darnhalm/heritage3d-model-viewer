# Embed API

Этот viewer можно встраивать на сайт через `iframe` и управлять им снаружи через `window.postMessage`.

Черновая OpenAPI/Swagger-документация для портального `Manifest API`, распределенных media assets и схем `postMessage` лежит в [`openapi.yaml`](openapi.yaml). Локальная страница Swagger UI: [`swagger-ui.html`](swagger-ui.html).

Смежная заметка по интеграции с Геоскан Облаком и выводам из переписки разработки: [`GEOSCAN-CLOUD-INTEGRATION-RU.md`](GEOSCAN-CLOUD-INTEGRATION-RU.md).

## Связь с подходом Sketchfab

По пользовательской логике встройки портал использует подход, похожий на Sketchfab: модель можно встроить через iframe, получить готовый HTML-код встройки и управлять viewer через браузерный API. Ближайшие аналоги:

- Sketchfab oEmbed — возвращает готовый HTML для вставки модели на сайт;
- Sketchfab Viewer API — управляет встроенным 3D viewer из внешней страницы;
- Sketchfab Download API — выдает временные ссылки на скачивание доступных форматов.

При этом архитектура портала отличается по назначению. Sketchfab строится вокруг опубликованной 3D-модели внутри единой платформы и собственного viewer. Портал «3D-наследие» должен строиться вокруг культурного объекта, его цифровых двойников, внешних идентификаторов, прав, версий и распределенного хранения.

```text
Sketchfab:
  model uid -> Sketchfab API -> Sketchfab viewer -> Sketchfab storage

3D-наследие:
  H3D object/twin ID -> manifest API -> allowlisted player -> distributed media storage
```

Иными словами, портал может использовать знакомые интеграционные паттерны Sketchfab, но расширяет их для задач культурного наследия:

- CIDOC CRM и отраслевой профиль метаданных;
- сквозная идентификация через ЕГРОКН, Госкаталог и музейные АИС;
- несколько заранее разрешенных плееров вместо одного обязательного viewer;
- распределенное хранение GLB, point cloud, 3D Tiles, панорам, текстур и архивных исходников;
- статусы `draft`, `submitted`, `verified`, `published`, `archived`;
- политики доступа `public`, `unlisted`, `password`, `restricted`, `internal`, `embargoed`;
- `viewerPolicy` для разрешенных `postMessage` команд.

## Что уже поддерживается

Viewer принимает команды:

- `focus-poi`
- `open-poi`
- `clear-poi`
- `next-poi`
- `prev-poi`
- `seek-animation`
- `play-animation`
- `pause-animation`
- `freeze-animation`

Viewer также отправляет события обратно наружу:

- `poi-selected`
- `poi-cleared`
- `animation-time`

## Базовый пример iframe

```html
<iframe
  id="viewer-frame"
  title="3D Viewer"
  src="https://your-domain.com/viewer/?load=%2Fmodels%2Fexample.glb&embed=1&ui=compact&panel=0&poi=1&tour=1"
  width="960"
  height="640"
  style="border:0"
  allow="autoplay; fullscreen; xr-spatial-tracking; web-share"
  allowfullscreen
></iframe>
```

## Формирование iframe через API

Чтобы внешние сайты и музейные АИС не собирали query string вручную, портал может выдавать готовую встройку через API:

```http
POST /api/v1/twins/{twinId}/embed
```

Пример тела запроса:

```json
{
  "playerId": "h3d-gltf-viewer",
  "preset": "compact",
  "language": "ru",
  "autoplay": false,
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
  "width": 960,
  "height": 640,
  "title": "3D Viewer"
}
```

`playerId` должен ссылаться на плеер из реестра портала. API не принимает произвольный `playerUrl`, чтобы нельзя было подставить внешний iframe вне allowlist.

Ответ содержит:

- `manifestUrl` — URL манифеста цифрового двойника;
- `iframeUrl` — URL viewer с уже сформированными параметрами;
- `iframeHtml` — готовый HTML-код iframe;
- `playerPolicy` — allowlist-политика выбранного плеера;
- `embedToken` — опциональный короткоживущий токен, если он нужен для закрытых данных;
- `query` — нормализованные query-параметры, из которых собран URL.

Поддерживаемые пресеты описаны в:

```http
GET /api/v1/embed-presets
```

## Реестр разрешенных плееров

Если у портала есть несколько заранее известных плееров, их лучше регистрировать на стороне портала:

```http
GET /api/v1/players
GET /api/v1/players/{playerId}/capabilities
GET /api/v1/players/{playerId}/policy
```

Пример записи плеера:

```json
{
  "id": "h3d-gltf-viewer",
  "name": "Heritage3D GLB Player",
  "baseUrl": "https://player-a.example.ru/viewer/",
  "status": "active",
  "trustLevel": "first_party",
  "allowedOrigins": ["https://player-a.example.ru"],
  "allowedFrameAncestors": ["https://heritage3d.example.ru"],
  "supportedFormats": ["glb", "gltf"],
  "capabilities": ["camera", "poi.navigate", "animation", "fullscreen"]
}
```

При генерации iframe портал проверяет:

- `playerId` есть в реестре;
- `status` равен `active`;
- формат цифрового двойника поддерживается плеером;
- нужные возможности есть в `capabilities`;
- origin плеера входит в `allowedOrigins`.

Для публичных моделей токен плеера не обязателен. Достаточно реестра плееров, CSP, CORS при необходимости и проверки `postMessage` origin. Токен нужен только для закрытых manifest/assets или временных signed URLs.

## Доступ к API и командам плеера

В Swagger-спецификации добавлен раздел `Access Control`:

```http
GET /api/v1/access-control/model
```

В нем описаны роли портала:

- `anonymous` — публичный просмотр опубликованных объектов;
- `user` — авторизованный пользователь;
- `contributor` — автор или участник, загружающий материалы;
- `institution_admin` — администратор учреждения;
- `moderator` — проверка, публикация и отклонение материалов;
- `admin` — полное управление порталом;
- `system` — машинный доступ для АИС, реестров и синхронизаций.

Для HTTP API роли фиксируются через `security`, `x-roles` и `x-permissions` в OpenAPI. Для `window.postMessage` роли не должны быть зашиты в сам viewer: портал вычисляет runtime-политику и передает ее в manifest или embed API.

Пример `viewerPolicy`:

```json
{
  "allowedOrigins": ["https://heritage3d.example.ru"],
  "targetOrigin": "https://heritage3d.example.ru",
  "commands": {
    "player.loadManifest": true,
    "camera.reset": true,
    "poi.focus": true,
    "animation.seek": true,
    "annotation.create": false,
    "asset.download": false
  }
}
```

Идея такая:

```text
роль пользователя -> server permissions -> viewerPolicy -> разрешенные postMessage команды
```

## Отправка команд во viewer

```html
<button data-poi-id="poi-1">Показать точку 1</button>
<button data-poi-id="poi-2">Показать точку 2</button>
<button id="poi-prev">Назад</button>
<button id="poi-next">Вперед</button>
<button id="poi-clear">Сбросить</button>

<script>
  const frame = document.getElementById('viewer-frame');

  document.querySelectorAll('[data-poi-id]').forEach((button) => {
    button.addEventListener('click', () => {
      frame.contentWindow.postMessage({
        type: 'focus-poi',
        id: button.dataset.poiId
      }, '*');
    });
  });

  document.getElementById('poi-prev').addEventListener('click', () => {
    frame.contentWindow.postMessage({ type: 'prev-poi' }, '*');
  });

  document.getElementById('poi-next').addEventListener('click', () => {
    frame.contentWindow.postMessage({ type: 'next-poi' }, '*');
  });

  document.getElementById('poi-clear').addEventListener('click', () => {
    frame.contentWindow.postMessage({ type: 'clear-poi' }, '*');
  });
</script>
```

## Формат входящих сообщений

### `focus-poi`

```json
{
  "type": "focus-poi",
  "id": "poi-1"
}
```

Поведение:

- активирует точку по `id`;
- открывает label;
- если у точки сохранен camera view, камера переходит к нему.

### `open-poi`

```json
{
  "type": "open-poi",
  "id": "poi-1"
}
```

Сейчас работает так же, как `focus-poi`.

### `clear-poi`

```json
{
  "type": "clear-poi"
}
```

Снимает текущую активную точку.

### `next-poi`

```json
{
  "type": "next-poi"
}
```

Переходит к следующей точке.

### `prev-poi`

```json
{
  "type": "prev-poi"
}
```

Переходит к предыдущей точке.

## Формат исходящих сообщений из viewer

### `poi-selected`

Viewer отправляет это событие наружу, когда активируется точка:

```json
{
  "type": "poi-selected",
  "id": "poi-1",
  "number": 1,
  "title": "Thorax",
  "description": "The midsection...",
  "color": "#000000"
}
```

Это удобно, если сайт должен подсвечивать соответствующий абзац или пункт списка.

### `poi-cleared`

Viewer отправляет это событие, когда активная точка сброшена:

```json
{
  "type": "poi-cleared"
}
```

## Пример приема событий на сайте

```html
<script>
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'poi-selected') {
      console.log('Активная точка:', data.id, data.title);
    }

    if (data.type === 'poi-cleared') {
      console.log('Активная точка сброшена');
    }
  });
</script>
```

## Практические замечания

- Для интеграции лучше использовать `poi.id`, а не номер точки.
- Номера могут меняться после reorder в списке POI.
- Если сайт и viewer работают на разных доменах, вместо `'*'` лучше указывать конкретный origin.
- Для embed-режима можно отдельно управлять показом POI и верхней tour-плашки через query-параметры:
  - `poi=0|1`
  - `tour=0|1`

## Следующий возможный шаг

Если понадобится более строгая интеграция, можно расширить API:

- `focus-poi` по slug;
- старт с конкретной точки через `?poi=...`;
- события `tour-next` / `tour-prev`;
- валидация `origin` для безопасного cross-window обмена.
