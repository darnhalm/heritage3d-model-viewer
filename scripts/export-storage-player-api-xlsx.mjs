import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "/Users/darnhalm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const input = "/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import/storage-player-api-table-data.json";
const outputPath = "/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import/storage-player-api-table.xlsx";

const methodStyle = {
  GET: { label: "GET", fill: "#55A2FF", font: "#05070A" },
  POST: { label: "POST", fill: "#08BF7A", font: "#05070A" },
  PUT: { label: "PUT", fill: "#F59E0B", font: "#05070A" },
  PATCH: { label: "PATCH", fill: "#A78BFA", font: "#05070A" },
  DELETE: { label: "DELETE", fill: "#F2645A", font: "#05070A" },
  COMMAND: { label: "COMMAND", fill: "#7C3AED", font: "#FFFFFF" },
  EVENT: { label: "EVENT", fill: "#0EA5E9", font: "#05070A" },
  LEGACY: { label: "LEGACY", fill: "#64748B", font: "#FFFFFF" },
  SECURITY: { label: "SECURITY", fill: "#111827", font: "#FFFFFF" },
};

const data = JSON.parse(await fs.readFile(input, "utf8"));

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("API для Miro");
sheet.showGridLines = false;

const columns = [
  "Method",
  "Endpoint",
  "Описание",
  "operationId",
  "Параметры",
  "Request",
  "Responses",
  "Auth",
];

sheet.getRange("A1:H1").merge();
sheet.getRange("A1").values = [[data.title]];
sheet.getRange("A2:H2").merge();
sheet.getRange("A2").values = [[data.summary]];
sheet.getRange("A4:H4").values = [columns];

sheet.getRange("A1:H1").format = {
  fill: "#111827",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};
sheet.getRange("A2:H2").format = {
  fill: "#F8FAFC",
  font: { color: "#475569" },
  wrapText: true,
};
sheet.getRange("A4:H4").format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};

let row = 5;
let lastTag = "";

for (const item of data.rows) {
  if (item.tag !== lastTag) {
    sheet.getRange(`A${row}:H${row}`).merge();
    sheet.getRange(`A${row}`).values = [[`${item.tag} — ${item.tagDescription}`]];
    sheet.getRange(`A${row}:H${row}`).format = {
      fill: "#E2E8F0",
      font: { bold: true, color: "#0F172A" },
      wrapText: true,
    };
    row += 1;
    lastTag = item.tag;
  }

  const meta = methodStyle[item.method] || { label: item.method, fill: "#94A3B8", font: "#05070A" };
  sheet.getRange(`A${row}:H${row}`).values = [[
    meta.label,
    item.endpoint,
    item.summary,
    item.operationId,
    item.parameters,
    item.request,
    item.responses,
    item.auth,
  ]];

  sheet.getRange(`A${row}`).format = {
    fill: meta.fill,
    font: { bold: true, color: meta.font },
    wrapText: true,
  };
  sheet.getRange(`B${row}:H${row}`).format = {
    fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
    font: { color: "#0F172A" },
    wrapText: true,
  };
  sheet.getRange(`B${row}`).format = {
    fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
    font: { bold: true, color: "#0F172A" },
    wrapText: true,
  };

  row += 1;
}

const lastRow = row - 1;

row += 2;
sheet.getRange(`A${row}:H${row}`).merge();
sheet.getRange(`A${row}`).values = [["Embed API: параметры запроса и ответа"]];
sheet.getRange(`A${row}:H${row}`).format = {
  fill: "#111827",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};
row += 1;

sheet.getRange(`A${row}:H${row}`).merge();
sheet.getRange(`A${row}`).values = [[
  "POST /storage/v1/embed собирает готовые iframeUrl и iframeHtml. Сайт отправляет структурированные настройки, а сервер возвращает разложенный query и iframe-атрибуты, чтобы фронт не склеивал URL вручную.",
]];
sheet.getRange(`A${row}:H${row}`).format = {
  fill: "#F8FAFC",
  font: { color: "#475569" },
  wrapText: true,
};
row += 2;

sheet.getRange(`A${row}:H${row}`).values = [[
  "Блок",
  "Поле",
  "Где используется",
  "Тип / значения",
  "Пример",
  "Описание",
  "Обязательно",
  "Комментарий",
]];
sheet.getRange(`A${row}:H${row}`).format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};
row += 1;

