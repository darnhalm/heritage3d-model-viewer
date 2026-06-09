const fs = require('fs');
const path = require('path');

const canvasPath = 'docs/api/obsidian/site-storage-two-canvases.canvas';
const drawioPath = 'docs/api/drawio/site-storage-two-canvases.drawio';

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#xa;');
}

const nodes = [];
const edges = [];

function node(id, text, x, y, width, height, color = '#ffffff') {
  nodes.push({ id, type: 'text', x, y, width, height, color, text });
}

function edge(id, fromNode, toNode, label, fromSide = 'right', toSide = 'left', color = '#64748b') {
  edges.push({ id, fromNode, fromSide, toNode, toSide, label, color });
}

node(
  'title',
  '# Две зоны ответственности\n\nСайт хранит смысл и H3DID. Сервер хранения/плеер хранит файлы и техническое состояние. Между ними ходят только технические API-команды.',
  -360,
  -520,
  1220,
  150,
  '#111827'
);

node(
  'site-zone',
  '# САЙТ / ПОРТАЛ 3D-НАСЛЕДИЕ\n\nИсточник истины по культурному объекту.\n\nГлавный ID: `H3DID` / `h3druObjectId`.\n\nЗдесь живут каталог, права, статусы, описания, CIDOC CRM / Dublin Core, связи с КАМИС, Госкаталогом, ЕГРОКН, организациями и пользователями.',
  -1180,
  -280,
  940,
  1320,
  '#e0f2fe'
);

node(
  'server-zone',
  '# СЕРВЕР ХРАНЕНИЯ / ПЛЕЕРЫ\n\nТехнический слой медиа.\n\nГлавный ID: `storageAssetId`.\n\nЗдесь живут файлы, S3/object storage, Glacier/архив, обработка, preview, POI JSON, signed URLs, embed iframe и webhooks.',
  760,
  -280,
  940,
  1320,
  '#dcfce7'
);

node(
  'bridge-zone',
  '# КОМАНДЫ ОБМЕНА\n\nЭто не API культурной карточки. Это контракт между порталом и сервером хранения.\n\nГруппы: Upload, Assets, Processing, Preview, POI, Download, Embed, Webhooks.',
  -140,
  -280,
  680,
  1740,
  '#f8fafc'
);

node(
  'h3did',
  '# H3DID / Cultural Object\n\n`h3druObjectId`\n\nГлавная запись объекта культуры на сайте.\n\nПример: ОКН, музейный предмет, археологический объект, 2D/3D цифровой объект.',
  -1100,
  -70,
  380,
  230,
  '#ffffff'
);

node(
  'metadata',
  '# Метаданные\n\nCIDOC CRM / Dublin Core\n\nАдрес, описание, датировки, авторы, правообладатели, внешние ID: ЕГРОКН, Госкаталог, КАМИС.',
  -680,
  -70,
  380,
  230,
  '#ffffff'
);

node(
  'twin',
  '# Digital Twin\n\n`twinId`\n\nВерсия цифрового двойника: 3D, point cloud, gigapixel 2D, панорама, Agisoft/Geoscan Cloud.',
  -1100,
  220,
  380,
  220,
  '#ffffff'
);

node(
  'portal-asset',
  '# Portal Asset\n\n`h3druAssetId`\n\nЗапись файла на сайте: к какому H3DID относится, кто владелец, можно ли публиковать и скачивать.',
  -680,
  220,
  380,
  220,
  '#ffffff'
);

node(
  'catalog',
  '# Каталог и страница объекта\n\nПоказывает название, описание, preview, кнопку просмотра, embed iframe и права доступа.',
  -1100,
  500,
  380,
  210,
  '#ffffff'
);

node(
  'policy',
  '# Права и статусы\n\n`draft`, `published`, `archived`, `password_protected`\n\nРоли портала решают, можно ли загрузить, удалить, скачать или опубликовать.',
  -680,
  500,
  380,
  210,
  '#ffffff'
);

node(
  'upload',
  '# Upload\n\n`POST /storage/v1/uploads`\n\nПолучить временную ссылку для загрузки.\n\nRequest: `CreateUploadRequest`\n\nСайт передает: `twinId`, `h3druAssetId`, organizationId, fileName, contentType, sizeBytes, kind, format.\n\nResponse: `UploadUrlResponse`.',
  -80,
  -80,
  560,
  230,
  '#dbeafe'
);

node(
  'complete',
  '# Upload Complete\n\n`POST /storage/v1/uploads/{uploadId}/complete`\n\nПодтвердить завершение загрузки.\n\nRequest: `CompleteUploadRequest`\n\nСайт подтверждает checksum и размер. Сервер создает `storageAssetId` и возвращает `StorageAsset`.',
  -80,
  180,
  560,
  210,
  '#dbeafe'
);

