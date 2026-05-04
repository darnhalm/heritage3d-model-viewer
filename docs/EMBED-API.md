# Embed API

Этот viewer можно встраивать на сайт через `iframe` и управлять им снаружи через `window.postMessage`.

## Что уже поддерживается

Viewer принимает команды:

- `focus-poi`
- `open-poi`
- `clear-poi`
- `next-poi`
- `prev-poi`

Viewer также отправляет события обратно наружу:

- `poi-selected`
- `poi-cleared`

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
