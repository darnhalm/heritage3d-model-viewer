# API-документация Heritage3D

В этой папке собраны материалы по API сайта, сервера хранения, плееров, Swagger/OpenAPI, draw.io, Obsidian Canvas и таблицам для Miro.

## Основные файлы

- [Решение по публикации 3D Tiles и использованию 3TZ](3TZ-PUBLICATION-DECISION-RU.md) — 3TZ как единый входной и архивный файл, распакованный `tileset.json` как production-представление для CDN и плеера; включает A/B-замер Yandex Object Storage и требования безопасности.
- [Актуальная архитектура медиасервера](../../../Mediaserver/docs/HERITAGE3D-TARGET-ARCHITECTURE-RU.md) — ведётся в проекте mediaserver; [редакция 1.10](HERITAGE3D-TARGET-ARCHITECTURE-RU.md) сохранена здесь как историческая. OpenAPI и контракты плеера пока остаются в этой папке.
- `MEDIA-SERVER-ARCHITECTURE-PROPOSAL-RU.md` — предложение по медиасерверу на Payload, нашим 3D/2D-плеерам, Editor/Viewer, обработке, защите и технической админке.
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