node(
  'status',
  '# Assets / Processing\n\n`GET /storage/v1/assets/{storageAssetId}`\n`GET /storage/v1/assets/{storageAssetId}/status`\n\nПортал получает техническую карточку файла и проверяет, готова ли модель/тайлы/preview.\n\nResponse: `StorageAsset`, `ProcessingStatus`.',
  -80,
  420,
  560,
  190,
  '#fef3c7'
);

node(
  'webhook',
  '# Webhooks\n\n`POST /storage/v1/webhooks/asset-status`\n\nСервер сам сообщает порталу: queued, uploading, processing, ready, failed, archived.\n\nAuth: `webhookSignature` / `X-H3D-Signature`.',
  -80,
  640,
  560,
  190,
  '#fef3c7'
);

node(
  'preview',
  '# Preview\n\n`GET /storage/v1/assets/{storageAssetId}/preview`\n`POST /storage/v1/assets/{storageAssetId}/preview`\n\nПолучить или сгенерировать thumbnail/poster/screenshot для каталога и карточки.',
  -80,
  860,
  560,
  170,
  '#f3e8ff'
);

node(
  'viewer',
  '# Viewer / Embed / File URL\n\n`POST /storage/v1/embed`\n`GET /storage/v1/assets/{storageAssetId}/file-url`\n\nСайт получает `iframeUrl`, `iframeHtml` или signed URL для плеера.\n\nRequest: `CreateStorageEmbedRequest`.\nResponse: `StorageEmbedResponse`.',
  -80,
  1060,
  560,
  230,
  '#ede9fe'
);

node(
  'poi-api',
  '# POI API\n\n`GET /storage/v1/assets/{storageAssetId}/poi`\n`PUT /storage/v1/assets/{storageAssetId}/poi`\n\nПолучить/сохранить точки интереса PlayCanvas.\n\nSchema: `PoiItem`, `PoiListResponse`, `UpdatePoiListRequest`.',
  -80,
  1320,
  560,
  190,
  '#dcfce7'
);

node(
  'download-api',
  '# Download / Archive / Delete\n\n`GET /storage/v1/assets/{storageAssetId}/download-url`\n`POST /storage/v1/assets/{storageAssetId}/archive`\n`POST /storage/v1/assets/{storageAssetId}/restore`\n`DELETE /storage/v1/assets/{storageAssetId}`\n\nСкачивание, ледяное хранение, восстановление и удаление.',
  -80,
  1540,
  560,
  220,
  '#fee2e2'
);

node(
  'storage-asset',
  '# Storage Asset\n\n`storageAssetId`\n\nТехническая запись файла на сервере.\n\nХранит обратные ссылки: `h3druAssetId`, `twinId`.',
  840,
  -70,
  380,
  230,
  '#ffffff'
);

node(
  's3',
  '# S3 / Object Storage\n\n`storageKey`\n\nИсходники, web-модель, тайлы, текстуры, архивы, gigapixel pyramid, JSON рядом с файлом.',
  1260,
  -70,
  380,
  230,
  '#ffffff'
);

node(
  'processing',
  '# Processing\n\nОчередь обработки: конвертация, генерация web-модели, тайлов, preview, проверка checksum.',
  840,
  220,
  380,
  220,
  '#ffffff'
);

node(
  'poi',
  '# POI JSON\n\n`GET /poi`\n`PUT /poi`\n\nТочки интереса PlayCanvas: позиция камеры, focus, title, description, color.',
  1260,
  220,
  380,
  220,
  '#ffffff'
);

node(
  'embed-service',
  '# Embed / Viewer Service\n\nФормирует iframe и query-параметры: ui, lang, poi, tour, measure, fullscreen, cameraPosition.',
  840,
  500,
  380,
  210,
  '#ffffff'
);

node(
  'download',
  '# Download / Archive\n\n`GET /download-url`\n`POST /archive`\n`POST /restore`\n`DELETE /asset`\n\nSigned URL, Glacier/архив, удаление.',
  1260,
  500,
  380,
  210,
  '#ffffff'
);

node(
  'postmessage',
  '# JS API внутри iframe\n\n`window.postMessage`\n\nКоманды: focus-poi, open-poi, next-poi, prev-poi, play-animation, pause-animation.\n\nСобытия: poi-selected, animation-time.',
  840,
  770,
  800,
  220,
  '#ffffff'
);

node(
  'schemas',
  '# Schemas\n\nCreateUploadRequest\nUploadUrlResponse\nCompleteUploadRequest\nStorageAsset\nFileUrlResponse\nDownloadUrlResponse\nPreviewAsset\nPoiItem\nCreateStorageEmbedRequest\nStorageEmbedResponse\nAssetStatusWebhook\nStorageError\n\nSchemas описывают поля request/response.',
  840,
  1040,
  380,
  330,
  '#ffffff'
);