const embedRows = [
  ["REQUEST", "storageAssetId", "body", "string", "st_01JASSET", "Технический ID файла или проекта на storage.", "да", "Главный ID для storage/player."],
  ["REQUEST", "h3druObjectId", "body", "string | null", "h3dru:object:01JOBJ...", "H3DID культурного объекта.", "нет", "Для аудита и manifest."],
  ["REQUEST", "h3druAssetId", "body", "string | null", "h3dru:asset:01JASSET", "ID ассета на стороне сайта.", "нет", "Не заменяет storageAssetId."],
  ["REQUEST", "playerType", "body", "playcanvas_3d | geoscan_cloud | gigapixel_2d", "playcanvas_3d", "Какой плеер нужно встроить.", "да", "Выбирает логику сборки URL."],
  ["REQUEST", "lang", "body -> query", "ru | en | zh", "ru", "Язык интерфейса viewer.", "нет", "В query: lang=ru."],
  ["REQUEST", "preset", "body -> query", "full | compact | minimal", "compact", "Пресет интерфейса.", "нет", "В query: ui=compact."],
  ["REQUEST", "autoplay", "body -> query", "boolean", "false", "Запускать просмотр автоматически.", "нет", "В query: autoplay=0/1."],
  ["REQUEST", "accessMode", "body", "public | restricted | moderation | password_protected", "public", "Режим доступа к embed.", "нет", "Для restricted нужен embedToken."],
  ["REQUEST", "tokenTtlSeconds", "body", "60..86400", "3600", "Срок жизни embedToken.", "нет", "Для черновиков/пароля/модерации."],
  ["REQUEST", "ui.panel", "body -> query", "boolean", "false", "Показывать боковую панель.", "нет", "В query: panel=0/1."],
  ["REQUEST", "ui.poi", "body -> query", "boolean", "true", "Показывать POI.", "нет", "В query: poi=0/1."],
  ["REQUEST", "ui.tour", "body -> query", "boolean", "true", "Навигация по точкам.", "нет", "В query: tour=0/1."],
  ["REQUEST", "ui.measure", "body -> query", "boolean", "false", "Инструменты измерений.", "нет", "В query: measure=0/1."],
  ["REQUEST", "ui.info", "body -> query", "boolean", "true", "Информационные элементы viewer.", "нет", "В query: info=0/1."],
  ["REQUEST", "ui.modelInfo", "body -> query", "boolean", "false", "Техническая информация о модели.", "нет", "В query: modelInfo=0/1."],
  ["REQUEST", "ui.controls", "body -> query", "boolean", "true", "Кнопки управления.", "нет", "В query: controls=0/1."],
  ["REQUEST", "ui.fullscreen", "body -> query", "boolean", "true", "Полноэкранный режим.", "нет", "В query: fullscreen=0/1."],
  ["REQUEST", "ui.fit", "body -> query", "boolean", "true", "Кнопка вписать модель.", "нет", "В query: fit=0/1."],
  ["REQUEST", "ui.reset", "body -> query", "boolean", "true", "Кнопка сброса камеры.", "нет", "В query: reset=0/1."],
  ["REQUEST", "camera.position", "body -> query", "number[3]", "2,2,2", "Начальная позиция камеры.", "нет", "В query: cameraPosition=x,y,z."],
  ["REQUEST", "camera.focus", "body -> query", "number[3]", "0,0,0", "Точка фокуса камеры.", "нет", "В query: cameraFocus=x,y,z."],
  ["REQUEST", "manifestUrl", "body -> query", "uri | null", "null", "Явный manifest URL.", "нет", "Если не передан, собирает сервер."],
  ["REQUEST", "assetUrl", "body -> query", "uri | null", "null", "Явный URL файла.", "нет", "Обычно сервер сам выдает signed URL."],
  ["REQUEST", "width / height", "body -> iframe", "integer", "960 / 640", "Размер iframe.", "нет", "Попадает в iframeHtml."],
  ["REQUEST", "title", "body -> iframe", "string", "3D Viewer", "Title iframe.", "нет", "Для accessibility и HTML."],
  ["REQUEST", "allowFullscreen", "body -> iframe", "boolean", "true", "Добавлять allowfullscreen.", "нет", "Атрибут iframe."],
  ["REQUEST", "referrerPolicy", "body -> iframe", "string", "strict-origin-when-cross-origin", "Политика referrer.", "нет", "Атрибут iframe."],
  ["REQUEST", "sandbox", "body -> iframe", "string[]", "allow-scripts, allow-same-origin", "Sandbox-разрешения iframe.", "нет", "Сервер может применить безопасный preset."],
  ["RESPONSE", "iframeUrl", "response", "uri", "https://player.example/viewer/?...", "Готовый URL плеера.", "да", "Сайт вставляет в src."],
  ["RESPONSE", "iframeHtml", "response", "string", "<iframe ...></iframe>", "Готовый HTML iframe.", "да", "Можно отдать в админке как embed-код."],
  ["RESPONSE", "embedToken", "response -> query", "string | null", "null", "Token просмотра.", "нет", "Для public может быть null."],
  ["RESPONSE", "tokenExpiresAt", "response", "date-time | null", "2026-05-18T12:00:00Z", "Срок действия token.", "нет", "Для restricted/moderation/password."],
  ["RESPONSE", "manifestUrl", "response -> query", "uri | null", "https://storage.example/manifest/st_01JASSET", "Manifest, переданный viewer.", "нет", "В query: manifest=..."],
  ["RESPONSE", "assetUrl", "response -> query", "uri | null", "null", "Signed URL файла, если используется.", "нет", "В query: load или assetUrl."],
  ["QUERY", "manifest", "iframeUrl query", "uri | null", "https://storage.example/manifest/st_01JASSET", "Manifest для viewer.", "нет", "Основной вариант для PlayCanvas."],
  ["QUERY", "load", "iframeUrl query", "uri | null", "null", "Прямой URL модели.", "нет", "Если viewer использует load."],
  ["QUERY", "assetUrl", "iframeUrl query", "uri | null", "null", "Альтернативный прямой URL файла.", "нет", "Если viewer использует assetUrl."],
  ["QUERY", "embed", "iframeUrl query", "'1'", "1", "Режим iframe.", "да", "Всегда embed=1."],
  ["QUERY", "ui", "iframeUrl query", "full | compact | minimal", "compact", "Пресет интерфейса.", "нет", "Из request.preset."],
  ["QUERY", "lang", "iframeUrl query", "ru | en | zh", "ru", "Язык viewer.", "нет", "Из request.lang."],
  ["QUERY", "autoplay", "iframeUrl query", "0 | 1", "0", "Автозапуск.", "нет", "Из request.autoplay."],
  ["QUERY", "panel / poi / tour / measure / info", "iframeUrl query", "0 | 1", "0 / 1", "Основные UI-флаги.", "нет", "Из request.ui."],
  ["QUERY", "modelInfo / controls / fullscreen / fit / reset", "iframeUrl query", "0 | 1", "0 / 1", "Дополнительные UI-флаги.", "нет", "Из request.ui."],
  ["QUERY", "cameraPosition", "iframeUrl query", "x,y,z | null", "2,2,2", "Начальная позиция камеры.", "нет", "Из request.camera.position."],
  ["QUERY", "cameraFocus", "iframeUrl query", "x,y,z | null", "0,0,0", "Точка фокуса камеры.", "нет", "Из request.camera.focus."],
  ["QUERY", "embedToken", "iframeUrl query", "string | null", "null", "Token просмотра.", "нет", "Передается только если нужен."],
  ["IFRAME", "src", "iframe attributes", "uri", "iframeUrl", "Адрес iframe.", "да", "Равен iframeUrl."],
  ["IFRAME", "title", "iframe attributes", "string", "3D Viewer", "Title iframe.", "да", "Из request.title."],
  ["IFRAME", "width / height", "iframe attributes", "integer", "960 / 640", "Размер iframe.", "да", "Из request width/height."],
  ["IFRAME", "allow", "iframe attributes", "string", "fullscreen; xr-spatial-tracking", "Разрешения iframe.", "нет", "Для fullscreen/XR."],
  ["IFRAME", "allowFullscreen", "iframe attributes", "boolean", "true", "Разрешить fullscreen.", "да", "Атрибут allowfullscreen."],
  ["IFRAME", "referrerPolicy", "iframe attributes", "string", "strict-origin-when-cross-origin", "Referrer policy.", "да", "Атрибут iframe."],
  ["IFRAME", "sandbox", "iframe attributes", "string[]", "allow-scripts, allow-same-origin", "Sandbox iframe.", "нет", "Безопасный preset."],
];

