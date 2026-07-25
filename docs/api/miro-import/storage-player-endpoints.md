# API сервера хранения и плееров 3D-наследие

Источник: `storage-player-openapi.yaml`

Всего endpoints: 15

## Upload

- `POST` `/storage/v1/uploads` — Получить временную ссылку для загрузки файла.
- `POST` `/storage/v1/uploads/{uploadId}/complete` — Подтвердить завершение загрузки.

## Assets

- `GET` `/storage/v1/assets/{storageAssetId}` — Получить техническую карточку файла.
- `DELETE` `/storage/v1/assets/{storageAssetId}` — Удалить файл или пометить его на удаление.
- `GET` `/storage/v1/assets/{storageAssetId}/file-url` — Получить URL файла для просмотра.
- `POST` `/storage/v1/assets/{storageAssetId}/archive` — Переместить файл в архивный класс хранения.
- `POST` `/storage/v1/assets/{storageAssetId}/restore` — Восстановить файл из архивного класса хранения.

## Processing

- `GET` `/storage/v1/assets/{storageAssetId}/status` — Получить статус загрузки/обработки файла.

## Preview

- `GET` `/storage/v1/assets/{storageAssetId}/preview` — Получить превью файла.
- `POST` `/storage/v1/assets/{storageAssetId}/preview` — Создать или обновить превью файла.

## POI

- `GET` `/storage/v1/assets/{storageAssetId}/poi` — Получить точки интереса для PlayCanvas-плеера.
- `PUT` `/storage/v1/assets/{storageAssetId}/poi` — Сохранить точки интереса для PlayCanvas-плеера.

## Download

- `GET` `/storage/v1/assets/{storageAssetId}/download-url` — Получить временную ссылку для скачивания.

## Embed

- `POST` `/storage/v1/embed` — Получить embed для файла или облачного проекта.

## Webhooks

- `POST` `/storage/v1/webhooks/asset-status` — Webhook о статусе файла в сторону портала.

