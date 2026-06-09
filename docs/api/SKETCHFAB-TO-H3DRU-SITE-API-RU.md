# Что берем из Sketchfab API для API сайта Heritage3D

Этот документ фиксирует, какие идеи из Sketchfab Data API полезны для **API сайта Heritage3D**, а что должно остаться на стороне storage/player.

Источник сравнения: Sketchfab Data API v3 и Download API.

## 1. Главное различие

Sketchfab — это единая платформа, где модель, пользователь, организация, коллекции, лайки, загрузка и viewer живут внутри одной экосистемы.

Heritage3D лучше разделять на два слоя:

```text
API сайта Heritage3D
  - H3DID
  - культурные объекты
  - Dublin Core / CIDOC CRM
  - организации / музеи
  - коллекции
  - поиск
  - избранное / лайки
  - публикация и роли

Storage/player API
  - файлы
  - upload/download
  - preview
  - manifest
  - embed
  - технические metadata
```

Поэтому из Sketchfab мы берем не буквальные endpoints, а функциональные блоки.

## 2. Что берем из Sketchfab

| Блок Sketchfab | Что делаем в Heritage3D | Где живет |
|---|---|---|
| Models | Культурный объект + цифровой двойник + asset. | API сайта + storage/player |
| Organizations | Организации/музеи как владельцы H3DID. | API сайта |
| Collections | Коллекции и подколлекции объектов. | API сайта |
| Collection thumbnails | Миниатюры коллекций. | API сайта + preview из storage |
| Likes | Избранное: организация, коллекция, объект. | API сайта |
| Search | Единый поиск по объектам, коллекциям, организациям. | API сайта |
| Tags | Управляемые теги, связанные с Dublin Core / CIDOC CRM. | API сайта |
| Categories | UI-категории, мапятся на `dc:type` или `E55 Type`. | API сайта |
| Avatars | Аватар/логотип организации. | API сайта + storage |
| Download | Временные ссылки на скачивание asset. | API сайта вызывает storage |
| Viewer API | `window.postMessage` для iframe viewer. | Плеер / страница сайта |

## 3. Лайки: музей, коллекция, объект

В Heritage3D лучше не называть это только лайками. Для культурного портала понятнее термин **избранное**.

Нужны три уровня:

| Уровень | Что означает |
|---|---|
| Организация / музей | Пользователь сохраняет музей или подписывается на него. |
| Коллекция | Пользователь сохраняет тематическую подборку. |
| Объект / модель | Пользователь сохраняет конкретный H3DID-объект. |

Минимальные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/site/v1/me/favorites` | Избранное текущего пользователя. |
| `POST` | `/site/v1/me/favorites/organizations/{organizationId}` | Добавить организацию в избранное. |
| `DELETE` | `/site/v1/me/favorites/organizations/{organizationId}` | Убрать организацию из избранного. |
| `POST` | `/site/v1/me/favorites/collections/{collectionId}` | Добавить коллекцию в избранное. |
| `DELETE` | `/site/v1/me/favorites/collections/{collectionId}` | Убрать коллекцию из избранного. |
| `POST` | `/site/v1/me/favorites/objects/{h3druObjectId}` | Добавить объект в избранное. |
| `DELETE` | `/site/v1/me/favorites/objects/{h3druObjectId}` | Убрать объект из избранного. |

Счетчики можно хранить отдельно для сортировки `popular`, но не обязательно показывать публично.

## 4. Организации

Организации — один из самых важных блоков. В Heritage3D организация/музей должна быть владельцем объектов и коллекций.

Нужны:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/site/v1/organizations` | Организации пользователя или публичный список. |
| `POST` | `/site/v1/organizations` | Создать организацию. Обычно только admin. |
| `GET` | `/site/v1/organizations/{organizationId}` | Карточка организации. |
| `PATCH` | `/site/v1/organizations/{organizationId}` | Обновить профиль организации. |
| `GET` | `/site/v1/organizations/{organizationId}/members` | Участники и роли. |
| `POST` | `/site/v1/organizations/{organizationId}/members` | Добавить участника. |
| `PATCH` | `/site/v1/organizations/{organizationId}/members/{userId}` | Изменить роль участника. |
| `DELETE` | `/site/v1/organizations/{organizationId}/members/{userId}` | Удалить участника из организации. |
| `GET` | `/site/v1/organizations/{organizationId}/avatar` | Получить логотип/аватар организации. |
| `PUT` | `/site/v1/organizations/{organizationId}/avatar` | Назначить логотип/аватар организации. |
| `GET` | `/site/v1/organizations/{organizationId}/cover` | Получить широкую обложку организации. |
| `PUT` | `/site/v1/organizations/{organizationId}/cover` | Назначить широкую обложку организации. |