for (const item of embedRows) {
  const [block, field, where, type, example, description, required, comment] = item;
  const meta = methodStyle[block] || (
    block === "REQUEST" ? { label: block, fill: "#08BF7A", font: "#05070A" } :
    block === "RESPONSE" ? { label: block, fill: "#55A2FF", font: "#05070A" } :
    block === "QUERY" ? { label: block, fill: "#A78BFA", font: "#05070A" } :
    { label: block, fill: "#64748B", font: "#FFFFFF" }
  );
  sheet.getRange(`A${row}:H${row}`).values = [[
    meta.label,
    field,
    where,
    type,
    example,
    description,
    required,
    comment,
  ]];
  sheet.getRange(`A${row}`).format = {
    fill: meta.fill,
    font: { bold: true, color: meta.font },
    wrapText: true,
  };
  sheet.getRange(`B${row}:H${row}`).format = {
    fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
    font: { color: "#0F172A" },
    wrapText: true,
  };
  sheet.getRange(`B${row}`).format = {
    fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
    font: { bold: true, color: "#0F172A" },
    wrapText: true,
  };
  row += 1;
}

row += 2;
sheet.getRange(`A${row}:H${row}`).merge();
sheet.getRange(`A${row}`).values = [["postMessage API iframe-плеера"]];
sheet.getRange(`A${row}:H${row}`).format = {
  fill: "#111827",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};
