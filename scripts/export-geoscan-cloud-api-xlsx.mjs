import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "/Users/darnhalm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const outputPath = "/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import/Geoscan Cloud API для Heritage3D.xlsx";

const methodStyle = {
  GET: { fill: "#55A2FF", font: "#05070A" },
  POST: { fill: "#08BF7A", font: "#05070A" },
  PUT: { fill: "#F59E0B", font: "#05070A" },
  PATCH: { fill: "#A78BFA", font: "#05070A" },
  DELETE: { fill: "#F2645A", font: "#05070A" },
  COMMAND: { fill: "#7C3AED", font: "#FFFFFF" },
  EVENT: { fill: "#0EA5E9", font: "#05070A" },
  SECURITY: { fill: "#111827", font: "#FFFFFF" },
  INFO: { fill: "#64748B", font: "#FFFFFF" },
};

const groupHeadingByBlock = {
  "Команда Geoscan Cloud": "Команда Geoscan Cloud — организация Heritage3D (музей, исследовательский центр или другая организация)",
};

const workbook = Workbook.create();

function setupSheet(name, title, summary, columns, widths, options = {}) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  const lastCol = String.fromCharCode(64 + columns.length);
  const headerRow = options.compact ? 1 : 4;

  if (!options.compact) {
    sheet.getRange(`A1:${lastCol}1`).merge();
    sheet.getRange("A1").values = [[title]];
    sheet.getRange(`A2:${lastCol}2`).merge();
    sheet.getRange("A2").values = [[summary]];

    sheet.getRange(`A1:${lastCol}1`).format = {
      fill: "#111827",
      font: { bold: true, color: "#FFFFFF" },
      wrapText: true,
    };
    sheet.getRange(`A2:${lastCol}2`).format = {
      fill: "#F8FAFC",
      font: { color: "#475569" },
      wrapText: true,
    };
  }

  sheet.getRange(`A${headerRow}:${lastCol}${headerRow}`).values = [columns];
  sheet.getRange(`A${headerRow}:${lastCol}${headerRow}`).format = {
    fill: "#0F172A",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };

  widths.forEach((width, index) => {
    const col = String.fromCharCode(65 + index);
    sheet.getRange(`${col}:${col}`).format.columnWidthPx = width;
  });
  sheet.freezePanes.freezeRows(headerRow);
  return sheet;
}

function writeRows(sheet, columns, rows, options = {}) {
  let row = options.startRow || 5;
  let lastGroup = "";
  let lastSubgroup = "";
  const lastCol = String.fromCharCode(64 + columns.length);
  const groupField = options.groupField || "block";
  const subgroupField = options.subgroupField || "subgroup";
  const keyByLabel = {
    "Метод": "Method",
    "Условный эндпойнт по образцу Sketchfab": "Endpoint",
    "Аналогичный эндпойнт Sketchfab": "SketchfabAnalog",
    "Описание": "Description",
    "operationId": "OperationId",
    "Запрос": "Request",
    "Ответ": "Response",
    "Авторизация": "Auth",
    "Где предполагается использовать на heritage3d.ru": "SiteUsage",
    "Справка Geoscan Cloud": "Help",
    "Шаг": "Step",
    "Этап": "Stage",
    "Действие": "Action",
    "Результат": "Output",
    "Примечания": "Notes",
    "Сущность": "Entity",
    "Владелец": "Owner",
    "Назначение": "Purpose",
    "Ключевые поля": "KeyFields",
    "Связь": "MapsTo",
    "Статус": "Status",
    "Область": "Area",
    "Значение": "Meaning",
    "Видно пользователю": "UserVisible",
    "Следующий шаг": "Next",
    "Роль": "Role",
    "Уровень": "Scope",
    "Права": "Rights",
    "Тип": "Type",
    "Название": "Name",
    "Направление": "Direction",
    "Payload": "Payload",
    "Политика": "Policy",
    "Уровень доступа": "Уровень доступа",
    "Где применяется": "Где применяется",
    "Кто использует": "Кто использует",
    "Как передается": "Как передается",
    "Ограничения": "Ограничения",
  };

  for (const item of rows) {
    if (options.group && item[groupField] !== lastGroup) {
      sheet.getRange(`A${row}:${lastCol}${row}`).merge();
      sheet.getRange(`A${row}`).values = [[groupHeadingByBlock[item[groupField]] || item[groupField]]];
      sheet.getRange(`A${row}:${lastCol}${row}`).format = {
        fill: "#E2E8F0",
        font: { bold: true, color: "#0F172A" },
        wrapText: true,
      };
      row += 1;
      lastGroup = item[groupField];
      lastSubgroup = "";
    }

    if (options.subgroup && item[subgroupField] && item[subgroupField] !== lastSubgroup) {
      sheet.getRange(`A${row}:${lastCol}${row}`).merge();
      sheet.getRange(`A${row}`).values = [[item[subgroupField]]];
      sheet.getRange(`A${row}:${lastCol}${row}`).format = {
        fill: "#F8FAFC",
        font: { bold: true, italic: true, color: "#475569" },
        wrapText: true,
      };
      row += 1;
      lastSubgroup = item[subgroupField];
    }

    sheet.getRange(`A${row}:${lastCol}${row}`).values = [
      columns.map((column) => item[column] ?? item[keyByLabel[column]] ?? ""),
    ];
    const sketchfabColumn = columns.indexOf("Аналогичный эндпойнт Sketchfab");
    if (sketchfabColumn >= 0 && item.SketchfabAnalogUrl) {
      const col = String.fromCharCode(65 + sketchfabColumn);
      const url = item.SketchfabAnalogUrl.replaceAll('"', '""');
      const label = item.SketchfabAnalog.replaceAll('"', '""');
      sheet.getRange(`${col}${row}`).formulas = [[`=HYPERLINK("${url}","${label}")`]];
    }

    const method = item.Method || item.Type || item.Kind || "INFO";
    const style = methodStyle[method] || methodStyle.INFO;
    sheet.getRange(`A${row}`).format = {
      fill: style.fill,
      font: { bold: true, color: style.font },
      wrapText: true,
    };
    if (columns.length > 1) {
      sheet.getRange(`B${row}:${lastCol}${row}`).format = {
        fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
        font: { color: "#0F172A" },
        wrapText: true,
      };
    }
    row += 1;
  }
  return row - 1;
}