Аватар организации не надо смешивать с миниатюрой объекта. Это разные сущности.

## 5. Поиск

Поиск должен быть отдельным сильным блоком API сайта.

Sketchfab имеет общий поиск по моделям/коллекциям/пользователям. В Heritage3D логика похожая, но вместо пользователей нам важнее организации/музеи.

Нужны endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/site/v1/catalog/search` | Единый поиск по объектам, коллекциям и организациям. |
| `GET` | `/site/v1/catalog/search/objects` | Поиск только по объектам/моделям. |
| `GET` | `/site/v1/catalog/search/collections` | Поиск только по коллекциям. |
| `GET` | `/site/v1/catalog/search/organizations` | Поиск по организациям/музеям. |
| `GET` | `/site/v1/catalog/facets` | Фасеты и фильтры для каталога. |

## 6. Поля для поиска из Dublin Core и CIDOC CRM

Не нужно делать отдельные несвязанные категории, если такие данные уже есть в Dublin Core или CIDOC CRM.

Важные поля для поискового индекса:

| Источник | Поле | Для чего |
|---|---|---|
| H3DID | `h3druObjectId` | Точный поиск по ID. |
| Object | `title`, `slug`, `shortDescription` | Быстрый поиск и карточки каталога. |
| Dublin Core | `dc:title` | Название. |
| Dublin Core | `dc:creator` | Автор/создатель. |
| Dublin Core | `dc:subject` | Темы, ключевые слова, теги. |
| Dublin Core | `dc:description` | Полнотекстовый поиск. |
| Dublin Core | `dc:publisher` | Публикатор/организация. |
| Dublin Core | `dc:contributor` | Участники. |
| Dublin Core | `dc:date` | Даты и периоды. |
| Dublin Core | `dc:type` | Тип ресурса. |
| Dublin Core | `dc:format` | Формат ресурса. |
| Dublin Core | `dc:identifier` | Внешние и внутренние идентификаторы. |
| Dublin Core | `dc:source` | Источник данных. |
| Dublin Core | `dc:language` | Язык описания. |
| Dublin Core | `dc:relation` | Связанные объекты/публикации. |
| Dublin Core | `dc:coverage` | Территория/период. |
| Dublin Core | `dc:rights` | Права и лицензии. |
| CIDOC CRM | `crmClass` | Класс объекта: E22, E27 и т.д. |
| CIDOC CRM | `E42 Identifier` | CIDOC-представление идентификаторов: H3DID, инвентарные номера, КАМИС, Госкаталог, ЕГРОКН. Это не отдельный дубль H3DID, а семантическое описание идентификаторов. |
| CIDOC CRM | `E55 Type` | Типология/классификация. |
| CIDOC CRM | `E53 Place` | Место и координаты. |
| CIDOC CRM | `E52 Time-Span` | Датировка/период. |
| CIDOC CRM | `E39 Actor` | Автор, владелец, хранитель, организация. |
| CIDOC CRM | `E40 Legal Body` | Юридическое лицо/музей. |
| CIDOC CRM | `E12 Production` | Событие создания. |
| CIDOC CRM | `E7 Activity` | Оцифровка, реставрация, съемка. |
| Technical | `viewerType` | PlayCanvas, Geoscan, gigapixel, pointcloud. |
| Technical | `isDownloadable` | Можно ли скачать. |
| Technical | `faceCount`, `vertexCount`, `fileSizeBytes` | Технические фильтры при необходимости. |

## 7. Теги и категории

Теги обязательно нужны, но их лучше сделать не отдельным хаосом, а управляемым словарем.

Правило:

```text
tag -> dc:subject
category -> dc:type или CIDOC CRM E55 Type
```

То есть в UI пользователь видит “теги” и “категории”, а в данных они связаны со стандартами описания.

Минимальные endpoints:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/site/v1/tags` | Список тегов. |
| `POST` | `/site/v1/tags` | Создать тег в справочнике. |
| `GET` | `/site/v1/tags/{tagId}` | Получить тег. |
| `PATCH` | `/site/v1/tags/{tagId}` | Обновить тег. |
| `DELETE` | `/site/v1/tags/{tagId}` | Удалить/скрыть тег. |
| `POST` | `/site/v1/objects/{h3druObjectId}/tags` | Назначить теги объекту. |
| `DELETE` | `/site/v1/objects/{h3druObjectId}/tags/{tagId}` | Убрать тег с объекта. |
| `GET` | `/site/v1/categories` | Категории витрины. |
| `GET` | `/site/v1/categories/{categoryId}` | Категория и ее mapping на metadata. |