row += 1;

sheet.getRange(`A${row}:H${row}`).merge();
sheet.getRange(`A${row}`).values = [[
  "Браузерный JS API для связи страницы сайта с iframe-плеером. Это не HTTP endpoints: сообщения передаются через window.postMessage. Стандартная обертка: { protocol: \"h3d.player\", version: \"1.0\", type, id, name, payload }.",
]];
sheet.getRange(`A${row}:H${row}`).format = {
  fill: "#F8FAFC",
  font: { color: "#475569" },
  wrapText: true,
};
row += 2;

sheet.getRange(`A${row}:H${row}`).values = [[
  "Тип",
  "Сообщение",
  "Краткое описание",
  "Направление",
  "Payload",
  "Ответ / событие",
  "Права / фильтр",
  "Legacy",
]];
sheet.getRange(`A${row}:H${row}`).format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};
row += 1;

const postMessageRows = [
  {
    type: "COMMAND",
    name: "player.loadManifest",
    summary: "Загрузить или заменить manifest в уже открытом iframe-плеере.",
    direction: "сайт -> iframe",
    payload: "{ manifestUrl }",
    response: "player.loaded или player.error",
    policy: "allowedOrigins + viewerPolicy.commands",
    legacy: "нет",
  },
  {
    type: "COMMAND",
    name: "poi.focus",
    summary: "Перейти к конкретной точке интереса и сфокусировать камеру.",
    direction: "сайт -> iframe",
    payload: "{ id }",
    response: "poi.selected",
    policy: "poi.navigate",
    legacy: "focus-poi / open-poi",
  },
  {
    type: "COMMAND",
    name: "poi.clear",
    summary: "Снять выбранную точку интереса.",
    direction: "сайт -> iframe",
    payload: "{}",
    response: "poi.cleared",
    policy: "poi.navigate",
    legacy: "clear-poi",
  },
  {
    type: "COMMAND",
    name: "poi.next",
    summary: "Перейти к следующей точке интереса.",
    direction: "сайт -> iframe",
    payload: "{}",
    response: "poi.selected",
    policy: "poi.navigate",
    legacy: "next-poi",
  },
  {
    type: "COMMAND",
    name: "poi.previous",
    summary: "Перейти к предыдущей точке интереса.",
    direction: "сайт -> iframe",
    payload: "{}",
    response: "poi.selected",
    policy: "poi.navigate",
    legacy: "prev-poi",
  },
  {
    type: "COMMAND",
    name: "animation.seek",
    summary: "Перейти к времени или кадру анимации.",
    direction: "сайт -> iframe",
    payload: "{ clip?, time?, frame?, fps? }",
    response: "animation.time",
    policy: "animation",
    legacy: "seek-animation",
  },
  {
    type: "COMMAND",
    name: "animation.play",
    summary: "Запустить проигрывание анимации.",
    direction: "сайт -> iframe",
    payload: "{ clip? }",
    response: "animation.time",
    policy: "animation",
    legacy: "play-animation",
  },
  {
    type: "COMMAND",
    name: "animation.pause",
    summary: "Поставить анимацию на паузу.",
    direction: "сайт -> iframe",
    payload: "{ clip? }",
    response: "animation.time",
    policy: "animation",
    legacy: "pause-animation / freeze-animation",
  },
  {
    type: "EVENT",
    name: "player.ready",
    summary: "Плеер загружен и готов принимать команды.",
    direction: "iframe -> сайт",
    payload: "{ playerId, protocolVersion, capabilities }",
    response: "нет",
    policy: "проверка event.origin на сайте",
    legacy: "нет",
  },
  {
    type: "EVENT",
    name: "player.loaded",
    summary: "Manifest/asset успешно загружен в плеере.",
    direction: "iframe -> сайт",
    payload: "{ storageAssetId?, manifestUrl? }",
    response: "нет",
    policy: "проверка event.origin на сайте",
    legacy: "нет",
  },
  {
    type: "EVENT",
    name: "player.error",
    summary: "Ошибка загрузки или выполнения команды.",
    direction: "iframe -> сайт",
    payload: "{ code, message }",
    response: "нет",
    policy: "проверка event.origin на сайте",
    legacy: "нет",
  },
  {
    type: "EVENT",
    name: "poi.selected",
    summary: "Пользователь или команда выбрали POI.",
    direction: "iframe -> сайт",
    payload: "{ id, number?, title?, description? }",
    response: "нет",
    policy: "проверка event.origin на сайте",
    legacy: "poi-selected",
  },
  {
    type: "EVENT",
    name: "poi.cleared",
    summary: "Выбор POI снят.",
    direction: "iframe -> сайт",
    payload: "{ id? }",
    response: "нет",
    policy: "проверка event.origin на сайте",
    legacy: "poi-cleared",
  },
  {
    type: "EVENT",
    name: "animation.time",
    summary: "Плеер сообщает текущую позицию анимации.",
    direction: "iframe -> сайт",
    payload: "{ clip?, time, frame? }",
    response: "нет",
    policy: "проверка event.origin на сайте",
    legacy: "animation-time",
  },
  {
    type: "SECURITY",
    name: "origin + viewerPolicy",
    summary: "Плеер принимает команды только от разрешенных доменов и только из списка разрешенных команд.",
    direction: "оба направления",
    payload: "allowedOrigins, viewerPolicy.commands, capabilities",
    response: "игнорировать запрещенную команду или вернуть player.error",
    policy: "обязательно",
    legacy: "для legacy тоже нужна проверка origin",
  },
];