const endpoints = [
  { block: "Справочники и лимиты, которые должны выдаваться пользователю в ЛК на сайте", Method: "GET", Endpoint: "/geoscan/v1/reference/supported-upload-formats", Description: "Получить актуальный справочник поддерживаемых типов данных, расширений файлов и требований к загрузке. В текущем интерфейсе Geoscan Cloud указаны: облако точек — .zip, .3tz, .obj, .ply, .las, .laz, .e57, .pts, .ptx, .pcd; тайловая модель — .zip, .3tz; растровая карта и ЦММ — .tif, .tiff, .geotiff; модель — .obj, .3ds, .ctm, .dae, .ply, .glb, .stl, .abc, .fbx, .dxf, .u3d, .osgb, .osgt; векторный слой — Shapefile .zip, .dxf, .dgn, .geojson, .gml, .gpkg. Список должен возвращаться динамически, чтобы новые форматы не требовали доработки портала. Поддержка 2D-сканов и панорам 360° — в перспективе развития.", OperationId: "getSupportedUploadFormats", Request: "нет", Response: "SupportedUploadFormats", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Upload-data" },
  { block: "Справочники и лимиты, которые должны выдаваться пользователю в ЛК на сайте", Method: "GET", Endpoint: "/geoscan/v1/reference/coordinate-systems?query={query}&limit=50", Description: "Получить справочник CRS / систем координат и поиск по EPSG-коду или названию.", OperationId: "searchCoordinateSystems", Request: "query, limit", Response: "CoordinateSystemList", Auth: "userBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/373/cat/181/kak-rabotat-s-veb-prosmotrschikom#Change-coordinate-system" },
  { block: "Справочники и лимиты, которые должны выдаваться пользователю в ЛК на сайте", Method: "GET", Endpoint: "/geoscan/v1/teams/{teamId}/usage", Description: "Получить тариф, хранилище, месячные лимиты и остатки команды Geoscan Cloud, доступной пользователю по Geoscan ID / пользовательскому токену.", OperationId: "getTeamUsage", Request: "teamId", Response: "TeamUsage", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team" },

  { block: "Диск и система организации файлов на сервере", subgroup: "Диски пользователя и команды", Method: "GET", Endpoint: "/geoscan/v1/users/{geoscanUserId}/drive/items?parentId={parentId}&query={query}&sort={sort}", Description: "Получить элементы личного диска пользователя Geoscan ID: папки, подпапки, объекты и проекты. На сайте папки могут отображаться как каталоги или коллекции.", OperationId: "listUserDriveItems", Request: "geoscanUserId, parentId, query, sort", Response: "DriveItemList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Диски пользователя и команды", Method: "GET", Endpoint: "/geoscan/v1/teams/{teamId}/drive/items?parentId={parentId}&query={query}&sort={sort}", Description: "Получить элементы диска команды Geoscan Cloud: папки, подпапки, объекты и проекты. Для корпоративного сценария команда может соответствовать организации или музею на портале.", OperationId: "listTeamDriveItems", Request: "teamId, parentId, query, sort", Response: "DriveItemList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Папка", Method: "GET", Endpoint: "/geoscan/v1/drive/folders/{folderId}", Description: "Получить сведения о папке/подпапке по folderId: название, parentFolderId, дочерние папки, объекты и проекты внутри папки, суммарный размер, preview/обложку, количество элементов, владельца user/team, права и даты изменения. На сайте эта папка отображается как каталог или коллекция.", OperationId: "getDriveFolder", Request: "folderId", Response: "DriveFolder", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Folder" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Папка", Method: "POST", Endpoint: "/geoscan/v1/drive/folders", Description: "Создать папку/подпапку на диске пользователя или команды Geoscan Cloud. На сайте такая папка может быть показана как каталог или коллекция.", OperationId: "createDriveFolder", Request: "CreateFolderRequest", Response: "DriveItem", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Create-folder" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Объект Geoscan Cloud — опциональный уровень", Method: "GET", Endpoint: "/geoscan/v1/drive/objects/{objectId}", Description: "Получить сведения об объекте Geoscan Cloud (в справке также называется участком). Это опциональный технический контейнер для нескольких самостоятельных проектов одной территории или культурного объекта, обычно за разные даты съемки. Он не является обязательным аналогом H3D_ID или TW_ID на портале.", OperationId: "getDriveObject", Request: "objectId", Response: "DriveObject", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Site" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Объект Geoscan Cloud — опциональный уровень", Method: "POST", Endpoint: "/geoscan/v1/drive/objects", Description: "Создать опциональный объект Geoscan Cloud (участок) внутри выбранной папки. Использовать только когда нужно объединить несколько самостоятельных проектов одной территории или культурного объекта. Версии сканирования до и после реставрации по умолчанию следует хранить слоями внутри одного проекта.", OperationId: "createDriveObject", Request: "CreateObjectRequest", Response: "DriveItem", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Create-site" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Объект Geoscan Cloud — опциональный уровень", Method: "GET", Endpoint: "/geoscan/v1/drive/objects/{objectId}/projects?sort=surveyDate", Description: "Получить самостоятельные проекты внутри опционального объекта Geoscan Cloud, включая дату съемки каждого проекта. Используется для отдельных проектов одной территории, когда хранение версий слоями одного проекта неудобно или невозможно.", OperationId: "listDriveObjectProjects", Request: "objectId, sort", Response: "DriveProjectList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Projects-page" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Проект", Method: "POST", Endpoint: "/geoscan/v1/drive/projects", Description: "Создать проект в выбранной папке или опциональном объекте. При создании модели из каталога/коллекции heritage3d.ru backend портала передает parentFolderId папки Geoscan Cloud, связанной с выбранной коллекцией. collectionId остается внутренним ID Heritage3D и не передается вместо folderId. Созданный проект открывается во встроенном редакторе; внутри проекта находятся группы и слои/наборы данных. До публикации проект может считаться черновиком на стороне Heritage3D без отдельного типа временного проекта в Geoscan Cloud.", OperationId: "createDriveProject", Request: "parentFolderId, objectId?, name", Response: "DriveItem", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Create-project" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Проект", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}", Description: "Получить сведения о проекте: название, родительский folderId, опциональный objectId, дата съемки, preview, размер, состояние публикации и список доступных действий. Проект привязывается к TW_ID. Версии, например сканирование до и после реставрации, по умолчанию представлены слоями проекта. По назначению соответствует GET /v3/models/{uid} в Sketchfab Data API, но возвращает проект Geoscan Cloud.", OperationId: "getProject", Request: "geoscanProjectId", Response: "Project", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannymi" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Проект", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/download", Description: "Получить временные ссылки на скачивание опубликованного проекта целиком, если скачивание разрешено владельцем. Аналог GET /v3/models/{uid}/download в Sketchfab Download API: url, size, expires; ссылку нельзя кешировать.", OperationId: "getProjectDownloadUrl", Request: "geoscanProjectId, format?", Response: "DownloadUrlResponse", Auth: "userBearerAuth | serviceBearerAuth", Priority: "Should" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Общие операции с элементами диска", Method: "GET", Endpoint: "/geoscan/v1/drive/items/{driveItemId}", Description: "Получить метаданные элемента диска: тип folder/object/project, название, размер, родительская папка, даты создания/изменения, права доступа, preview и связь с проектом.", OperationId: "getDriveItem", Request: "driveItemId", Response: "DriveItem", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannymi" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Общие операции с элементами диска", Method: "PATCH", Endpoint: "/geoscan/v1/drive/items/{driveItemId}", Description: "При необходимости изменить пользовательские свойства папки, объекта или проекта: название, родительскую папку, preview/обложку и дату съемки проекта. Привязки H3D_ID/TW_ID портал хранит у себя.", OperationId: "updateDriveItem", Request: "UpdateDriveItemRequest", Response: "DriveItem", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Общие операции с элементами диска", Method: "DELETE", Endpoint: "/geoscan/v1/drive/items/{driveItemId}", Description: "Удалить элемент диска с учетом вложенных элементов и прав.", OperationId: "deleteDriveItem", Request: "driveItemId", Response: "202 | Operation", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Слой / набор данных проекта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/datasets", Description: "Получить список наборов данных внутри проекта. В рабочей области редактора они отображаются как слои. Это основной уровень для версий одной цифровой модели, например сканирования до и после реставрации. Каждый набор данных должен возвращать datasetId, название, дату съемки/версии, тип/формат данных, размер, CRS/систему координат, видимость, группу и связь с TW_ID_Layer.", OperationId: "listProjectDatasets", Request: "geoscanProjectId", Response: "ProjectDatasetList", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Dataset" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Слой / набор данных проекта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/datasets/{datasetId}", Description: "Получить подробные данные слоя/набора данных из проекта: размер исходного файла, формат, CRS, CRS тайлов/публикации, размер набора тайлов, preview, видимость и параметры отображения.", OperationId: "getProjectDataset", Request: "geoscanProjectId, datasetId", Response: "ProjectDataset", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/375/cat/181/kak-nastroit-vizualizaciju-geoprostranstvennih-dannih" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Слой / набор данных проекта", Method: "POST", Endpoint: "/geoscan/v1/projects/{sourceProjectId}/datasets/{datasetId}/transfer", Description: "Системная операция: перенести, скопировать или связать слой/набор данных с другим проектом. Нужны sourceProjectId, targetProjectId, режим move/copy/link и сохранение технических данных слоя.", OperationId: "transferProjectDataset", Request: "TransferDatasetRequest", Response: "ProjectDataset", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Слой / набор данных проекта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/datasets/{datasetId}/download-formats", Description: "Получить доступные форматы скачивания слоя/набора данных: source, glb/gltf, tileset, textures, usdz или другие варианты, если они доступны.", OperationId: "listDatasetDownloadFormats", Request: "geoscanProjectId, datasetId", Response: "DownloadFormatList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Download-dataset" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Слой / набор данных проекта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/datasets/{datasetId}/download", Description: "Получить временные ссылки на скачивание слоя/набора данных по форматам. Как в Sketchfab Download API: url, sizeBytes, expires; ссылку нельзя кешировать.", OperationId: "getDatasetDownloadUrl", Request: "geoscanProjectId, datasetId, format?", Response: "DownloadUrlResponse", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/371/cat/181/kak-upravljat-svoimi-dannimi#Download-dataset" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Массовые операции по уровням и контейнерам", Method: "POST", Endpoint: "/geoscan/v1/teams/{teamId}/drive/items/bulk-action", Description: "Выполнить массовое действие над элементами диска организации/команды: переместить, копировать, удалить, передать владельцу или опубликовать выбранные папки, объекты и проекты. Выбор задается списком driveItemIds или фильтром по типу ресурса, папке, дате съемки и состоянию публикации.", OperationId: "bulkActionTeamDriveItems", Request: "teamId, action, driveItemIds[] | filter, targetFolderId?, targetOwnerId?", Response: "BulkActionResult", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Массовые операции по уровням и контейнерам", Method: "POST", Endpoint: "/geoscan/v1/drive/folders/{folderId}/items/bulk-action", Description: "Выполнить массовое действие внутри папки Geoscan Cloud, которая на сайте отображается как каталог или коллекция: переместить, копировать, удалить или опубликовать вложенные папки, объекты и проекты. Можно применять действие рекурсивно к подкаталогам.", OperationId: "bulkActionFolderItems", Request: "folderId, action, driveItemIds[] | filter, recursive?, targetFolderId?", Response: "BulkActionResult", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Массовые операции по уровням и контейнерам", Method: "POST", Endpoint: "/geoscan/v1/drive/objects/{objectId}/projects/bulk-action", Description: "Выполнить массовое действие над проектами внутри объекта Geoscan Cloud: переместить, копировать, удалить, передать владельцу или опубликовать версии, выбранные по projectIds, датам съемки или состоянию публикации.", OperationId: "bulkActionObjectProjects", Request: "objectId, action, projectIds[] | filter, targetObjectId?, targetOwnerId?", Response: "BulkActionResult", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Массовые операции по уровням и контейнерам", Method: "POST", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/datasets/bulk-action", Description: "Выполнить массовое действие над слоями/наборами данных внутри проекта: показать, скрыть, удалить, перенести, копировать или связать с другим проектом. Выбор задается по datasetIds или фильтром по формату, CRS, группе или видимости.", OperationId: "bulkActionProjectDatasets", Request: "geoscanProjectId, action, datasetIds[] | filter, targetProjectId?", Response: "BulkActionResult", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Диск и система организации файлов на сервере", subgroup: "Массовые операции по уровням и контейнерам", Method: "POST", Endpoint: "/geoscan/v1/resources/bulk-action", Description: "Системная массовая операция backend Heritage3D для смешанного набора ресурсов разных уровней: folder, object, project, dataset. Используется только когда действие нельзя выразить через контейнерный запрос. TW_ID хранится на Heritage3D: backend сначала преобразует выбранные TW_ID в конкретные ID ресурсов Geoscan Cloud, затем отправляет resourceType + resourceId.", OperationId: "bulkActionResources", Request: "action, resources[{resourceType, resourceId}], target?", Response: "BulkActionResult", Auth: "serviceBearerAuth", Priority: "Should" },

  { block: "Данные сцены для сайта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/scene-units", Description: "Получить единицы измерения сцены: метры, футы, футы США или другая поддерживаемая unit-система.", OperationId: "getProjectSceneUnits", Request: "geoscanProjectId", Response: "SceneUnits", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/373/cat/181/kak-rabotat-s-veb-prosmotrschikom#Change-units-system" },
  { block: "Данные сцены для сайта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/geolocation", Description: "Получить точные или приблизительные координаты модели для карты сайта: центр, bbox/extent, CRS, точность геопривязки, страна, регион, город и признак approximate/exact.", OperationId: "getProjectGeolocation", Request: "geoscanProjectId", Response: "ProjectGeolocation", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP" },
  { block: "Данные сцены для сайта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/default-view", Description: "Получить сохраненные в редакторе стартовую камеру и preview проекта.", OperationId: "getProjectDefaultView", Request: "geoscanProjectId", Response: "DefaultView", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/373/cat/181/kak-rabotat-s-veb-prosmotrschikom#Change-default-point-of-view" },
  { block: "Данные сцены для сайта", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/preview-images", Description: "Получить набор preview/thumbnails разных размеров, созданных из сохраненного ракурса: маленькая иконка, карточка каталога, большая обложка, preview для embed.", OperationId: "listProjectPreviewImages", Request: "geoscanProjectId", Response: "PreviewImageList", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP" },

  { block: "Туры и POI", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/tours", Description: "Получить список туров проекта.", OperationId: "listProjectTours", Request: "geoscanProjectId", Response: "TourList", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/378/cat/181/kak-sozdavat-i-prosmatrivat-virtualnie-turi" },
  { block: "Туры и POI", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items", Description: "Получить список POI внутри тура: id, название, краткое описание, порядок, preview и наличие связанной области/измерения. Нужен порталу для ссылок из текста на интерактивное содержимое плеера.", OperationId: "listTourItems", Request: "geoscanProjectId, tourId", Response: "TourItemList", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/378/cat/181/kak-sozdavat-i-prosmatrivat-virtualnie-turi" },
  { block: "Туры и POI", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}", Description: "Получить конкретную точку POI из тура: название, описание/Markdown, длительность, позицию, камеру, preview и порядок в туре.", OperationId: "getTourItem", Request: "geoscanProjectId, tourId, tourItemId", Response: "TourItem", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/378/cat/181/kak-sozdavat-i-prosmatrivat-virtualnie-turi" },
  { block: "Туры и POI", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/tours/{tourId}/items/{tourItemId}/area-highlight", Description: "Получить polygon/area highlight, связанный с POI: координаты области, стиль подсветки, linkedMeasurementId и режим показа в viewer.", OperationId: "getTourItemAreaHighlight", Request: "geoscanProjectId, tourId, tourItemId", Response: "TourItemAreaHighlight", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP" },

  { block: "Измерения", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/scene-bounding-box", Description: "Получить Bounding box сцены: минимальные/максимальные координаты, примерные физические размеры по X/Y/Z и unit. Нужен heritage3d.ru, чтобы показывать габариты модели и использовать их в каталоге, карточке ассета и связанных материалах.", OperationId: "getProjectSceneBoundingBox", Request: "geoscanProjectId", Response: "SceneBoundingBox", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP" },
  { block: "Измерения", Method: "PATCH", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/scene-scale", Description: "Задать или скорректировать физический масштаб сцены с heritage3d.ru. Предпочтительный сценарий — калибровка по известному расстоянию между двумя точками модели: pointA, pointB, knownDistance и unit. Дополнительно можно предусмотреть scaleFactor для технической корректировки. После применения Geoscan Cloud должен вернуть обновленные unit, scaleFactor и Bounding box. Возможность требует отдельного согласования с разработчиками Geoscan Cloud.", OperationId: "updateProjectSceneScale", Request: "geoscanProjectId, pointA?, pointB?, knownDistance?, unit, scaleFactor?", Response: "SceneScaleCalibrationResult", Auth: "userBearerAuth | serviceBearerAuth", Priority: "Should" },
  { block: "Измерения", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/measurements", Description: "Получить сохраненные измерения проекта: линии, расстояния, полигоны, площади и связанные подписи. Нужно, чтобы текст статьи мог ссылаться на конкретный измеренный фрагмент модели.", OperationId: "listProjectMeasurements", Request: "geoscanProjectId", Response: "MeasurementList", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "Should", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/376/cat/181/kak-rabotat-s-vektornimi-slojami-i-provodit-izmerenija" },
  { block: "Измерения", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/measurements/{measurementId}", Description: "Получить конкретное сохраненное измерение/фрагмент модели по measurementId. Нужен для ссылки из текста статьи на линию, полигон, площадь или объем в плеере.", OperationId: "getProjectMeasurement", Request: "geoscanProjectId, measurementId", Response: "Measurement", Auth: "userBearerAuth | serviceBearerAuth | embedToken", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/376/cat/181/kak-rabotat-s-vektornimi-slojami-i-provodit-izmerenija" },
  { block: "Измерения", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/vector-layers/{layerId}/export.geojson", Description: "Экспортировать измерения или векторный слой в GeoJSON, чтобы портал мог хранить/показывать связанные с текстом фрагменты модели.", OperationId: "exportVectorLayerGeoJson", Request: "geoscanProjectId, layerId", Response: "GeoJSON", Auth: "userBearerAuth | serviceBearerAuth", Priority: "Could", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/376/cat/181/kak-rabotat-s-vektornimi-slojami-i-provodit-izmerenija" },

  { block: "Embed и общий доступ", Method: "POST", Endpoint: "/geoscan/v1/embed", Description: "Сформировать iframeUrl, iframeHtml, token и manifestUrl для проекта/объекта.", OperationId: "createGeoscanEmbed", Request: "GeoscanEmbedRequest", Response: "GeoscanEmbedResponse", Auth: "serviceBearerAuth | userBearerAuth", Priority: "MVP" },
  { block: "Embed и общий доступ", Method: "GET", Endpoint: "/geoscan/v1/oembed?url={url}&maxwidth={maxwidth}&maxheight={maxheight}", Description: "Получить oEmbed-совместимый ответ для публичной модели: html iframe, thumbnail_url, title, provider, width/height. Удобно для статей и внешних публикаций.", OperationId: "getGeoscanOEmbed", Request: "url, maxwidth, maxheight", Response: "OEmbedResponse", Auth: "public | embedToken", Priority: "Should" },

  { block: "Встраиваемый редактор", Method: "POST", Endpoint: "/geoscan/v1/editor-sessions", Description: "Создать короткоживущую сессию встроенного редактора Geoscan Cloud для ранее созданного geoscanProjectId. Проект уже должен находиться в папке Geoscan Cloud, связанной с выбранным каталогом/коллекцией heritage3d.ru. В ответ нужны editorUrl, editorToken, expiresAt и разрешенные инструменты.", OperationId: "createEditorSession", Request: "geoscanProjectId, allowedOrigins, allowedTools?, returnUrl?", Response: "EditorSession", Auth: "userBearerAuth | serviceBearerAuth with delegation", Priority: "MVP" },
  { block: "Встраиваемый редактор", Method: "GET", Endpoint: "/geoscan/v1/editor-sessions/{editorSessionId}", Description: "Получить статус editor session.", OperationId: "getEditorSession", Request: "editorSessionId", Response: "EditorSession", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Встраиваемый редактор", Method: "POST", Endpoint: "/geoscan/v1/editor-sessions/{editorSessionId}/save", Description: "Сохранить сцену из встроенного редактора.", OperationId: "saveEditorScene", Request: "SaveSceneRequest", Response: "SavedSceneResult", Auth: "editorSessionToken | userBearerAuth", Priority: "MVP" },
  { block: "Встраиваемый редактор", Method: "POST", Endpoint: "/geoscan/v1/editor-sessions/{editorSessionId}/publish", Description: "Опубликовать/обновить manifest, iframeUrl и preview после редактирования.", OperationId: "publishEditorScene", Request: "PublishSceneRequest", Response: "PublishResult", Auth: "editorSessionToken | userBearerAuth", Priority: "MVP" },

  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/teams/current", Description: "Получить текущую команду пользователя Geoscan Cloud. На сайте Heritage3D команда используется как техническая основа организации: музея, исследовательского центра или другого учреждения.", OperationId: "getCurrentTeam", Request: "нет", Response: "Team", Auth: "userBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/teams/{teamId}", Description: "Получить карточку команды Geoscan Cloud: название, владелец, тариф, лимиты, роль текущего пользователя, настройки, дата создания и краткая статистика участников. Heritage3D связывает teamId с карточкой организации и использует команду для общего диска, членства и облачных доступов. Внутренние роли портала Heritage3D настраиваются отдельно на сайте.", OperationId: "getTeam", Request: "teamId", Response: "Team", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/teams/{teamId}/members?query={query}&sort={sort}", Description: "Получить участников команды Geoscan Cloud.", OperationId: "listTeamMembers", Request: "teamId, query, sort", Response: "MemberList", Auth: "userBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team-Management" },
  { block: "Команда Geoscan Cloud", Method: "POST", Endpoint: "/geoscan/v1/teams/{teamId}/members/invitations", Description: "Пригласить пользователя в команду Geoscan Cloud.", OperationId: "createMemberInvitation", Request: "InvitationRequest", Response: "Invitation", Auth: "userBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Add-people-to-the-team" },
  { block: "Команда Geoscan Cloud", Method: "POST", Endpoint: "/geoscan/v1/teams/{teamId}/join-requests", Description: "Предлагаемая возможность: подать заявку на вступление в команду Geoscan Cloud от имени текущего пользователя Geoscan ID. Нужна, если пользователь сам просит доступ, а не получает приглашение от администратора.", OperationId: "createTeamJoinRequest", Request: "JoinRequestCreate", Response: "JoinRequest", Auth: "userBearerAuth", Priority: "MVP" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/teams/{teamId}/join-requests", Description: "Предлагаемая возможность: получить список заявок на вступление в команду: pending, approved, rejected, cancelled.", OperationId: "listTeamJoinRequests", Request: "teamId, status?", Response: "JoinRequestList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Команда Geoscan Cloud", Method: "POST", Endpoint: "/geoscan/v1/teams/{teamId}/join-requests/{joinRequestId}/approve", Description: "Предлагаемая возможность: одобрить заявку на вступление и назначить роль пользователя в команде.", OperationId: "approveTeamJoinRequest", Request: "ApproveJoinRequest", Response: "TeamMember", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Команда Geoscan Cloud", Method: "POST", Endpoint: "/geoscan/v1/teams/{teamId}/join-requests/{joinRequestId}/reject", Description: "Предлагаемая возможность: отклонить заявку на вступление в команду с причиной отказа.", OperationId: "rejectTeamJoinRequest", Request: "RejectJoinRequest", Response: "JoinRequest", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/reference/team-roles", Description: "Получить справочник командных ролей Geoscan Cloud: Владелец, Администратор, Участник, Внешний пользователь. Это облачные роли, а не роли портала Heritage3D.", OperationId: "listTeamRoles", Request: "нет", Response: "RoleList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team-roles" },
  { block: "Команда Geoscan Cloud", Method: "PATCH", Endpoint: "/geoscan/v1/teams/{teamId}/members/{geoscanUserId}", Description: "Изменить командную роль пользователя Geoscan Cloud: Внешний, Участник или Администратор. Роль Владельца является особой и не назначается обычным изменением роли.", OperationId: "updateTeamMemberRole", Request: "teamId, geoscanUserId, role", Response: "TeamMember", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Manage-team-roles-for-people%C2%A0" },
  { block: "Команда Geoscan Cloud", Method: "DELETE", Endpoint: "/geoscan/v1/teams/{teamId}/members/{geoscanUserId}", Description: "Удалить пользователя из команды Geoscan Cloud.", OperationId: "deleteTeamMember", Request: "teamId, geoscanUserId", Response: "204", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Remove-people-from-the-team" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/reference/catalog-roles", Description: "Получить справочник ролей каталога Geoscan Cloud: Менеджер, Редактор, Аналитик, Зритель, Без доступа. Роли назначаются для папки, объекта или проекта и наследуются вниз по иерархии.", OperationId: "listCatalogRoles", Request: "нет", Response: "RoleList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Catalog-roles" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/drive/items/{driveItemId}/access", Description: "Получить доступ пользователей к папке, объекту или проекту: командную роль, прямую роль каталога, унаследованную роль и активную роль.", OperationId: "getDriveItemAccess", Request: "driveItemId", Response: "DriveItemAccess", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Catalog-Access-Management" },
  { block: "Команда Geoscan Cloud", Method: "PUT", Endpoint: "/geoscan/v1/drive/items/{driveItemId}/access/{geoscanUserId}", Description: "Назначить или изменить прямую роль каталога пользователя для папки, объекта или проекта. Нужно учитывать наследование и ограничение: Внешнему пользователю нельзя назначить роль выше Аналитика.", OperationId: "updateDriveItemAccess", Request: "driveItemId, geoscanUserId, catalogRole", Response: "DriveItemAccess", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Manage-users'-catalog-roles%C2%A0" },
  { block: "Команда Geoscan Cloud", Method: "DELETE", Endpoint: "/geoscan/v1/drive/items/{driveItemId}/access/{geoscanUserId}", Description: "Удалить прямой доступ пользователя к папке, объекту или проекту: установить роль каталога «Без доступа».", OperationId: "deleteDriveItemAccess", Request: "driveItemId, geoscanUserId", Response: "DriveItemAccess", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Remove-users-from-the-catalog" },
  { block: "Команда Geoscan Cloud", Method: "POST", Endpoint: "/geoscan/v1/ownership-transfers", Description: "Передать папку, объект, проект или слой от одного пользователя/команды другому владельцу: sourceOwner, targetOwner, resourceType, resourceId, режим transfer/copy, проверка прав и аудит.", OperationId: "createOwnershipTransfer", Request: "OwnershipTransferRequest", Response: "OwnershipTransfer", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Команда Geoscan Cloud", Method: "GET", Endpoint: "/geoscan/v1/ownership-transfers/{transferId}", Description: "Получить статус передачи папки, объекта, проекта или слоя между пользователями/командами.", OperationId: "getOwnershipTransfer", Request: "transferId", Response: "OwnershipTransfer", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP" },
  { block: "Пользователь", Method: "GET", Endpoint: "/geoscan/v1/me", Description: "Получить профиль текущего пользователя. Название соответствует GET /v3/me в Sketchfab Data API.", OperationId: "getMe", Request: "нет", Response: "UserProfile", Auth: "userBearerAuth", Priority: "MVP" },
  { block: "Пользователь", Method: "GET", Endpoint: "/geoscan/v1/users/{geoscanUserId}", Description: "Получить открытую или разрешенную для портала информацию о пользователе по Geoscan ID: имя, email при наличии прав, статус, команды Geoscan Cloud и роли. Нужно для связывания аккаунта и назначения ролей на сайте.", OperationId: "getUserByGeoscanId", Request: "geoscanUserId", Response: "UserPublicProfile", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team" },
  { block: "Пользователь", Method: "GET", Endpoint: "/geoscan/v1/users/{geoscanUserId}/teams", Description: "Получить список команд Geoscan Cloud, в которых состоит пользователь Geoscan ID, с его ролью и доступным статусом членства.", OperationId: "listUserTeams", Request: "geoscanUserId", Response: "UserTeamList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/370/cat/181/kak-upravljat-komandoj#Team" },

  { block: "Состояние сцены и журнал событий", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/scene-status", Description: "Получить текущее состояние сцены и публикации проекта: status, stage, progress, updatedAt, lastErrorCode, lastErrorMessage и рекомендации для пользователя. Нужен для отображения статуса на Heritage3D и журналирования ошибок, включая «Insufficient resources to complete publication».", OperationId: "getProjectSceneStatus", Request: "geoscanProjectId", Response: "ProjectSceneStatus", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/379/cat/181/chasto-voznikajuschie-problemi-i-ih-reshenija#Insufficient-resources-to-complete-publication" },
  { block: "Состояние сцены и журнал событий", Method: "GET", Endpoint: "/geoscan/v1/projects/{geoscanProjectId}/events?type={type}&from={from}&limit={limit}", Description: "Получить журнал событий проекта для синхронизации с Heritage3D: обработка, публикация, ошибки, предупреждения и изменение состояния сцены. Портал сохраняет события у себя для истории обработки, диагностики и уведомлений пользователя.", OperationId: "listProjectEvents", Request: "geoscanProjectId, type?, from?, limit?", Response: "ProjectEventList", Auth: "userBearerAuth | serviceBearerAuth", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/379/cat/181/chasto-voznikajuschie-problemi-i-ih-reshenija" },

  { block: "Webhook-и", Method: "POST", Endpoint: "/geoscan/v1/webhooks/processing-status", Description: "Webhook о готовности, ошибке обработки или публикации. Нужен для автоматического уведомления пользователя с портала о завершении обработки и загрузки файла.", OperationId: "receiveProcessingStatusWebhook", Request: "ProcessingStatusWebhook", Response: "204", Auth: "webhookSignature", Priority: "MVP" },
  { block: "Webhook-и", Method: "POST", Endpoint: "/geoscan/v1/webhooks/scene-events", Description: "Webhook о событиях и ошибках сцены: projectId, eventId, eventType, status, stage, errorCode, errorMessage, occurredAt. Heritage3D принимает событие, проверяет подпись, сохраняет его в журнал сайта и при необходимости показывает пользователю уведомление.", OperationId: "receiveSceneEventWebhook", Request: "SceneEventWebhook", Response: "204", Auth: "webhookSignature", Priority: "MVP", Help: "https://geoscan.helpdeskeddy.com/ru/knowledge_base/art/379/cat/181/chasto-voznikajuschie-problemi-i-ih-reshenija" },
];

const endpointBlockOrder = [
  "Справочники и лимиты, которые должны выдаваться пользователю в ЛК на сайте",
  "Встраиваемый редактор",
  "Диск и система организации файлов на сервере",
  "Данные сцены для сайта",
  "Туры и POI",
  "Измерения",
  "Embed и общий доступ",
  "Команда Geoscan Cloud",
  "Пользователь",
  "Состояние сцены и журнал событий",
  "Webhook-и",
];

const teamSubgroupByOperationId = {
  getCurrentTeam: "Организация Heritage3D и участники",
  getTeam: "Организация Heritage3D и участники",
  listTeamMembers: "Организация Heritage3D и участники",
  createMemberInvitation: "Организация Heritage3D и участники",
  createTeamJoinRequest: "Заявки на вступление",
  listTeamJoinRequests: "Заявки на вступление",
  approveTeamJoinRequest: "Заявки на вступление",
  rejectTeamJoinRequest: "Заявки на вступление",
  listTeamRoles: "Роли команды Geoscan Cloud",
  updateTeamMemberRole: "Роли команды Geoscan Cloud",
  deleteTeamMember: "Роли команды Geoscan Cloud",
  listCatalogRoles: "Доступ к файловой иерархии",
  getDriveItemAccess: "Доступ к файловой иерархии",
  updateDriveItemAccess: "Доступ к файловой иерархии",
  deleteDriveItemAccess: "Доступ к файловой иерархии",
  createOwnershipTransfer: "Передача ресурсов",
  getOwnershipTransfer: "Передача ресурсов",
};

for (const endpoint of endpoints) {
  if (endpoint.block === "Команда Geoscan Cloud") {
    endpoint.subgroup = teamSubgroupByOperationId[endpoint.OperationId];
  }
}

const endpointBlockRank = new Map(endpointBlockOrder.map((block, index) => [block, index]));
endpoints.sort((left, right) => endpointBlockRank.get(left.block) - endpointBlockRank.get(right.block));

const sketchfabAnalogByOperationId = {
  getDriveFolder: ["Частичный аналог: GET /v3/collections/{uid}", "https://docs.sketchfab.com/data-api/v3/index.html#!/collections/get_v3_collections_uid"],
  createDriveFolder: ["Частичный аналог: POST /v3/collections", "https://docs.sketchfab.com/data-api/v3/index.html#!/collections/post_v3_collections"],
  createDriveProject: ["POST /v3/models", "https://docs.sketchfab.com/data-api/v3/index.html#!/models/post_v3_models"],
  getProject: ["GET /v3/models/{uid}", "https://docs.sketchfab.com/data-api/v3/index.html#!/models/get_v3_models_uid"],
  getProjectDownloadUrl: ["GET /v3/models/{uid}/download", "https://docs.sketchfab.com/data-api/v3/index.html#!/models/get_v3_models_uid_download"],
  getGeoscanOEmbed: ["oEmbed", "https://sketchfab.com/developers/oembed"],
  getCurrentTeam: ["Частичный аналог: GET /v3/me/orgs", "https://docs.sketchfab.com/data-api/v3/index.html#!/orgs/get_v3_me_orgs"],
  getMe: ["GET /v3/me", "https://docs.sketchfab.com/data-api/v3/index.html#!/me/get_v3_me"],
  getUserByGeoscanId: ["GET /v3/users/{uid}", "https://docs.sketchfab.com/data-api/v3/index.html#!/users/get_v3_users_uid"],
};

for (const endpoint of endpoints) {
  const analog = sketchfabAnalogByOperationId[endpoint.OperationId];
  if (analog) {
    [endpoint.SketchfabAnalog, endpoint.SketchfabAnalogUrl] = analog;
  }
}

const embedJs = [
  { Type: "COMMAND", Name: "viewer.tour.play", Direction: "site -> iframe", Payload: "{ tourId? }", Description: "Запустить текущий или указанный тур.", Policy: "tour.navigate" },
  { Type: "COMMAND", Name: "viewer.tour.pause", Direction: "site -> iframe", Payload: "{ tourId? }", Description: "Поставить тур на паузу.", Policy: "tour.navigate" },
  { Type: "COMMAND", Name: "viewer.tour.next", Direction: "site -> iframe", Payload: "{}", Description: "Перейти к следующей точке.", Policy: "tour.navigate" },
  { Type: "COMMAND", Name: "viewer.tour.openItem", Direction: "site -> iframe", Payload: "{ tourId, tourItemId }", Description: "Открыть конкретную точку тура.", Policy: "tour.navigate" },
  { Type: "COMMAND", Name: "viewer.layer.flyTo", Direction: "site -> iframe", Payload: "{ layerId, durationSeconds? }", Description: "Подлететь к слою внутри проекта.", Policy: "layer.navigate" },
  { Type: "COMMAND", Name: "viewer.layer.setVisibility", Direction: "site -> iframe", Payload: "{ layerId, visible }", Description: "Скрыть или показать слой.", Policy: "layer.visibility" },
  { Type: "COMMAND", Name: "setCameraLookAt", Direction: "site -> iframe", Payload: "{ position, target, duration? }", Description: "Установить камеру по позиции и цели. Название соответствует Sketchfab Viewer API.", Policy: "camera.control" },
  { Type: "COMMAND", Name: "getCameraLookAt", Direction: "site -> iframe", Payload: "{}", Description: "Получить текущую позицию камеры и target для сохранения ракурса. Название соответствует Sketchfab Viewer API.", Policy: "camera.read" },
  { Type: "COMMAND", Name: "getScreenShot", Direction: "site -> iframe", Payload: "{ width?, height?, mimetype? }", Description: "Сделать скриншот viewer для preview/thumbnail. Название соответствует Sketchfab Viewer API.", Policy: "preview.create" },
  { Type: "COMMAND", Name: "gotoAnnotation", Direction: "site -> iframe", Payload: "{ annotationId | index, preventCameraAnimation?, preventCameraMove? }", Description: "Открыть POI/аннотацию с управлением переходом камеры. Название соответствует Sketchfab Viewer API.", Policy: "annotation.navigate" },
  { Type: "COMMAND", Name: "showAnnotationTooltip", Direction: "site -> iframe", Payload: "{ annotationId | index }", Description: "Показать tooltip POI/аннотации. Название соответствует Sketchfab Viewer API.", Policy: "annotation.display" },
  { Type: "COMMAND", Name: "hideAnnotationTooltip", Direction: "site -> iframe", Payload: "{ annotationId | index }", Description: "Скрыть tooltip POI/аннотации. Название соответствует Sketchfab Viewer API.", Policy: "annotation.display" },
  { Type: "COMMAND", Name: "viewer.annotation.showAreaHighlight", Direction: "site -> iframe", Payload: "{ tourItemId, highlightId?, linkedMeasurementId? }", Description: "Подсветить область модели, связанную с POI или измерением; нужно для ссылок из текста на конкретный фрагмент 3D-модели.", Policy: "annotation.display" },
  { Type: "COMMAND", Name: "viewer.measure.start", Direction: "site -> iframe", Payload: "{ type? }", Description: "Включить режим измерений.", Policy: "measure" },
  { Type: "COMMAND", Name: "viewer.compare.enable", Direction: "site -> iframe", Payload: "{ left, right, splitPosition? }", Description: "Включить режим сравнения.", Policy: "compare" },
  { Type: "EVENT", Name: "viewerready", Direction: "iframe -> site", Payload: "{ capabilities }", Description: "Viewer готов принимать команды. Название соответствует Sketchfab Viewer API.", Policy: "origin check" },
  { Type: "EVENT", Name: "viewer.scene.statusChanged", Direction: "iframe -> site", Payload: "{ projectId, status, stage?, progress?, occurredAt }", Description: "Состояние сцены изменилось. Портал может обновить интерфейс и сохранить событие в журнал Heritage3D.", Policy: "origin check + log" },
  { Type: "EVENT", Name: "viewer.scene.error", Direction: "iframe -> site", Payload: "{ projectId, errorCode, errorMessage, details?, occurredAt }", Description: "Ошибка viewer или сцены. Портал сохраняет событие в журнал Heritage3D и показывает пользователю понятное уведомление.", Policy: "origin check + log" },
  { Type: "EVENT", Name: "camerastart", Direction: "iframe -> site", Payload: "{}", Description: "Камера начала движение. Название соответствует Sketchfab Viewer API.", Policy: "origin check" },
  { Type: "EVENT", Name: "camerastop", Direction: "iframe -> site", Payload: "{}", Description: "Камера остановилась; после события портал может запросить getCameraLookAt для синхронизации статьи, preview и сохранения ракурса. Название соответствует Sketchfab Viewer API.", Policy: "origin check" },
  { Type: "EVENT", Name: "annotationSelect", Direction: "iframe -> site", Payload: "{ annotationId | index }", Description: "Выбрана POI/аннотация. Название соответствует Sketchfab Viewer API.", Policy: "origin check" },
  { Type: "EVENT", Name: "viewer.tourItemChanged", Direction: "iframe -> site", Payload: "{ tourId, tourItemId, index }", Description: "Активная точка тура изменилась.", Policy: "origin check" },
  { Type: "EVENT", Name: "viewer.measurementCreated", Direction: "iframe -> site", Payload: "{ measurement }", Description: "Создано измерение.", Policy: "origin check" },
  { Type: "EVENT", Name: "viewer.compareSplitChanged", Direction: "iframe -> site", Payload: "{ splitPosition }", Description: "Изменено положение разделителя сравнения.", Policy: "origin check" },
  { Type: "SECURITY", Name: "origin + viewerPolicy", Direction: "both", Payload: "allowedOrigins, viewerPolicy.commands", Description: "Проверка доменов и разрешенных команд.", Policy: "required" },
];

const siteUsageByBlock = {
  "Справочники и лимиты, которые должны выдаваться пользователю в ЛК на сайте": "Страница добавления и редактирования модели; Админка организации / загрузка",
  "Диск и система организации файлов на сервере": "Личный кабинет / админка; Страница добавления и редактирования модели; Админка организации",
  "Данные сцены для сайта": "Публичная страница модели; Страница ассета; Раздел «Карта»; каталог/коллекция",
  "Туры и POI": "Редактор POI; Публичная страница модели; Страница статьи",
  "Измерения": "Публичная страница модели; Страница статьи; ссылки из текста на конкретные фрагменты модели; Отчеты об измерениях",
  "Embed и общий доступ": "Публичная страница модели; Страница объекта / модерация; Страница статьи",
  "Встраиваемый редактор": "Страница добавления и редактирования модели",
  "Команда Geoscan Cloud": "Админка организации Heritage3D: музей, исследовательский центр или другое учреждение; участники; общий диск; облачные доступы",
  "Пользователь": "Любая авторизованная страница; Профиль пользователя",
  "Состояние сцены и журнал событий": "Страница добавления и редактирования модели; Страница ассета; Журнал событий и уведомления пользователя",
  "Webhook-и": "Внутренний backend портала; Страница добавления и редактирования модели; Уведомления обработки",
};

for (const endpoint of endpoints) {
  endpoint.SiteUsage = siteUsageByBlock[endpoint.block] || "";
}

const authAccess = [
  {
    "Уровень доступа": "User access token",
    "Где применяется": "Действия пользователя: загрузка, редактирование, POI, туры, слои, сохранение сцены.",
    "Кто использует": "Браузер/портал от имени пользователя.",
    "Как передается": "Authorization: Bearer <geoscan_user_access_token>",
    "Ограничения": "Проверка команды, роли, project/drive/layer permissions, audit log.",
  },
  {
    "Уровень доступа": "Service token",
    "Где применяется": "Backend Heritage3D: статусы, preview, embed, синхронизация, обработка webhook.",
    "Кто использует": "Backend Heritage3D.",
    "Как передается": "Authorization: Bearer <heritage3d_service_token>",
    "Ограничения": "Client credentials, scopes, без ручного редактирования от имени пользователя.",
  },
  {
    "Уровень доступа": "Editor session token",
    "Где применяется": "Встроенный редактор Geoscan Cloud в iframe.",
    "Кто использует": "iframe editor.",
    "Как передается": "editorUrl + editorToken, короткий TTL.",
    "Ограничения": "allowedOrigins, allowedTools, tokenTtlSeconds, postMessage origin check.",
  },
  {
    "Уровень доступа": "Embed/viewer token",
    "Где применяется": "Публичный или ограниченный просмотр модели.",
    "Кто использует": "iframe viewer.",
    "Как передается": "iframeUrl / query token / embedToken.",
    "Ограничения": "Только просмотр, без редактирования и без скачивания исходников при запрете.",
  },
  {
    "Уровень доступа": "Webhook signature",
    "Где применяется": "Уведомления Geoscan Cloud в сторону Heritage3D.",
    "Кто использует": "Geoscan Cloud -> backend Heritage3D.",
    "Как передается": "HTTP signature header / shared secret.",
    "Ограничения": "Проверка подписи, timestamp, защита от повторной доставки.",
  },
];

const endpointSheet = setupSheet(
  "Эндпойнты",
  "Geoscan Cloud API для Heritage3D — реестр endpoints",
  "Проектные требования к API. URL и схемы должны быть уточнены с командой Geoscan Cloud.",
  ["Метод", "Условный эндпойнт по образцу Sketchfab", "Описание", "Авторизация", "Где предполагается использовать на heritage3d.ru", "Справка Geoscan Cloud", "Аналогичный эндпойнт Sketchfab"],
  [95, 420, 520, 240, 360, 460, 300],
  { compact: true },
);
writeRows(endpointSheet, ["Метод", "Условный эндпойнт по образцу Sketchfab", "Описание", "Авторизация", "Где предполагается использовать на heritage3d.ru", "Справка Geoscan Cloud", "Аналогичный эндпойнт Sketchfab"], endpoints, { group: true, subgroup: true, startRow: 2 });

const embedSheet = setupSheet(
  "Embed и JS",
  "Embed и JS/postMessage API",
  "Команды и события viewer нужны для связи меток, ссылок и фрагментов текста на странице сайта с управлением интерактивным содержимым в плеере: турами, POI, объектами, измерениями и сравнением.",
  ["Тип", "Название", "Направление", "Payload", "Описание", "Политика"],
  [110, 260, 150, 340, 420, 220],
);
writeRows(embedSheet, ["Тип", "Название", "Направление", "Payload", "Описание", "Политика"], embedJs);

const authSheet = setupSheet(
  "Авторизация",
  "Авторизация и подпись доступа к API",
  "Geoscan ID используется как identity provider; портал использует user token, service token, editor token, embed token и webhook signature.",
  ["Уровень доступа", "Где применяется", "Кто использует", "Как передается", "Ограничения"],
  [210, 440, 260, 340, 460],
);
writeRows(authSheet, ["Уровень доступа", "Где применяется", "Кто использует", "Как передается", "Ограничения"], authAccess);

for (const sheet of workbook.worksheets.items) {
  const used = await workbook.inspect({
    kind: "region",
    sheetId: sheet.name,
    range: "A1:H12",
    maxChars: 2000,
  });
  console.log(`INSPECT ${sheet.name}`);
  console.log(used.ndjson);
}

await fs.mkdir("/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import", { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Saved ${outputPath}`);