node(
  'security',
  '# Security\n\n`serviceBearerAuth`\n\nСервисный Bearer JWT между порталом и сервером хранения.\n\n`webhookSignature`\n\nПодпись webhook через `X-H3D-Signature`.\n\nПользовательские роли проверяет портал, а не сервер хранения.',
  1260,
  1040,
  380,
  330,
  '#ffffff'
);

edge('e1', 'h3did', 'twin', 'имеет цифровые двойники', 'bottom', 'top');
edge('e2', 'twin', 'portal-asset', 'имеет файлы', 'right', 'left');
edge('e3', 'portal-asset', 'upload', 'создать upload', 'right', 'left', '#2563eb');
edge('e4', 'upload', 'storage-asset', 'uploadUrl', 'right', 'left', '#2563eb');
edge('e5', 'complete', 'storage-asset', 'создать storageAssetId', 'right', 'left', '#2563eb');
edge('e6', 'storage-asset', 'complete', 'StorageAsset response', 'left', 'right', '#2563eb');
edge('e7', 'portal-asset', 'status', 'проверить status', 'right', 'left', '#b45309');
edge('e8', 'processing', 'webhook', 'status webhook', 'left', 'right', '#b45309');
edge('e9', 'webhook', 'policy', 'обновить статус публикации', 'left', 'right', '#b45309');
edge('e10', 'catalog', 'preview', 'получить preview', 'right', 'left', '#7c3aed');
edge('e11', 'preview', 'processing', 'thumbnail/poster', 'right', 'left', '#7c3aed');
edge('e12', 'catalog', 'viewer', 'получить embed', 'right', 'left', '#7c3aed');
edge('e13', 'viewer', 'embed-service', 'iframeUrl / iframeHtml', 'right', 'left', '#7c3aed');
edge('e14', 'viewer', 's3', 'file-url / signed URL', 'right', 'left', '#7c3aed');
edge('e15', 'portal-asset', 'poi', 'GET/PUT POI', 'right', 'left', '#059669');
edge('e16', 'policy', 'download', 'download/archive/delete', 'right', 'left', '#dc2626');
edge('e17', 'embed-service', 'postmessage', 'команды iframe', 'bottom', 'top', '#64748b');
edge('e18', 'portal-asset', 'poi-api', 'получить/сохранить POI', 'right', 'left', '#059669');
edge('e19', 'poi-api', 'poi', 'PoiListResponse', 'right', 'left', '#059669');
edge('e20', 'policy', 'download-api', 'скачать/архив/удалить', 'right', 'left', '#dc2626');
edge('e21', 'download-api', 'download', 'signed URL / operation', 'right', 'left', '#dc2626');
edge('e22', 'schemas', 'storage-asset', 'описывают ответы', 'top', 'bottom', '#64748b');
edge('e23', 'security', 'server-zone', 'защищает API', 'top', 'right', '#64748b');

writeJson(canvasPath, { nodes, edges });

function mxCell(id, value, style, x, y, w, h) {
  return [
    `    <mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />`,
    '    </mxCell>'
  ].join('\n');
}

function mxEdge(id, source, target, label, stroke = '#64748b') {
  return [
    `    <mxCell id="${id}" value="${esc(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${stroke};strokeWidth=2;endArrow=block;endFill=1;fontColor=${stroke};fontStyle=1;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>'
  ].join('\n');
}

function style(fill, stroke = '#94a3b8', font = '#0f172a', bold = false) {
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `fontColor=${font}`,
    bold ? 'fontStyle=1' : 'fontStyle=0',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=top'
  ].join(';');
}

const drawCells = [
  '    <mxCell id="0" />',
  '    <mxCell id="1" parent="0" />'
];

nodes.forEach((n) => {
  const fill = n.color || '#ffffff';
  const isZone = n.id.endsWith('zone');
  const isTitle = n.id === 'title';
  drawCells.push(mxCell(
    n.id,
    n.text,
    style(fill, isTitle ? '#111827' : isZone ? '#64748b' : '#94a3b8', isTitle ? '#ffffff' : '#0f172a', isTitle || isZone),
    n.x + 1300,
    n.y + 700,
    n.width,
    n.height
  ));
});

const drawEdges = edges.map((e) => mxEdge(e.id, e.fromNode, e.toNode, e.label, e.color));
const drawio = [
  '<mxfile host="app.diagrams.net" modified="2026-05-16T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">',
  '  <diagram id="site-storage-two-canvases" name="Site Storage Two Canvases">',
  '<mxGraphModel dx="1800" dy="1100" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="3400" pageHeight="2400" math="0" shadow="0">',
  '  <root>',
  ...drawCells,
  ...drawEdges,
  '  </root>',
  '</mxGraphModel>',
  '  </diagram>',
  '</mxfile>'
].join('\n');

ensureDir(drawioPath);
fs.writeFileSync(drawioPath, `${drawio}\n`);

console.log(`Exported ${canvasPath}`);
console.log(`Exported ${drawioPath}`);