for (const item of postMessageRows) {
  const meta = methodStyle[item.type];
  sheet.getRange(`A${row}:H${row}`).values = [[
    meta.label,
    item.name,
    item.summary,
    item.direction,
    item.payload,
    item.response,
    item.policy,
    item.legacy,
  ]];
  sheet.getRange(`A${row}`).format = {
    fill: meta.fill,
    font: { bold: true, color: meta.font },
    wrapText: true,
  };
  sheet.getRange(`B${row}:H${row}`).format = {
    fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
    font: { color: "#0F172A" },
    wrapText: true,
  };
  sheet.getRange(`B${row}`).format = {
    fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
    font: { bold: true, color: "#0F172A" },
    wrapText: true,
  };
  row += 1;
}

const finalRow = row - 1;

sheet.getRange("A:A").format.columnWidthPx = 130;
sheet.getRange("B:B").format.columnWidthPx = 320;
sheet.getRange("C:C").format.columnWidthPx = 330;
sheet.getRange("D:D").format.columnWidthPx = 220;
sheet.getRange("E:E").format.columnWidthPx = 220;
sheet.getRange("F:F").format.columnWidthPx = 220;
sheet.getRange("G:G").format.columnWidthPx = 420;
sheet.getRange("H:H").format.columnWidthPx = 180;

sheet.freezePanes.freezeRows(4);

const inspect = await workbook.inspect({
  kind: "region",
  sheetId: "API для Miro",
  range: `A${lastRow + 2}:H${Math.min(finalRow, lastRow + 12)}`,
  maxChars: 4000,
});
console.log(inspect.ndjson);

console.log("Preview render skipped: export target is an editable XLSX table.");

await fs.mkdir("/Users/darnhalm/Documents/CURSOR/model-viewer/docs/api/miro-import", { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Saved ${outputPath}`);
