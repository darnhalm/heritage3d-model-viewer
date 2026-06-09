const fs = require('fs');
const path = require('path');

const sourcePath = 'docs/api/obsidian/storage-player-api.canvas';
const outputPath = 'docs/api/obsidian/storage-player-api-with-site.canvas';

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

// API карту оставляем как есть по структуре, но опускаем вниз.
// Сверху добавляем аккуратный слой сайта и карточки обмена.
const API_SHIFT_Y = 1120;

const nodes = source.nodes.map((node) => ({
  ...node,
  y: node.y + API_SHIFT_Y
}));

const edges = source.edges.map((edge) => ({ ...edge }));

function addNode(id, text, x, y, width, height, color) {
  nodes.push({ id, type: 'text', x, y, width, height, color, text });
}

function addEdge(id, fromNode, toNode, fromSide = 'bottom', toSide = 'top', color = '#64748b') {
  edges.push({ id, fromNode, fromSide, toNode, toSide, color });
}

// Верхняя полоса: что живет на сайте.
addNode(
  'site-title',
  '# САЙТ / ПОРТАЛ 3D-НАСЛЕДИЕ\n\nВерхний слой — портал. Нижний слой — старая API-карта сервера хранения с POST / GET / PUT / DELETE. Между ними лежат карточки обмена, чтобы стрелки не пересекались.',
  0,
  -900,
  1200,
  190,
  '#e0f2fe'
);

addNode(
  'site-h3did',
  '# 1. H3DID\n\n`h3druObjectId`\n\nГлавный ID культурного объекта. Здесь остаются CIDOC CRM / Dublin Core, внешние ID, описание, адрес, организация, права.',
  0,
  -650,
  560,
  210,
  '#ffffff'
);

addNode(
  'site-asset',
  '# 2. Portal Asset\n\n`h3druAssetId`\n`twinId`\n\nЗапись файла на сайте. После загрузки сайт сохраняет `storageAssetId`.',
  640,
  -650,
  560,
  210,
  '#ffffff'
);

addNode(
  'site-catalog',
  '# 3. Каталог / страница объекта\n\nПубличная страница берет у сервера preview, iframe/embed и fileUrl для просмотра.',
  1920,
  -650,
  560,
  210,
  '#ffffff'
);

addNode(
  'site-policy',
  '# 4. Права и жизненный цикл\n\n`draft`, `published`, `archived`, `password_protected`\n\nПортал решает, можно ли скачать, удалить, архивировать или восстановить ассет.',
  2560,
  -650,
  560,
  210,
  '#ffffff'
);

addNode(
  'site-js',
  '# 5. Страница с iframe\n\nПосле embed страница сайта общается с viewer через `window.postMessage`: POI, tour, animation events.',
  1920,
  -390,
  560,
  190,
  '#ffffff'
);

addNode(
  'site-id-map',
  '# Связка ID\n\n`h3druObjectId` -> `twinId` -> `h3druAssetId` -> `storageAssetId`\n\n`H3DID` главный на сайте. `storageAssetId` нужен для команд API хранения.',
  640,
  -390,
  560,
  190,
  '#f8fafc'
);

// Средняя полоса: карточки обмена. В них текстом указано отправить/принять,
// поэтому стрелки остаются короткими и без длинных подписей.
addNode(
  'exchange-upload',
  '# Обмен: загрузка\n\nСайт отправляет:\n`twinId`, `h3druAssetId`, fileName, contentType, sizeBytes.\n\nСайт принимает:\n`uploadId`, `uploadUrl`, затем `storageAssetId`.',
  0,
  -80,
  560,
  250,
  '#dcfce7'
);

addNode(
  'exchange-assets',
  '# Обмен: технический asset\n\nСайт отправляет:\n`storageAssetId`.\n\nСайт принимает:\nтехническую карточку файла, `fileUrl` / signed URL, результат удаления.',
  640,
  -80,
  560,
  250,
  '#dbeafe'
);

