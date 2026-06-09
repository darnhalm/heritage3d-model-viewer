# API-документация Heritage3D

В этой папке собраны материалы по API сайта, сервера хранения, плееров, Swagger/OpenAPI, draw.io, Obsidian Canvas и таблицам для Miro.

## Основные файлы

- `openapi.yaml` — большая OpenAPI-спецификация портала.
- `swagger-ui.html` — локальная Swagger UI-страница для `openapi.yaml`.
- `storage-player-openapi.yaml` — OpenAPI-спецификация сервера хранения/плееров.
- `storage-player-swagger-ui.html` — локальная Swagger UI-страница для storage/player API.
- `SITE-API-DRAFT-RU.md` — черновик API сайта.
- `STORAGE-PLAYER-API-RU.md` — краткое ТЗ по API сервера хранения/плееров.
- `GEOSCAN-CLOUD-API-EXTENSIONS-RU.md` — ТЗ на доработку API Geoscan Cloud по настройкам viewer, свойствам объекта, embed, upload/download.
- `PROJECT-ARCHITECTURE-RU.md` — отдельное описание архитектуры проекта: портал, storage/player, БД, S3, роли и потоки данных.
- `SKETCHFAB-TO-H3DRU-SITE-API-RU.md` — что берем из Sketchfab Data API для API сайта Heritage3D.
- `SITE-STORAGE-FUNCTIONAL-MAP-RU.md` — связка endpoint'ов сайта и storage/player.
- `API-COMMANDS-RU.md` — общий список команд API и `postMessage`.

## Экспорт

- `miro-import/` — Excel/HTML/TSV/JSON таблицы для Miro.
- `drawio/` — схемы draw.io.
  - `drawio/portal-conceptual-model.drawio` — концептуальная модель портала: ID, роли, организации, metadata, storage/player.
  - `drawio/page-api-mindmap.drawio` — карта страниц макета и вызовов API сайта/storage/player.
- `obsidian/` — Obsidian Canvas.
