# Miro OpenAPI Endpoint Visualizer

Небольшой Miro Web SDK app для визуализации OpenAPI endpoints на доске.

## Что делает

- Загружает OpenAPI YAML/JSON по URL или из текстового поля.
- Читает `paths`, HTTP-методы и `tags`.
- Создает на Miro board колонки по группам `tags`.
- Внутри каждой колонки создает карточки endpoints.
- Может соединять группы линиями.
- Опционально добавляет блок `components.schemas`.

## Как запустить локально

Из корня репозитория:

```bash
npx serve tools/miro-openapi-visualizer -l 8090
```

Локальный URL:

```text
http://127.0.0.1:8090
```

## Как подключить в Miro

1. Открыть Miro Developer Platform.
2. Создать Developer app.
3. В настройках app указать App URL.
4. Для локальной разработки Miro обычно требует публичный HTTPS URL, поэтому локальный `http://127.0.0.1:8090` нужно прокинуть через ngrok, Cloudflare Tunnel или другой HTTPS tunnel.
5. Установить app в свою команду Miro.
6. Открыть app на доске и вставить URL OpenAPI:

```text
http://127.0.0.1:8088/storage-player-openapi.yaml
```

Если Miro не видит локальный `127.0.0.1`, нужно также отдать OpenAPI YAML по публичному HTTPS URL.

## Для нашего API

Приложение разложит текущие группы:

- Upload
- Assets
- Preview
- POI
- Processing
- Download
- Embed
- Webhooks

Это визуальная карта для обсуждения ТЗ. Точной технической спецификацией остается Swagger/OpenAPI файл.
