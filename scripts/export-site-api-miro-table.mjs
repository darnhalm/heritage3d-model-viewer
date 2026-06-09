import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "/Users/darnhalm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const outputPath = "/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import/site-api-table.xlsx";
const jsonPath = "/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import/site-api-table-data.json";
const mdPath = "/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/SITE-API-DRAFT-RU.md";

const methodStyle = {
  GET: { fill: "#55A2FF", font: "#05070A" },
  POST: { fill: "#08BF7A", font: "#05070A" },
  PUT: { fill: "#F59E0B", font: "#05070A" },
  PATCH: { fill: "#A78BFA", font: "#05070A" },
  DELETE: { fill: "#F2645A", font: "#05070A" },
  FIELD: { fill: "#64748B", font: "#FFFFFF" },
};

const sections = [
  {
    name: "Авторизация через Geoscan Login",
    description: "Регистрация, пароль и базовая учетная запись находятся во внешнем Geoscan Login. Портал Heritage3D проверяет токен и ведет свои роли, организации и права.",
    rows: [
      ["GET", "/site/v1/auth/session", "Проверить текущую авторизованную сессию.", "Любая страница сайта", "user", "нет", "Пользователь приходит из Geoscan Login."],
      ["GET", "/site/v1/me", "Получить текущего пользователя и его портальные роли.", "Любая авторизованная страница", "user", "нет", "Профиль сайта плюс geoscanUserId."],
      ["POST", "/site/v1/auth/logout", "Завершить сессию на портале.", "Профиль пользователя", "user", "нет", "Не заменяет logout в Geoscan, если нужен SSO logout."],
      ["GET", "/site/v1/permissions", "Проверить права пользователя на действие.", "Фронтенд сайта", "user", "нет", "Например asset:upload, object:publish, moderation:approve."],
    ],
  },
  {
    name: "Культурные объекты",
    description: "Главная карточка сайта. Здесь живет H3DID, тип объекта, название, статус, организация и профиль описания.",
    rows: [
      ["POST", "/site/v1/objects", "Создать культурный объект и выдать h3druObjectId.", "Страница создания объекта", "user/editor", "нет", "Создает бизнес-сущность портала."],
      ["GET", "/site/v1/objects", "Список объектов для админки/личного кабинета с фильтрами.", "Личный кабинет / админка", "user/editor/moderator/admin", "нет", "Не публичный каталог, а рабочий список."],
      ["GET", "/site/v1/objects/{h3druObjectId}", "Получить полную карточку объекта.", "Карточка объекта в админке", "owner/editor/moderator/admin", "нет", "Включает статус, владельца, профиль, связи."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}", "Обновить основные поля объекта.", "Редактирование объекта", "owner/editor/admin", "нет", "Название, описание, тип, адрес, профиль."],
      ["DELETE", "/site/v1/objects/{h3druObjectId}", "Удалить объект или пометить на удаление.", "Админка объекта", "owner/admin", "опционально DELETE storage assets", "Физическое удаление файлов лучше делать отдельной политикой."],
      ["FIELD", "h3druObjectId / H3DID", "Сквозной ID культурного объекта.", "Карточка объекта", "system", "нет", "Пример: h3dru:object:01JOBJABCDEF1234567890."],
      ["FIELD", "objectType", "Тип объекта портала.", "Карточка объекта", "owner/editor", "нет", "heritage_site, museum_object, archaeology, architecture, digital_only."],
      ["FIELD", "title", "Краткое название объекта для сайта.", "Карточка объекта / каталог", "owner/editor", "нет", "Не заменяет Dublin Core title, но может синхронизироваться с ним."],
      ["FIELD", "slug", "Человекочитаемый URL объекта.", "Публичная страница", "owner/editor", "нет", "Например usadebny-dom."],
      ["FIELD", "shortDescription", "Краткое описание для карточек каталога.", "Каталог", "owner/editor", "нет", "Не полный научный текст."],
      ["FIELD", "status", "Статус жизненного цикла.", "Админка / модерация", "system/editor/moderator", "нет", "draft, review, approved, published, rejected, archived, deleted, password_protected."],
      ["FIELD", "ownerOrganizationId", "Организация-владелец H3DID.", "Карточка объекта", "organization_admin/admin", "нет", "Музей/учреждение как юридически стабильный владелец."],
      ["FIELD", "assignedWorkgroupId", "Рабочая группа, которая сейчас ведет объект.", "Карточка объекта", "owner/editor", "нет", "Может меняться без смены владельца H3DID."],
      ["FIELD", "collectionIds[]", "Коллекции, в которые входит объект.", "Каталог / админка", "owner/editor", "нет", "Один объект может быть в нескольких коллекциях."],
      ["FIELD", "primaryTwinId", "Основной цифровой двойник для публичного просмотра.", "Карточка объекта", "owner/editor", "нет", "Например главный PlayCanvas или Geoscan viewer."],
      ["FIELD", "primaryPreviewAssetId", "Preview/thumbnail для каталога.", "Каталог", "owner/editor", "GET storage preview", "Сайт может хранить ссылку на h3druAssetId превью."],
      ["FIELD", "visibility", "Видимость объекта.", "Публикация", "owner/moderator", "нет", "private, organization, password, public."],
      ["FIELD", "createdAt / updatedAt / publishedAt", "Системные даты объекта.", "Админка", "system", "нет", "Для аудита и сортировки."],
    ],
  },
  {
    name: "Dublin Core metadata",
    description: "Простые описательные поля объекта. Удобны для каталога, обмена, импорта и базовой совместимости.",
    rows: [
      ["GET", "/site/v1/objects/{h3druObjectId}/metadata/dublin-core", "Получить Dublin Core поля объекта.", "Форма описания / каталог", "owner/editor/moderator/admin", "нет", "Для базового описания и публикации."],
      ["PUT", "/site/v1/objects/{h3druObjectId}/metadata/dublin-core", "Сохранить Dublin Core профиль целиком.", "Форма описания", "owner/editor/admin", "нет", "Полная замена DC-полей."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/metadata/dublin-core", "Частично обновить Dublin Core поля.", "Форма описания", "owner/editor/admin", "нет", "Удобно для автосохранения."],
      ["FIELD", "dc:title", "Название объекта.", "Dublin Core", "owner/editor", "нет", "Может синхронизироваться с title карточки."],
      ["FIELD", "dc:creator", "Создатель объекта или цифрового ресурса.", "Dublin Core", "owner/editor", "нет", "Автор, мастер, организация, съемочная группа."],
      ["FIELD", "dc:subject", "Темы/ключевые слова.", "Dublin Core", "owner/editor", "нет", "Для поиска и фасетов."],
      ["FIELD", "dc:description", "Описание объекта.", "Dublin Core", "owner/editor", "нет", "Базовое текстовое описание."],
      ["FIELD", "dc:publisher", "Публикатор ресурса.", "Dublin Core", "owner/editor", "нет", "Обычно организация/музей или портал."],
      ["FIELD", "dc:contributor", "Участники создания/описания.", "Dublin Core", "owner/editor", "нет", "Фотограмметрист, реставратор, редактор."],
      ["FIELD", "dc:date", "Дата, связанная с объектом или ресурсом.", "Dublin Core", "owner/editor", "нет", "Дата создания, съемки, публикации."],
      ["FIELD", "dc:type", "Тип ресурса.", "Dublin Core", "owner/editor", "нет", "PhysicalObject, 3DModel, Image, Dataset."],
      ["FIELD", "dc:format", "Формат ресурса.", "Dublin Core", "owner/editor", "нет", "model/gltf-binary, image/tiff, application/zip."],
      ["FIELD", "dc:identifier", "Идентификатор ресурса.", "Dublin Core", "owner/editor", "нет", "H3DID и/или внешний идентификатор."],
      ["FIELD", "dc:source", "Источник данных.", "Dublin Core", "owner/editor", "нет", "Архив, фонд, исходная съемка, Geoscan Cloud."],
      ["FIELD", "dc:language", "Язык описания.", "Dublin Core", "owner/editor", "нет", "ru, en и т.д."],
      ["FIELD", "dc:relation", "Связанные ресурсы.", "Dublin Core", "owner/editor", "нет", "Связь с коллекцией, объектом, публикацией."],
      ["FIELD", "dc:coverage", "Пространственный/временной охват.", "Dublin Core", "owner/editor", "нет", "Место, период, территория."],
      ["FIELD", "dc:rights", "Права и лицензия.", "Dublin Core", "owner/editor", "нет", "Публичные права, ограничения, лицензия."],
    ],
  },
  {
    name: "CIDOC CRM metadata",
    description: "Семантическая модель культурного объекта: классы CIDOC CRM, места, события, акторы, идентификаторы и связи.",
    rows: [
      ["GET", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm", "Получить CIDOC CRM модель объекта.", "Расширенная форма описания", "owner/editor/moderator/admin", "нет", "Для музейной/научной семантики."],
      ["PUT", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm", "Сохранить CIDOC CRM модель целиком.", "Расширенная форма описания", "owner/editor/admin", "нет", "Полная замена CRM-графа/профиля."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm", "Частично обновить CIDOC CRM модель.", "Расширенная форма описания", "owner/editor/admin", "нет", "Удобно для добавления событий/связей."],
      ["GET", "/site/v1/metadata-profiles", "Получить доступные профили описания.", "Настройки формы", "user/editor/admin", "нет", "Например okn, museum-object, archaeology, gigapixel."],
      ["GET", "/site/v1/metadata-profiles/{profileId}", "Получить схему полей конкретного профиля.", "Настройки формы", "user/editor/admin", "нет", "Схема для генерации формы."],
      ["FIELD", "crmClass", "Основной CIDOC CRM класс объекта.", "CIDOC CRM", "owner/editor", "нет", "Например E22 Human-Made Object, E27 Site, E24 Physical Human-Made Thing."],
      ["FIELD", "E42 Identifier", "CIDOC-класс для идентификаторов объекта.", "CIDOC CRM", "owner/editor", "нет", "Не дубль H3DID. H3DID хранится как главный системный ID портала и может быть представлен в CIDOC как один из E42 Identifier вместе с КАМИС, Госкаталог, ЕГРОКН, инвентарным номером."],
      ["FIELD", "E55 Type", "Тип/классификация объекта.", "CIDOC CRM", "owner/editor", "нет", "ОКН, музейный предмет, архитектурный элемент, 3D модель."],
      ["FIELD", "E53 Place", "Место объекта.", "CIDOC CRM", "owner/editor", "нет", "Адрес, координаты, историческое место."],
      ["FIELD", "E52 Time-Span", "Временной интервал.", "CIDOC CRM", "owner/editor", "нет", "Период создания, бытования, съемки."],
      ["FIELD", "E39 Actor", "Участник/актор.", "CIDOC CRM", "owner/editor", "нет", "Автор, владелец, хранитель, организация."],
      ["FIELD", "E40 Legal Body", "Юридическое лицо.", "CIDOC CRM", "owner/editor", "нет", "Музей, учреждение, владелец."],
      ["FIELD", "E12 Production", "Событие создания.", "CIDOC CRM", "owner/editor", "нет", "Кто/когда/где создал объект."],
      ["FIELD", "E7 Activity", "Деятельность/событие.", "CIDOC CRM", "owner/editor", "нет", "Оцифровка, съемка, реставрация, обследование."],
      ["FIELD", "E31 Document", "Документ/описание.", "CIDOC CRM", "owner/editor", "нет", "Акт, паспорт объекта, публикация, отчет."],
      ["FIELD", "P-связи", "CIDOC CRM predicates.", "CIDOC CRM", "owner/editor", "нет", "Например P1 is identified by, P2 has type, P53 has former/current location."],
    ],
  },
  {
    name: "Справочники стандартов metadata",
    description: "Полные стандарты не нужно переписывать как плоскую карточку объекта. API должен отдавать справочники терминов, классов и свойств, а профиль объекта выбирает нужное под конкретный тип объекта.",
    rows: [
      ["GET", "/site/v1/metadata-standards", "Получить список поддерживаемых стандартов metadata.", "Настройки / документация", "anonymous/user", "нет", "Например dublin-core, cidoc-crm."],
      ["GET", "/site/v1/metadata-standards/dublin-core/terms", "Получить полный справочник Dublin Core terms.", "Конструктор формы / интеграция", "anonymous/user", "нет", "Не только 15 базовых элементов, но и расширенные DCMI terms, если включены в профиль."],
      ["GET", "/site/v1/metadata-standards/dublin-core/terms/{termId}", "Получить описание конкретного Dublin Core term.", "Конструктор формы / подсказка", "anonymous/user", "нет", "Например dc:title, dcterms:created, dcterms:spatial."],
      ["GET", "/site/v1/metadata-standards/cidoc-crm/classes", "Получить полный справочник классов CIDOC CRM.", "Конструктор формы / граф", "anonymous/user", "нет", "E-сущности: E22, E27, E39, E53 и остальные из версии стандарта."],
      ["GET", "/site/v1/metadata-standards/cidoc-crm/classes/{classId}", "Получить описание класса CIDOC CRM.", "Конструктор формы / подсказка", "anonymous/user", "нет", "Например E22 Human-Made Object или E53 Place."],
      ["GET", "/site/v1/metadata-standards/cidoc-crm/properties", "Получить полный справочник свойств CIDOC CRM.", "Конструктор формы / граф", "anonymous/user", "нет", "P-свойства: P1, P2, P53 и остальные из версии стандарта."],
      ["GET", "/site/v1/metadata-standards/cidoc-crm/properties/{propertyId}", "Получить описание свойства CIDOC CRM.", "Конструктор формы / подсказка", "anonymous/user", "нет", "Например P1 is identified by."],
      ["GET", "/site/v1/metadata-profiles/{profileId}/fields", "Получить поля стандарта, включенные в конкретный профиль портала.", "Форма описания", "user/editor/admin", "нет", "Профиль выбирает subset стандартов под ОКН, музейный предмет, археологию, gigapixel."],
      ["FIELD", "MetadataStandardTerm", "Термин справочника metadata.", "Schema", "system", "нет", "{ standard, id, label, description, type, uri, version }."],
      ["FIELD", "MetadataProfileField", "Поле профиля портала.", "Schema", "system", "нет", "{ profileId, fieldId, standard, required, repeatable, uiWidget, validation }."],
    ],
  },
  {
    name: "Метаданные: отдельные поля и граф",
    description: "Точечный доступ нужен, чтобы фронт или интеграция могли читать/обновлять одно поле без загрузки всего профиля. Dublin Core удобно читать как поля, CIDOC CRM дополнительно как граф nodes/relations.",
    rows: [
      ["GET", "/site/v1/objects/{h3druObjectId}/metadata/dublin-core/{field}", "Получить одно поле Dublin Core.", "Форма описания / интеграция", "owner/editor/moderator/admin", "нет", "Например field=dc:title или dc:rights."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/metadata/dublin-core/{field}", "Обновить одно поле Dublin Core.", "Форма описания", "owner/editor/admin", "нет", "Для автосохранения одного поля."],
      ["DELETE", "/site/v1/objects/{h3druObjectId}/metadata/dublin-core/{field}", "Очистить одно поле Dublin Core.", "Форма описания", "owner/editor/admin", "нет", "Удаляет значение поля, не объект."],
      ["GET", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/{field}", "Получить один CIDOC CRM блок/класс.", "Расширенная форма описания", "owner/editor/moderator/admin", "нет", "Например field=E53%20Place или E42%20Identifier."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/{field}", "Обновить один CIDOC CRM блок/класс.", "Расширенная форма описания", "owner/editor/admin", "нет", "Подходит для простого профиля, где CRM разложен по блокам."],
      ["GET", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/nodes", "Получить CIDOC CRM сущности графа.", "CIDOC CRM граф", "owner/editor/moderator/admin", "нет", "Узлы: объект, место, актор, событие, документ."],
      ["POST", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/nodes", "Добавить CIDOC CRM сущность.", "CIDOC CRM граф", "owner/editor/admin", "нет", "Например добавить E39 Actor или E53 Place."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/nodes/{nodeId}", "Обновить CIDOC CRM сущность.", "CIDOC CRM граф", "owner/editor/admin", "нет", "Меняет данные конкретного узла."],
      ["DELETE", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/nodes/{nodeId}", "Удалить CIDOC CRM сущность.", "CIDOC CRM граф", "owner/editor/admin", "нет", "Должно проверять связанные relations."],
      ["GET", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/relations", "Получить CIDOC CRM связи графа.", "CIDOC CRM граф", "owner/editor/moderator/admin", "нет", "Связи P1, P2, P53 и другие predicates."],
      ["POST", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/relations", "Добавить CIDOC CRM связь.", "CIDOC CRM граф", "owner/editor/admin", "нет", "Связывает sourceNodeId -> predicate -> targetNodeId."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/relations/{relationId}", "Обновить CIDOC CRM связь.", "CIDOC CRM граф", "owner/editor/admin", "нет", "Меняет predicate или target/source при необходимости."],
      ["DELETE", "/site/v1/objects/{h3druObjectId}/metadata/cidoc-crm/relations/{relationId}", "Удалить CIDOC CRM связь.", "CIDOC CRM граф", "owner/editor/admin", "нет", "Удаляет связь, не сами узлы."],
      ["FIELD", "MetadataFieldResponse", "Ответ для одного поля metadata.", "Schema", "system", "нет", "{ field, value, lang, standard, updatedAt, updatedBy }."],
      ["FIELD", "CidocNode", "Узел CIDOC CRM графа.", "Schema", "system", "нет", "{ nodeId, crmClass, label, properties }."],
      ["FIELD", "CidocRelation", "Связь CIDOC CRM графа.", "Schema", "system", "нет", "{ relationId, sourceNodeId, predicate, targetNodeId, properties }."],
    ],
  },
  {
    name: "Внешние идентификаторы",
    description: "Связь H3DID с ЕГРОКН, Госкаталогом, КАМИС, Геоскан Cloud и локальными системами.",
    rows: [
      ["GET", "/site/v1/objects/{h3druObjectId}/external-ids", "Получить внешние идентификаторы объекта.", "Карточка объекта", "user/editor/moderator/admin", "нет", "EGROKN, GOSKATALOG, KAMIS, GEOSCAN_CLOUD. Эти значения можно экспортировать в CIDOC как E42 Identifier с типом системы."],
      ["POST", "/site/v1/objects/{h3druObjectId}/external-ids", "Добавить внешний идентификатор.", "Редактирование связей", "owner/editor/admin", "нет", "Не передается в плеер как обязательный параметр."],
      ["PATCH", "/site/v1/objects/{h3druObjectId}/external-ids/{externalId}", "Изменить внешний идентификатор.", "Редактирование связей", "owner/editor/admin", "нет", "Например исправить URL или значение."],
      ["DELETE", "/site/v1/objects/{h3druObjectId}/external-ids/{externalId}", "Удалить внешний идентификатор.", "Редактирование связей", "owner/editor/admin", "нет", "Удаляет связь, не внешний объект."],
    ],
  },
  {
    name: "Коллекции и подколлекции",
    description: "Коллекции группируют большое количество объектов внутри организации. parentCollectionId задает дерево коллекций и не дублирует collectionId.",
    rows: [
      ["GET", "/site/v1/organizations/{organizationId}/collections", "Получить дерево коллекций организации.", "Страница музея / коллекции", "anonymous/user/editor", "нет", "Возвращает collectionId и parentCollectionId."],
      ["POST", "/site/v1/organizations/{organizationId}/collections", "Создать коллекцию или подколлекцию.", "Админка коллекций", "organization_admin/editor", "нет", "Если parentCollectionId=null, это верхний уровень."],
      ["GET", "/site/v1/collections/{collectionId}", "Получить карточку коллекции.", "Страница коллекции", "anonymous/user", "нет", "Название, описание, владелец, parentCollectionId."],
      ["PATCH", "/site/v1/collections/{collectionId}", "Обновить коллекцию.", "Админка коллекций", "organization_admin/editor", "нет", "Название, описание, порядок, slug, видимость."],
      ["DELETE", "/site/v1/collections/{collectionId}", "Удалить или скрыть коллекцию.", "Админка коллекций", "organization_admin/admin", "нет", "Не удаляет сами объекты без отдельной политики."],
      ["PATCH", "/site/v1/collections/{collectionId}/parent", "Переместить коллекцию в другое место дерева.", "Админка коллекций", "organization_admin/editor", "нет", "Меняет parentCollectionId."],
      ["GET", "/site/v1/collections/{collectionId}/objects", "Получить объекты коллекции.", "Страница коллекции", "anonymous/user", "GET preview при необходимости", "Для каталога и админки."],
      ["POST", "/site/v1/collections/{collectionId}/objects", "Добавить объект в коллекцию.", "Админка коллекции", "organization_admin/editor", "нет", "Один объект может входить в несколько коллекций."],
      ["DELETE", "/site/v1/collections/{collectionId}/objects/{h3druObjectId}", "Убрать объект из коллекции.", "Админка коллекции", "organization_admin/editor", "нет", "Удаляет связь, не объект."],
      ["GET", "/site/v1/collections/{collectionId}/thumbnail", "Получить миниатюру коллекции.", "Страница коллекции / каталог", "anonymous/user", "GET storage preview", "По умолчанию берется primary thumbnail коллекции или коллаж из объектов."],
      ["PUT", "/site/v1/collections/{collectionId}/thumbnail", "Назначить миниатюру коллекции.", "Админка коллекции", "organization_admin/editor", "опционально storage asset", "Можно выбрать h3druAssetId, загрузить отдельную обложку или использовать авто-коллаж."],
      ["POST", "/site/v1/collections/{collectionId}/thumbnail/generate", "Сгенерировать авто-миниатюру коллекции.", "Админка коллекции", "organization_admin/editor", "GET storage previews", "Аналог идеи Sketchfab collections/thumbnails: собрать популярные/главные превью объектов."],
      ["GET", "/site/v1/catalog/collections", "Публичный список коллекций.", "Публичный каталог", "anonymous/user", "нет", "Для витрины музеев и тематических подборок."],
      ["GET", "/site/v1/catalog/collections/{collectionSlugOrId}", "Публичная страница коллекции.", "Публичная коллекция", "anonymous/user", "GET preview при необходимости", "Показывает опубликованные объекты коллекции."],
      ["FIELD", "thumbnailMode", "Способ формирования миниатюры коллекции.", "Collection", "owner/editor", "нет", "manual, first_object, popular_objects, collage, organization_default."],
      ["FIELD", "thumbnailAssetId", "Ассет миниатюры коллекции.", "Collection", "owner/editor", "GET storage preview", "Может ссылаться на h3druAssetId или специально загруженную обложку."],
    ],
  },
  {
    name: "Цифровые двойники / представления",
    description: "H3DID — ID культурного объекта. twinId — внутренний ID конкретного цифрового представления: 3D, Geoscan, gigapixel 2D, point cloud, panorama.",
    rows: [
      ["POST", "/site/v1/objects/{h3druObjectId}/twins", "Создать цифровой двойник объекта.", "Страница добавления представления", "owner/editor/admin", "нет", "Выдает twinId. Это не замена H3DID, а ID конкретного представления внутри объекта."],
      ["GET", "/site/v1/objects/{h3druObjectId}/twins", "Получить список цифровых двойников объекта.", "Карточка объекта", "user/editor/moderator/admin", "нет", "Один H3DID может иметь несколько twinId."],
      ["GET", "/site/v1/twins/{twinId}", "Получить цифровой двойник.", "Страница двойника", "owner/editor/moderator/admin", "нет", "Содержит viewerType, основной asset и связь с h3druObjectId."],
      ["PATCH", "/site/v1/twins/{twinId}", "Обновить настройки цифрового двойника.", "Настройки двойника", "owner/editor/admin", "нет", "Тип viewer, основной asset, видимость."],
      ["DELETE", "/site/v1/twins/{twinId}", "Удалить или скрыть цифровой двойник.", "Настройки двойника", "owner/admin", "опционально DELETE storage assets", "Зависит от политики удаления файлов."],
    ],
  },
  {
    name: "Ассеты сайта и загрузка",
    description: "Сайт хранит h3druAssetId и связь со storageAssetId. Файл физически уходит в storage API.",
    rows: [
      ["POST", "/site/v1/twins/{twinId}/assets", "Создать запись ассета на сайте и начать загрузку.", "Страница загрузки модели", "owner/editor/admin", "POST /storage/v1/uploads", "Сайт проверяет права пользователя, затем от имени сайта получает uploadUrl. Если storage вернул quota_exceeded, сайт показывает userMessage."],
      ["GET", "/site/v1/twins/{twinId}/assets", "Получить ассеты цифрового двойника.", "Страница двойника", "owner/editor/moderator/admin", "опционально GET status", "Список web/source/texture/point cloud/gigapixel."],
      ["GET", "/site/v1/assets/{h3druAssetId}", "Получить запись ассета сайта.", "Страница ассета", "owner/editor/moderator/admin", "GET /storage/v1/assets/{storageAssetId}", "Может подтягивать технический статус."],
      ["PATCH", "/site/v1/assets/{h3druAssetId}", "Обновить настройки ассета на сайте.", "Страница ассета", "owner/editor/admin", "нет", "Название, тип, признак основного, доступность скачивания."],
      ["POST", "/site/v1/assets/{h3druAssetId}/link-storage", "Привязать storageAssetId после завершения загрузки.", "Внутренний шаг загрузки", "system/site", "после POST /storage/v1/uploads/{uploadId}/complete", "Фиксирует связь h3druAssetId -> storageAssetId."],
      ["DELETE", "/site/v1/assets/{h3druAssetId}", "Удалить ассет сайта.", "Страница ассета", "owner/admin", "DELETE /storage/v1/assets/{storageAssetId}", "Сайт решает, удалять ли физический файл."],
    ],
  },
  {
    name: "Технические данные модели",
    description: "Сайт хранит и показывает агрегированную техническую информацию о цифровом двойнике и его ассетах. Источник части данных — storage/player processing, но фронт читает их через API сайта.",
    rows: [
      ["GET", "/site/v1/twins/{twinId}/technical-info", "Получить техническую сводку цифрового двойника.", "Страница двойника / админка", "owner/editor/moderator/admin", "GET storage asset/status", "Сводка по основному asset, форматам, размерам, геометрии, обработке."],
      ["GET", "/site/v1/assets/{h3druAssetId}/technical-info", "Получить технические данные конкретного ассета.", "Страница ассета", "owner/editor/moderator/admin", "GET /storage/v1/assets/{storageAssetId}", "Файл, размер, формат, checksum, storageClass, производные файлы."],
      ["GET", "/site/v1/assets/{h3druAssetId}/processing-status", "Получить статус обработки ассета.", "Страница загрузки / админка", "owner/editor/moderator/admin", "GET /storage/v1/assets/{storageAssetId}/status", "queued, processing, validating, ready, failed, archived."],
      ["GET", "/site/v1/assets/{h3druAssetId}/derivatives", "Получить производные файлы модели.", "Страница ассета", "owner/editor/moderator/admin", "GET /storage/v1/assets/{storageAssetId}", "Например optimized glb, tiles, preview, report."],
      ["GET", "/site/v1/assets/{h3druAssetId}/download", "Получить временные ссылки на скачивание.", "Страница объекта / ассета", "owner/editor/admin или public policy", "GET /storage/v1/assets/{storageAssetId}/download-url", "Как у Sketchfab: API возвращает url, sizeBytes, expires для каждого формата."],
      ["FIELD", "uploadedAt / createdAt / updatedAt", "Даты жизненного цикла ассета.", "TechnicalInfo", "system", "нет", "Когда файл загружен, создана запись, обновлены данные."],
      ["FIELD", "processedAt / publishedAt", "Даты обработки и публикации.", "TechnicalInfo", "system/moderator", "нет", "Когда обработка завершена и когда опубликовано."],
      ["FIELD", "fileName", "Имя исходного файла.", "TechnicalInfo", "system", "нет", "Например model.glb или scan.zip."],
      ["FIELD", "fileSizeBytes", "Размер исходного файла.", "TechnicalInfo", "system", "storage", "Для интерфейса лимитов и карточки ассета."],
      ["FIELD", "sourceFormat", "Исходный формат.", "TechnicalInfo", "system", "storage", "obj, fbx, glb, e57, las, zip, tiff и т.д."],
      ["FIELD", "viewerFormat", "Формат для просмотра.", "TechnicalInfo", "system", "storage/player", "glb, gltf, tiles, dzi, iiif, geoscan_cloud_embed."],
      ["FIELD", "mimeType", "MIME type файла.", "TechnicalInfo", "system", "storage", "model/gltf-binary, image/tiff, application/zip."],
      ["FIELD", "checksum", "Контрольная сумма файла.", "TechnicalInfo", "system", "storage", "sha256 для проверки целостности."],
      ["FIELD", "storageClass", "Класс хранения.", "TechnicalInfo", "system/admin", "storage", "hot, private, archive, glacier."],
      ["FIELD", "modelSizeBytes", "Размер оптимизированной модели.", "TechnicalInfo", "system", "storage/player", "Размер файла, который реально грузит viewer."],
      ["FIELD", "textureSizeBytes", "Суммарный размер текстур.", "TechnicalInfo", "system", "storage/player", "Для оценки тяжести модели."],
      ["FIELD", "archiveSizeBytes", "Размер архивного пакета.", "TechnicalInfo", "system", "storage", "Если хранится source/archive package."],
      ["FIELD", "vertexCount", "Количество вершин.", "TechnicalInfo", "system", "processor", "Для оценки сложности 3D модели."],
      ["FIELD", "faceCount", "Количество полигонов/граней.", "TechnicalInfo", "system", "processor", "Для оценки сложности 3D модели."],
      ["FIELD", "meshCount", "Количество mesh-объектов.", "TechnicalInfo", "system", "processor", "Полезно для диагностики модели."],
      ["FIELD", "materialCount", "Количество материалов.", "TechnicalInfo", "system", "processor", "Показывается в технической карточке."],
      ["FIELD", "textureCount", "Количество текстур.", "TechnicalInfo", "system", "processor", "Показывается в технической карточке."],
      ["FIELD", "animationCount", "Количество анимаций.", "TechnicalInfo", "system", "processor", "Если модель содержит animation clips."],
      ["FIELD", "durationSeconds", "Длительность анимации/тура.", "TechnicalInfo", "system", "processor/player", "Опционально для анимированных моделей."],
      ["FIELD", "boundingBox", "Габариты модели.", "TechnicalInfo", "system", "processor/player", "{ min, max, size }."],
      ["FIELD", "processingStatus", "Текущий статус обработки.", "TechnicalInfo", "system", "storage", "upload_requested, processing, ready, failed, archived."],
      ["FIELD", "processingProgress", "Прогресс обработки.", "TechnicalInfo", "system", "storage", "0..1 или null."],
      ["FIELD", "processingMessage", "Техническое сообщение обработки.", "TechnicalInfo", "system", "storage", "Для ошибок и диагностики."],
      ["FIELD", "isDownloadable", "Можно ли скачивать asset.", "TechnicalInfo / rights", "owner/moderator", "нет", "Решает сайт по правам и публикации."],
      ["FIELD", "downloadFormats", "Доступные форматы скачивания.", "DownloadResponse", "system", "storage", "Например glb, gltf, usdz, source, textures, report."],
      ["FIELD", "download.url", "Временная ссылка скачивания.", "DownloadResponse", "system", "storage", "Не кешировать, срок действия ограничен."],
      ["FIELD", "download.sizeBytes", "Размер скачиваемого файла.", "DownloadResponse", "system", "storage", "Показывать перед скачиванием."],
      ["FIELD", "download.expires", "TTL ссылки в секундах.", "DownloadResponse", "system", "storage", "Например 300 секунд."],
      ["FIELD", "license", "Лицензия/права использования.", "TechnicalInfo / Dublin Core", "owner/editor", "нет", "Связано с dc:rights, но удобно держать в сводке."],
      ["FIELD", "visibility / accessMode", "Режим доступа.", "TechnicalInfo / rights", "owner/moderator", "нет", "public, organization, password, private, moderation."],
    ],
  },
  {
    name: "Квоты, тарифы и ошибки загрузки",
    description: "Портал показывает пользователю понятные сообщения о лимитах, но источник технической ошибки quota_exceeded — storage API.",
    rows: [
      ["GET", "/site/v1/organizations/{organizationId}/storage-usage", "Получить использование хранилища организации.", "Админка организации / загрузка", "organization_admin/editor", "GET storage usage или локальный кеш", "Показывает лимит, использовано, свободно, тариф."],
      ["GET", "/site/v1/organizations/{organizationId}/plan", "Получить тариф и лимиты организации.", "Админка организации", "organization_admin/admin", "нет", "Например base: 50 ГБ."],
      ["POST", "/site/v1/assets/{h3druAssetId}/upload-retry", "Повторить запрос uploadUrl после ошибки.", "Страница загрузки модели", "owner/editor/admin", "POST /storage/v1/uploads", "Используется после очистки места или увеличения лимита."],
      ["GET", "/site/v1/assets/{h3druAssetId}/upload-error", "Получить последнюю ошибку загрузки.", "Страница загрузки модели", "owner/editor/admin", "нет", "Хранит code, message, userMessage, details от storage."],
    ],
  },
  {
    name: "Публикация и модерация",
    description: "Статусы draft/review/published хранятся на сайте. Storage не знает роли модератора.",
    rows: [
      ["POST", "/site/v1/objects/{h3druObjectId}/submit", "Отправить объект на модерацию.", "Редактирование объекта", "owner/editor", "нет", "draft -> review."],
      ["GET", "/site/v1/moderation/tasks", "Очередь задач модерации.", "Кабинет модератора", "moderator/admin", "опционально POST /storage/v1/embed", "Для предпросмотра черновиков сайт выдает временный embedToken."],
      ["POST", "/site/v1/objects/{h3druObjectId}/approve", "Одобрить публикацию.", "Кабинет модератора", "moderator/admin", "нет", "review -> approved."],
      ["POST", "/site/v1/objects/{h3druObjectId}/reject", "Отклонить публикацию с комментарием.", "Кабинет модератора", "moderator/admin", "нет", "review -> rejected."],
      ["POST", "/site/v1/objects/{h3druObjectId}/publish", "Опубликовать объект.", "Админка публикации", "moderator/admin", "опционально POST /storage/v1/embed", "approved -> published."],
      ["POST", "/site/v1/objects/{h3druObjectId}/unpublish", "Снять объект с публикации.", "Админка публикации", "moderator/admin", "нет", "published -> draft/archived."],
    ],
  },
  {
    name: "Каталог и публичные страницы",
    description: "Публичный сайт показывает только опубликованные или разрешенные пользователю объекты.",
    rows: [
      ["GET", "/site/v1/catalog/objects", "Публичный список объектов каталога.", "Страница каталога", "anonymous/user", "GET /storage/v1/assets/{storageAssetId}/preview", "Сайт отдает title, previewUrl, тип, место, доступность viewer."],
      ["GET", "/site/v1/catalog/objects/{slugOrH3DID}", "Публичная страница объекта.", "Страница объекта", "anonymous/user", "GET preview / file-url при необходимости", "Постоянная страница, временные ссылки внутри."],
      ["GET", "/site/v1/catalog/search", "Единый поиск по объектам, коллекциям и организациям.", "Поиск", "anonymous/user", "нет", "Аналог Sketchfab /search, но источник — индекс сайта: H3DID, Dublin Core, CIDOC CRM, коллекции, организации."],
      ["GET", "/site/v1/catalog/search/objects", "Поиск только по объектам/моделям.", "Поиск / каталог объектов", "anonymous/user", "нет", "Фильтры: q, organizationId, collectionId, dc:type, dc:subject, crmClass, E55 Type, place, date, viewerType, downloadable."],
      ["GET", "/site/v1/catalog/search/collections", "Поиск только по коллекциям.", "Поиск / каталог коллекций", "anonymous/user", "нет", "Фильтры: q, organizationId, parentCollectionId, tag, createdSince, sortBy."],
      ["GET", "/site/v1/catalog/search/organizations", "Поиск по организациям/музеям.", "Поиск / каталог музеев", "anonymous/user", "нет", "Фильтры: q, city, country, organizationType, publicOnly."],
      ["GET", "/site/v1/catalog/facets", "Фасеты и фильтры каталога.", "Каталог", "anonymous/user", "нет", "Фасеты строятся из Dublin Core, CIDOC CRM, организаций, коллекций и технических полей без дублирования."],
      ["GET", "/site/v1/catalog/map", "Объекты для карты.", "Карта", "anonymous/user", "нет", "Координаты и краткие карточки."],
      ["FIELD", "search.q", "Полнотекстовый поисковый запрос.", "Search", "anonymous/user", "нет", "Ищет по title, dc:title, dc:description, dc:subject, E42 Identifier, организации, коллекции."],
      ["FIELD", "search.type", "Тип сущности для поиска.", "Search", "anonymous/user", "нет", "objects, collections, organizations или all."],
      ["FIELD", "search.dcType", "Фильтр по Dublin Core dc:type.", "Search", "anonymous/user", "нет", "Например 3DModel, Image, Dataset, PhysicalObject."],
      ["FIELD", "search.dcSubject", "Фильтр по Dublin Core dc:subject.", "Search", "anonymous/user", "нет", "Используется как основа для тегов/тем, не создаем отдельную несвязанную категорию."],
      ["FIELD", "search.crmClass", "Фильтр по CIDOC CRM классу.", "Search", "anonymous/user", "нет", "Например E22, E24, E27."],
      ["FIELD", "search.e55Type", "Фильтр по CIDOC CRM E55 Type.", "Search", "anonymous/user", "нет", "Классификация объекта, если тип задан через CIDOC."],
      ["FIELD", "search.place", "Фильтр по месту.", "Search", "anonymous/user", "нет", "Из E53 Place / dc:coverage."],
      ["FIELD", "search.dateFrom / dateTo", "Фильтр по датам.", "Search", "anonymous/user", "нет", "Из dc:date, E52 Time-Span, publishedAt."],
      ["FIELD", "search.viewerType", "Фильтр по типу представления.", "Search", "anonymous/user", "нет", "playcanvas, geoscan, gigapixel, pointcloud."],
      ["FIELD", "search.sortBy", "Сортировка поиска.", "Search", "anonymous/user", "нет", "relevance, newest, updated, popular, title."],
    ],
  },
  {
    name: "Теги, темы и категории",
    description: "Теги нужны для удобного поиска и витрин, но не должны жить отдельно от metadata. Базовая связь: tag -> dc:subject; для типологии tag/category может ссылаться на CIDOC CRM E55 Type.",
    rows: [
      ["GET", "/site/v1/tags", "Получить список тегов.", "Каталог / форма описания", "anonymous/user", "нет", "Аналог Sketchfab /tags, но теги связаны с Dublin Core/CIDOC."],
      ["POST", "/site/v1/tags", "Создать тег.", "Админка справочников", "admin/metadata_admin", "нет", "Создает управляемый словарь, а не произвольный мусор."],
      ["GET", "/site/v1/tags/{tagId}", "Получить тег.", "Каталог / форма описания", "anonymous/user", "нет", "Название, slug, язык, mapping на dc:subject или E55 Type."],
      ["PATCH", "/site/v1/tags/{tagId}", "Обновить тег.", "Админка справочников", "admin/metadata_admin", "нет", "Синонимы, переводы, связь со стандартом."],
      ["DELETE", "/site/v1/tags/{tagId}", "Удалить или скрыть тег.", "Админка справочников", "admin/metadata_admin", "нет", "Лучше soft-delete, чтобы не ломать историю."],
      ["POST", "/site/v1/objects/{h3druObjectId}/tags", "Назначить теги объекту.", "Форма описания", "owner/editor", "нет", "Пишет или синхронизирует значения с dc:subject."],
      ["DELETE", "/site/v1/objects/{h3druObjectId}/tags/{tagId}", "Убрать тег с объекта.", "Форма описания", "owner/editor", "нет", "Удаляет связь, не термин словаря."],
      ["GET", "/site/v1/categories", "Получить категории витрины.", "Каталог", "anonymous/user", "нет", "Категории являются UI-группировкой над dc:type / E55 Type, а не отдельным дублем."],
      ["GET", "/site/v1/categories/{categoryId}", "Получить категорию.", "Каталог", "anonymous/user", "нет", "Содержит mapping на metadata fields."],
      ["FIELD", "Tag.metadataMapping", "Связь тега со стандартами.", "Tag", "system", "нет", "{ standard: dublin-core|cidoc-crm, field: dc:subject|E55 Type, value }."],
      ["FIELD", "Category.metadataMapping", "Связь категории с metadata.", "Category", "system", "нет", "Категория в интерфейсе должна объясняться через Dublin Core или CIDOC."],
    ],
  },
  {
    name: "Лайки / избранное",
    description: "Для Heritage3D лучше трактовать лайки как избранное/закладки. Поддерживаем три уровня: организация, коллекция, объект.",
    rows: [
      ["GET", "/site/v1/me/favorites", "Получить избранное текущего пользователя.", "Личный кабинет", "user", "нет", "Возвращает organizations, collections, objects."],
      ["POST", "/site/v1/me/favorites/organizations/{organizationId}", "Добавить музей/организацию в избранное.", "Страница организации", "user", "нет", "Аналог follow/like для музея."],
      ["DELETE", "/site/v1/me/favorites/organizations/{organizationId}", "Убрать организацию из избранного.", "Страница организации", "user", "нет", "Удаляет только пользовательскую связь."],
      ["POST", "/site/v1/me/favorites/collections/{collectionId}", "Добавить коллекцию в избранное.", "Страница коллекции", "user", "нет", "Аналог Sketchfab likes/collections, но для музейной коллекции."],
      ["DELETE", "/site/v1/me/favorites/collections/{collectionId}", "Убрать коллекцию из избранного.", "Страница коллекции", "user", "нет", "Удаляет только пользовательскую связь."],
      ["POST", "/site/v1/me/favorites/objects/{h3druObjectId}", "Добавить объект/модель в избранное.", "Карточка объекта", "user", "нет", "Лайк модели на уровне H3DID."],
      ["DELETE", "/site/v1/me/favorites/objects/{h3druObjectId}", "Убрать объект из избранного.", "Карточка объекта", "user", "нет", "Удаляет только пользовательскую связь."],
      ["GET", "/site/v1/objects/{h3druObjectId}/favorite-stats", "Получить счетчик избранного объекта.", "Каталог / карточка объекта", "anonymous/user", "нет", "Для публичной статистики, если она нужна."],
      ["GET", "/site/v1/collections/{collectionId}/favorite-stats", "Получить счетчик избранного коллекции.", "Каталог / коллекция", "anonymous/user", "нет", "Можно скрыть в публичном UI, но оставить для сортировки popular."],
      ["GET", "/site/v1/organizations/{organizationId}/favorite-stats", "Получить счетчик избранного организации.", "Страница организации", "anonymous/user", "нет", "Похоже на follow организации."],
    ],
  },
  {
    name: "Embed и просмотр",
    description: "Сайт проверяет права пользователя, затем вызывает storage/player API от имени доверенного портала.",
    rows: [
      ["GET", "/site/v1/objects/{h3druObjectId}/embed", "Получить embed опубликованного объекта.", "Публичная страница объекта", "anonymous/user", "POST /storage/v1/embed", "GET сайта может внутри вызывать POST storage и вернуть iframeUrl, iframeHtml, query, iframe."],
      ["POST", "/site/v1/assets/{h3druAssetId}/embed", "Сформировать embed с настройками сайта.", "Страница объекта / модерация", "owner/editor/moderator/admin", "POST /storage/v1/embed", "Передает accessMode, ui, camera, tokenTtlSeconds. Для черновиков нужен короткий embedToken."],
      ["GET", "/site/v1/assets/{h3druAssetId}/poi", "Получить POI через сайт.", "Страница viewer", "anonymous/user/editor", "GET /storage/v1/assets/{storageAssetId}/poi", "Сайт может фильтровать доступ к POI."],
      ["PUT", "/site/v1/assets/{h3druAssetId}/poi", "Сохранить POI через сайт.", "Редактор POI", "owner/editor/admin", "PUT /storage/v1/assets/{storageAssetId}/poi", "Пользовательские права проверяет сайт."],
      ["GET", "/site/v1/player-messaging/protocol", "Получить описание postMessage API.", "Документация / настройка iframe", "anonymous/user", "нет", "Сами сообщения идут через window.postMessage, не HTTP."],
    ],
  },
  {
    name: "Скачивание и архив",
    description: "Сайт решает, можно ли скачать или архивировать asset; storage выдает только временную ссылку или выполняет техническое действие.",
    rows: [
      ["GET", "/site/v1/assets/{h3druAssetId}/download", "Получить временную ссылку на скачивание.", "Страница объекта / ассета", "owner/editor/admin или public policy", "GET /storage/v1/assets/{storageAssetId}/download-url", "Скачивание отдельно от просмотра."],
      ["POST", "/site/v1/assets/{h3druAssetId}/archive", "Отправить asset в архивное хранение.", "Админка ассета", "owner/admin", "POST /storage/v1/assets/{storageAssetId}/archive", "Например S3 Glacier."],
      ["POST", "/site/v1/assets/{h3druAssetId}/restore", "Восстановить asset из архива.", "Админка ассета", "owner/admin", "POST /storage/v1/assets/{storageAssetId}/restore", "Может быть не мгновенно."],
    ],
  },
  {
    name: "Организации / музеи",
    description: "Организация является владельцем H3DID и объектов. Пользователь приходит из Geoscan Login, а членство и роли внутри организации хранит Heritage3D.",
    rows: [
      ["GET", "/site/v1/organizations", "Организации пользователя.", "Личный кабинет", "user", "нет", "Для выбора владельца объекта."],
      ["POST", "/site/v1/organizations", "Создать организацию/музей.", "Админка платформы", "admin", "нет", "Обычно выполняется администратором портала."],
      ["GET", "/site/v1/organizations/{organizationId}", "Карточка организации.", "Страница музея / админка", "anonymous/user", "нет", "Название, описание, статус, публичность."],
      ["PATCH", "/site/v1/organizations/{organizationId}", "Обновить организацию.", "Админка организации", "organization_admin/admin", "нет", "Профиль музея, контакты, настройки."],
      ["GET", "/site/v1/organizations/{organizationId}/avatar", "Получить аватар/логотип организации.", "Страница музея / каталог", "anonymous/user", "GET storage preview", "Аналог Sketchfab avatars, но для музея/организации."],
      ["PUT", "/site/v1/organizations/{organizationId}/avatar", "Загрузить или назначить аватар организации.", "Админка организации", "organization_admin/admin", "POST storage upload", "Логотип, герб, фото здания или официальная обложка."],
      ["GET", "/site/v1/organizations/{organizationId}/cover", "Получить обложку организации.", "Страница музея", "anonymous/user", "GET storage preview", "Широкая обложка для страницы организации."],
      ["PUT", "/site/v1/organizations/{organizationId}/cover", "Загрузить или назначить обложку организации.", "Админка организации", "organization_admin/admin", "POST storage upload", "Отдельно от avatar, чтобы не портить логотип."],
      ["GET", "/site/v1/organizations/{organizationId}/members", "Участники организации.", "Админка организации", "organization_admin/admin", "нет", "Список пользователей и ролей."],
      ["POST", "/site/v1/organizations/{organizationId}/members", "Добавить участника.", "Админка организации", "organization_admin/admin", "нет", "Приглашение или добавление."],
      ["PATCH", "/site/v1/organizations/{organizationId}/members/{userId}", "Изменить роль участника.", "Админка организации", "organization_admin/admin", "нет", "editor/moderator/viewer и т.д."],
      ["DELETE", "/site/v1/organizations/{organizationId}/members/{userId}", "Удалить участника из организации.", "Админка организации", "organization_admin/admin", "нет", "Не удаляет учетную запись Geoscan."],
    ],
  },
  {
    name: "Статьи и подборки моделей",
    description: "Статья — отдельная редакционная страница с текстом, медиа и подборкой трехмерных моделей/цифровых двойников. Она не заменяет коллекцию: коллекция группирует объекты, статья рассказывает сюжет и вставляет выбранные объекты в нужном порядке.",
    rows: [
      ["POST", "/site/v1/articles", "Создать статью.", "Страница создания статьи", "editor/organization_admin/admin", "нет", "Черновик статьи с organizationId, title, slug, status."],
      ["GET", "/site/v1/articles", "Получить рабочий список статей.", "Админка статей", "editor/moderator/admin", "нет", "Фильтры: organizationId, status, authorId, q."],
      ["GET", "/site/v1/articles/{articleId}", "Получить статью для редактирования.", "Редактор статьи", "owner/editor/moderator/admin", "нет", "Текст, блоки, связанные модели, статусы."],
      ["PATCH", "/site/v1/articles/{articleId}", "Обновить статью.", "Редактор статьи", "owner/editor/admin", "нет", "Заголовок, текст, SEO, блоки, обложка, статус черновика."],
      ["DELETE", "/site/v1/articles/{articleId}", "Удалить или архивировать статью.", "Админка статей", "owner/admin", "нет", "Не удаляет модели и коллекции."],
      ["POST", "/site/v1/articles/{articleId}/objects", "Добавить объект/модель в статью.", "Редактор статьи", "owner/editor/admin", "нет", "Связывает articleId с h3druObjectId и задает порядок."],
      ["PATCH", "/site/v1/articles/{articleId}/objects/{h3druObjectId}", "Обновить блок модели в статье.", "Редактор статьи", "owner/editor/admin", "нет", "Порядок, подпись, выбранный twinId, режим embed, camera/poi."],
      ["DELETE", "/site/v1/articles/{articleId}/objects/{h3druObjectId}", "Убрать объект из статьи.", "Редактор статьи", "owner/editor/admin", "нет", "Удаляет связь со статьей, не сам объект."],
      ["PUT", "/site/v1/articles/{articleId}/cover", "Назначить обложку статьи.", "Редактор статьи", "owner/editor/admin", "POST storage upload или выбор preview", "Обложка может быть отдельным изображением или preview одной из моделей."],
      ["POST", "/site/v1/articles/{articleId}/submit", "Отправить статью на модерацию.", "Редактор статьи", "owner/editor", "нет", "draft -> review."],
      ["POST", "/site/v1/articles/{articleId}/publish", "Опубликовать статью.", "Модерация статей", "moderator/admin", "опционально POST /storage/v1/embed", "Перед публикацией проверяет доступность всех встроенных моделей."],
      ["GET", "/site/v1/catalog/articles", "Публичный список статей.", "Страница статей / каталог", "anonymous/user", "GET preview при необходимости", "Показывает только published."],
      ["GET", "/site/v1/catalog/articles/{slugOrArticleId}", "Публичная страница статьи.", "Страница статьи", "anonymous/user", "POST /storage/v1/embed для моделей", "Возвращает текст, блоки, список моделей и embed-данные для каждой вставки."],
      ["FIELD", "ArticleModelBlock", "Блок модели внутри статьи.", "Schema", "system", "нет", "{ h3druObjectId, twinId, caption, sortOrder, camera, poiId, embedPreset }."],
      ["FIELD", "article.status", "Статус статьи.", "Article", "editor/moderator", "нет", "draft, review, published, archived."],
    ],
  },
  {
    name: "Рабочие группы",
    description: "Рабочая группа — команда внутри организации. Она может работать с объектами, коллекциями и цифровыми двойниками, но владельцем H3DID остается организация.",
    rows: [
      ["GET", "/site/v1/organizations/{organizationId}/workgroups", "Получить рабочие группы организации.", "Админка организации", "organization_admin/editor", "нет", "Например Оцифровка 2026, Модерация, 2D-сканы."],
      ["POST", "/site/v1/organizations/{organizationId}/workgroups", "Создать рабочую группу.", "Админка организации", "organization_admin/admin", "нет", "Группа получает workgroupId."],
      ["GET", "/site/v1/workgroups/{workgroupId}", "Получить рабочую группу.", "Страница группы", "member/organization_admin", "нет", "Название, описание, организация, участники."],
      ["PATCH", "/site/v1/workgroups/{workgroupId}", "Обновить рабочую группу.", "Админка группы", "workgroup_admin/organization_admin", "нет", "Название, описание, статус."],
      ["DELETE", "/site/v1/workgroups/{workgroupId}", "Удалить или архивировать рабочую группу.", "Админка группы", "organization_admin/admin", "нет", "Не удаляет объекты."],
      ["GET", "/site/v1/workgroups/{workgroupId}/members", "Участники рабочей группы.", "Админка группы", "workgroup_admin/organization_admin", "нет", "Роли внутри группы."],
      ["POST", "/site/v1/workgroups/{workgroupId}/members", "Добавить участника в рабочую группу.", "Админка группы", "workgroup_admin/organization_admin", "нет", "Пользователь уже должен существовать в Geoscan Login."],
      ["PATCH", "/site/v1/workgroups/{workgroupId}/members/{userId}", "Изменить роль в рабочей группе.", "Админка группы", "workgroup_admin/organization_admin", "нет", "Например editor/viewer."],
      ["DELETE", "/site/v1/workgroups/{workgroupId}/members/{userId}", "Удалить участника из рабочей группы.", "Админка группы", "workgroup_admin/organization_admin", "нет", "Не удаляет из организации."],
      ["POST", "/site/v1/objects/{h3druObjectId}/assign-workgroup", "Назначить объект рабочей группе.", "Карточка объекта", "owner/editor/organization_admin", "нет", "Меняет assignedWorkgroupId."],
      ["POST", "/site/v1/twins/{twinId}/assign-workgroup", "Назначить цифровой двойник рабочей группе.", "Страница двойника", "owner/editor/organization_admin", "нет", "Если двойник ведет отдельная команда."],
    ],
  },
  {
    name: "Webhooks от storage",
    description: "Эти endpoints находятся на сайте, но вызывает их сервер хранения.",
    rows: [
      ["POST", "/site/v1/webhooks/storage/asset-status", "Принять статус обработки файла.", "Системный endpoint", "storage webhook signature", "вызывает storage", "Обновляет asset.processingStatus/storageStatus."],
      ["POST", "/site/v1/webhooks/storage/preview-ready", "Принять событие готовности preview.", "Системный endpoint", "storage webhook signature", "вызывает storage", "Обновляет previewUrl и готовность публикации."],
    ],
  },
  {
    name: "Интеграции",
    description: "Импорт и сверка данных с музейными и государственными системами.",
    rows: [
      ["POST", "/site/v1/import/kamis", "Импорт данных из КАМИС.", "Админка импорта", "admin/integration", "нет", "Создает или обновляет карточки сайта."],
      ["POST", "/site/v1/import/goskatalog", "Импорт/сверка с Госкаталогом.", "Админка импорта", "admin/integration", "нет", "Заполняет externalIds и метаданные."],
      ["POST", "/site/v1/import/egrokn", "Импорт/сверка с ЕГРОКН.", "Админка импорта", "admin/integration", "нет", "Для объектов культурного наследия."],
      ["GET", "/site/v1/integrations", "Список подключенных интеграций.", "Настройки интеграций", "admin", "нет", "Ключи, статусы, расписания."],
      ["POST", "/site/v1/integrations/{integrationId}/sync", "Запустить синхронизацию.", "Настройки интеграций", "admin", "нет", "Ручной запуск."],
    ],
  },
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("API сайта");
sheet.showGridLines = false;

const columns = ["Method", "Endpoint", "Описание", "Страница / контекст", "Auth / роли", "Связь со storage", "Комментарий"];

sheet.getRange("A1:G1").merge();
sheet.getRange("A1").values = [["API сайта Heritage3D"]];
sheet.getRange("A2:G2").merge();
sheet.getRange("A2").values = [[
  "Черновик для ТЗ портала: H3DID, карточки объектов, метаданные, права, публикация, каталог и связь с сервером хранения.",
]];
sheet.getRange("A1:G1").format = { fill: "#111827", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
sheet.getRange("A2:G2").format = { fill: "#F8FAFC", font: { color: "#475569" }, wrapText: true };

let row = 4;
const jsonRows = [];

for (const section of sections) {
  sheet.getRange(`A${row}:G${row}`).merge();
  sheet.getRange(`A${row}`).values = [[`${section.name} — ${section.description}`]];
  sheet.getRange(`A${row}:G${row}`).format = {
    fill: "#E2E8F0",
    font: { bold: true, color: "#0F172A" },
    wrapText: true,
  };
  row += 1;

  sheet.getRange(`A${row}:G${row}`).values = [columns];
  sheet.getRange(`A${row}:G${row}`).format = {
    fill: "#0F172A",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  row += 1;

  for (const item of section.rows) {
    const [method, endpoint, summary, page, auth, storage, note] = item;
    const meta = methodStyle[method] || { fill: "#94A3B8", font: "#05070A" };
    sheet.getRange(`A${row}:G${row}`).values = [[method, endpoint, summary, page, auth, storage, note]];
    sheet.getRange(`A${row}`).format = {
      fill: meta.fill,
      font: { bold: true, color: meta.font },
      wrapText: true,
    };
    sheet.getRange(`B${row}:G${row}`).format = {
      fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
      font: { color: "#0F172A" },
      wrapText: true,
    };
    sheet.getRange(`B${row}`).format = {
      fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
      font: { bold: true, color: "#0F172A" },
      wrapText: true,
    };
    jsonRows.push({ section: section.name, method, endpoint, summary, page, auth, storage, note });
    row += 1;
  }

  row += 1;
}

sheet.getRange("A:A").format.columnWidthPx = 120;
sheet.getRange("B:B").format.columnWidthPx = 360;
sheet.getRange("C:C").format.columnWidthPx = 360;
sheet.getRange("D:D").format.columnWidthPx = 250;
sheet.getRange("E:E").format.columnWidthPx = 230;
sheet.getRange("F:F").format.columnWidthPx = 330;
sheet.getRange("G:G").format.columnWidthPx = 360;
sheet.freezePanes.freezeRows(3);

await fs.mkdir("/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import", { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify({
  title: "API сайта Heritage3D",
  summary: "Черновик для ТЗ портала: H3DID, карточки объектов, метаданные, права, публикация, каталог и связь с сервером хранения.",
  rows: jsonRows,
}, null, 2));

const md = [
  "# Черновик API сайта Heritage3D",
  "",
  "Этот документ описывает примерный API **сайта / портала**, а не сервера хранения и не плеера.",
  "",
  "Сайт отвечает за `H3DID`, культурные объекты, каталог, метаданные, организации, рабочие группы, коллекции, роли, статусы публикации и связь с техническим storage API.",
  "",
  "Главная модель ID:",
  "",
  "```text",
  "H3DID / h3druObjectId -> twinId -> h3druAssetId -> storageAssetId",
  "```",
  "",
  "- `H3DID / h3druObjectId` — сквозной ID культурного объекта.",
  "- `twinId` — ID конкретного цифрового двойника/представления внутри объекта.",
  "- `h3druAssetId` — запись ассета на стороне сайта.",
  "- `storageAssetId` — технический ID файла на сервере хранения.",
  "",
  "Авторизация:",
  "",
  "```text",
  "Geoscan Login отвечает на вопрос: кто пользователь.",
  "Heritage3D отвечает на вопрос: что этому пользователю можно делать.",
  "Storage/player получает уже проверенные серверные запросы от портала.",
  "```",
  "",
  ...sections.flatMap((section, index) => [
    `## ${index + 1}. ${section.name}`,
    "",
    section.description,
    "",
    "| Method | Endpoint | Назначение | Страница / контекст | Auth / роли | Связь со storage | Комментарий |",
    "|---|---|---|---|---|---|---|",
    ...section.rows.map(([method, endpoint, summary, page, auth, storage, note]) =>
      `| \`${method}\` | \`${endpoint}\` | ${summary} | ${page} | ${auth} | ${storage} | ${note} |`
    ),
    "",
  ]),
  "## Минимальный набор для первой версии",
  "",
  "| Method | Endpoint | Зачем нужен |",
  "|---|---|---|",
  "| `GET` | `/site/v1/auth/session` | Проверить пользователя из Geoscan Login. |",
  "| `POST` | `/site/v1/objects` | Создать H3DID / культурный объект. |",
  "| `GET` | `/site/v1/objects/{h3druObjectId}` | Получить карточку объекта. |",
  "| `PATCH` | `/site/v1/objects/{h3druObjectId}` | Редактировать карточку. |",
  "| `POST` | `/site/v1/objects/{h3druObjectId}/twins` | Создать цифровой двойник. |",
  "| `POST` | `/site/v1/twins/{twinId}/assets` | Создать запись файла на сайте и запросить uploadUrl через storage. |",
  "| `POST` | `/site/v1/assets/{h3druAssetId}/link-storage` | Привязать `storageAssetId`. |",
  "| `GET` | `/site/v1/organizations/{organizationId}/storage-usage` | Показать лимит и использование хранилища. |",
  "| `POST` | `/site/v1/assets/{h3druAssetId}/embed` | Получить embed через storage API. |",
  "| `GET` | `/site/v1/catalog/objects` | Публичный каталог. |",
  "| `GET` | `/site/v1/catalog/collections` | Публичные коллекции. |",
  "| `POST` | `/site/v1/objects/{h3druObjectId}/publish` | Публикация объекта. |",
  "| `POST` | `/site/v1/webhooks/storage/asset-status` | Обновление статуса после обработки файла. |",
  "",
  "## Правило разделения",
  "",
  "```text",
  "API сайта = H3DID, карточка, каталог, коллекции, организации, рабочие группы, права, публикация.",
  "API storage/player = storageAssetId, файлы, preview, POI, embed, download, archive.",
  "Endpoint сайта может вызывать endpoint storage с другим HTTP-методом.",
  "```",
  "",
].join("\n");

await fs.writeFile(mdPath, md);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Saved ${outputPath}`);