addNode(
  'exchange-processing',
  '# Обмен: обработка\n\nСайт спрашивает статус по `storageAssetId`.\n\nСервер сам отправляет webhook:\nready / failed / archived.',
  1280,
  -80,
  560,
  250,
  '#fef3c7'
);

addNode(
  'exchange-preview-poi',
  '# Обмен: preview и POI\n\nPreview идет в каталог.\n\nPOI читает и сохраняет страница с viewer:\n`GET /poi`, `PUT /poi`.',
  1920,
  -80,
  560,
  250,
  '#f3e8ff'
);

addNode(
  'exchange-embed-download',
  '# Обмен: embed и скачивание\n\nEmbed возвращает:\n`iframeUrl`, `iframeHtml`, query.\n\nDownload/archive/restore/delete зависят от прав портала.',
  2560,
  -80,
  560,
  250,
  '#ede9fe'
);

// Связи сайта с карточками обмена.
addEdge('site-flow-1', 'site-h3did', 'site-asset', 'right', 'left');
addEdge('site-flow-2', 'site-asset', 'site-id-map');
addEdge('site-flow-3', 'site-catalog', 'site-js');
addEdge('site-upload', 'site-asset', 'exchange-upload');
addEdge('site-assets', 'site-asset', 'exchange-assets');
addEdge('site-processing', 'site-asset', 'exchange-processing');
addEdge('site-preview', 'site-catalog', 'exchange-preview-poi');
addEdge('site-poi', 'site-js', 'exchange-preview-poi', 'left', 'top');
addEdge('site-embed', 'site-catalog', 'exchange-embed-download');
addEdge('site-policy', 'site-policy', 'exchange-embed-download');

// Короткие вертикальные связи от карточек обмена к конкретным endpoint-карточкам.
addEdge('api-upload-1', 'exchange-upload', 'endpoint-upload-1', 'bottom', 'top', '#08bf7a');
addEdge('api-upload-2', 'exchange-upload', 'endpoint-upload-2', 'bottom', 'top', '#08bf7a');
addEdge('api-asset-1', 'exchange-assets', 'endpoint-assets-1', 'bottom', 'top', '#55a2ff');
addEdge('api-asset-2', 'exchange-assets', 'endpoint-assets-3', 'bottom', 'top', '#55a2ff');
addEdge('api-asset-3', 'exchange-assets', 'endpoint-assets-2', 'bottom', 'top', '#f2645a');
addEdge('api-processing-1', 'exchange-processing', 'endpoint-processing-1', 'bottom', 'top', '#55a2ff');
addEdge('api-processing-2', 'exchange-processing', 'endpoint-webhooks-1', 'right', 'top', '#08bf7a');
addEdge('api-preview-1', 'exchange-preview-poi', 'endpoint-preview-1', 'bottom', 'top', '#55a2ff');
addEdge('api-preview-2', 'exchange-preview-poi', 'endpoint-preview-2', 'bottom', 'top', '#08bf7a');
addEdge('api-poi-1', 'exchange-preview-poi', 'endpoint-poi-1', 'bottom', 'top', '#55a2ff');
addEdge('api-poi-2', 'exchange-preview-poi', 'endpoint-poi-2', 'bottom', 'top', '#f59e0b');
addEdge('api-embed-1', 'exchange-embed-download', 'endpoint-embed-1', 'bottom', 'top', '#08bf7a');
addEdge('api-download-1', 'exchange-embed-download', 'endpoint-download-1', 'bottom', 'top', '#55a2ff');
addEdge('api-archive-1', 'exchange-embed-download', 'endpoint-assets-4', 'left', 'top', '#08bf7a');
addEdge('api-archive-2', 'exchange-embed-download', 'endpoint-assets-5', 'left', 'top', '#08bf7a');
addEdge('api-postmessage', 'site-js', 'postmessage-api', 'right', 'top', '#64748b');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ nodes, edges }, null, 2)}\n`);

console.log(`Created ${outputPath}`);