## 8. Коллекции

Коллекции нужны как отдельная большая сущность, а не просто поле объекта.

Нужно оставить:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/site/v1/organizations/{organizationId}/collections` | Дерево коллекций организации. |
| `POST` | `/site/v1/organizations/{organizationId}/collections` | Создать коллекцию/подколлекцию. |
| `GET` | `/site/v1/collections/{collectionId}` | Карточка коллекции. |
| `PATCH` | `/site/v1/collections/{collectionId}` | Обновить коллекцию. |
| `DELETE` | `/site/v1/collections/{collectionId}` | Скрыть/удалить коллекцию. |
| `PATCH` | `/site/v1/collections/{collectionId}/parent` | Переместить коллекцию в дереве. |
| `GET` | `/site/v1/collections/{collectionId}/objects` | Объекты коллекции. |
| `POST` | `/site/v1/collections/{collectionId}/objects` | Добавить объект в коллекцию. |
| `DELETE` | `/site/v1/collections/{collectionId}/objects/{h3druObjectId}` | Убрать объект из коллекции. |

`collectionId` и `parentCollectionId` не дублируют друг друга:

```text
collectionId = ID самой коллекции
parentCollectionId = ID родителя, если коллекция вложенная
```

## 9. Миниатюры

Нужны разные типы миниатюр:

| Миниатюра | Для чего | Источник |
|---|---|---|
| Object thumbnail | Карточка объекта в каталоге. | `primaryPreviewAssetId` или storage preview. |
| Twin thumbnail | Превью конкретного цифрового двойника. | storage/player screenshot. |
| Asset thumbnail | Превью конкретного файла/ассета. | storage preview. |
| Collection thumbnail | Обложка коллекции. | manual, first_object, popular_objects, collage. |
| Organization avatar | Логотип/аватар музея. | отдельный asset организации. |
| Organization cover | Широкая обложка страницы музея. | отдельный asset организации. |

Endpoints для коллекции:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/site/v1/collections/{collectionId}/thumbnail` | Получить миниатюру коллекции. |
| `PUT` | `/site/v1/collections/{collectionId}/thumbnail` | Назначить миниатюру коллекции. |
| `POST` | `/site/v1/collections/{collectionId}/thumbnail/generate` | Сгенерировать авто-миниатюру. |

## 10. Что не нужно копировать напрямую

| В Sketchfab | Почему не копируем буквально |
|---|---|
| Users как публичная сущность | У нас главная публичная сущность — организация/музей, не личный профиль пользователя. |
| Categories как отдельная независимая классификация | У нас категории должны мапиться на Dublin Core / CIDOC CRM. |
| Likes только на модели | У нас избранное нужно на трех уровнях: организация, коллекция, объект. |
| Model как одна сущность | У нас культурный объект, цифровой двойник и файл — разные сущности. |
| Viewer API внутри Data API | У нас REST API и `postMessage` API должны быть разделены. |

## 11. Вывод

Из Sketchfab для сайта Heritage3D нужно взять структуру пользовательских сценариев: организации, коллекции, поиск, теги, избранное, миниатюры, скачивание.

Но модель данных должна оставаться нашей:

```text
H3DID -> twinId -> h3druAssetId -> storageAssetId
```

А поиск и категории нужно строить поверх Dublin Core / CIDOC CRM, чтобы не плодить дублирующие поля.
