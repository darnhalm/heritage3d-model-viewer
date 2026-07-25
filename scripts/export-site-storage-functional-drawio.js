const fs = require('fs');
const path = require('path');

const outputDrawio = 'docs/api/drawio/site-storage-functional-map.drawio';

const METHOD = {
  GET: { fill: '#55a2ff', card: '#101820', stroke: '#2f6fb4' },
  POST: { fill: '#08bf7a', card: '#0f1f1a', stroke: '#047a50' },
  PUT: { fill: '#f59e0b', card: '#211a0f', stroke: '#b45309' },
  PATCH: { fill: '#a78bfa', card: '#1b1626', stroke: '#7c3aed' },
  DELETE: { fill: '#f2645a', card: '#201313', stroke: '#963832' }
};

const storageEndpoints = {
  'storage-upload': ['POST', '/storage/v1/uploads', 'Получить uploadUrl для прямой загрузки файла.'],
  'storage-complete': ['POST', '/storage/v1/uploads/{uploadId}/complete', 'Подтвердить загрузку и создать storageAssetId.'],
  'storage-asset': ['GET', '/storage/v1/assets/{storageAssetId}', 'Получить техническую карточку файла.'],
  'storage-file-url': ['GET', '/storage/v1/assets/{storageAssetId}/file-url', 'Получить fileUrl / signed URL для viewer.'],
  'storage-delete': ['DELETE', '/storage/v1/assets/{storageAssetId}', 'Удалить технический asset.'],
  'storage-status': ['GET', '/storage/v1/assets/{storageAssetId}/status', 'Получить статус обработки.'],
  'storage-preview-get': ['GET', '/storage/v1/assets/{storageAssetId}/preview', 'Получить preview/poster/screenshot.'],
  'storage-preview-post': ['POST', '/storage/v1/assets/{storageAssetId}/preview', 'Запустить генерацию preview.'],
  'storage-poi-get': ['GET', '/storage/v1/assets/{storageAssetId}/poi', 'Получить точки интереса.'],
  'storage-poi-put': ['PUT', '/storage/v1/assets/{storageAssetId}/poi', 'Сохранить точки интереса.'],
  'storage-download': ['GET', '/storage/v1/assets/{storageAssetId}/download-url', 'Получить временную ссылку на скачивание.'],
  'storage-archive': ['POST', '/storage/v1/assets/{storageAssetId}/archive', 'Переместить файл в архивное хранение.'],
  'storage-restore': ['POST', '/storage/v1/assets/{storageAssetId}/restore', 'Восстановить из архива.'],
  'storage-embed': ['POST', '/storage/v1/embed', 'Сформировать iframeUrl / iframeHtml.'],
  'storage-webhook': ['POST', '/storage/v1/webhooks/asset-status', 'Событие статуса storage -> сайт.']
};

const siteEndpoints = {
  'site-create-asset': ['POST', '/site/v1/twins/{twinId}/assets', 'Создать запись файла на сайте.', 'Страница загрузки модели'],
  'site-link-storage': ['POST', '/site/v1/assets/{h3druAssetId}/link-storage', 'Сохранить storageAssetId после загрузки.', 'Страница загрузки модели'],
  'site-get-asset': ['GET', '/site/v1/assets/{h3druAssetId}', 'Получить asset сайта вместе со storage-связкой.', 'Карточка ассета / админка'],
  'site-catalog-list': ['GET', '/site/v1/catalog/objects', 'Публичный список каталога с preview.', 'Страница каталога'],
  'site-catalog-page': ['GET', '/site/v1/catalog/objects/{slugOrH3DID}', 'Публичная страница объекта.', 'Страница объекта'],
  'site-object-embed': ['GET', '/site/v1/objects/{h3druObjectId}/embed', 'Получить embed для публичной страницы.', 'Страница объекта'],
  'site-asset-embed': ['POST', '/site/v1/assets/{h3druAssetId}/embed', 'Сформировать embed с настройками сайта.', 'Настройки встройки'],
  'site-poi-get': ['GET', '/site/v1/assets/{h3druAssetId}/poi', 'Получить POI через сайт.', 'Редактор POI'],
  'site-poi-put': ['PUT', '/site/v1/assets/{h3druAssetId}/poi', 'Сохранить POI через сайт.', 'Редактор POI'],
  'site-download': ['GET', '/site/v1/assets/{h3druAssetId}/download', 'Проверить права и получить downloadUrl.', 'Карточка объекта / скачать'],
  'site-archive': ['POST', '/site/v1/assets/{h3druAssetId}/archive', 'Архивировать asset через сайт.', 'Админка ассета'],
  'site-restore': ['POST', '/site/v1/assets/{h3druAssetId}/restore', 'Восстановить asset через сайт.', 'Админка ассета'],
  'site-delete': ['DELETE', '/site/v1/assets/{h3druAssetId}', 'Удалить asset сайта и storage asset.', 'Админка ассета'],
  'site-storage-webhook': ['POST', '/site/v1/webhooks/storage/asset-status', 'Принять webhook от storage.', 'Фоновый обработчик']
};

const rows = [
  ['Загрузка', 'site-create-asset', 'storage-upload', 'сайт создает asset и запрашивает uploadUrl'],
  ['Загрузка', 'storage-complete', 'site-link-storage', 'storage возвращает storageAssetId, сайт сохраняет связку'],
  ['Технический asset', 'site-get-asset', 'storage-asset', 'сайт подтягивает техническую карточку файла'],
  ['Технический asset', 'site-get-asset', 'storage-status', 'сайт проверяет processing status'],
  ['Каталог', 'site-catalog-list', 'storage-preview-get', 'каталог берет preview для карточек'],
  ['Страница объекта', 'site-catalog-page', 'storage-preview-get', 'страница объекта берет preview/poster'],
  ['Страница объекта', 'site-catalog-page', 'storage-file-url', 'viewer получает fileUrl при необходимости'],
  ['Embed', 'site-object-embed', 'storage-embed', 'GET сайта внутри вызывает POST storage embed'],
  ['Embed', 'site-asset-embed', 'storage-embed', 'POST сайта внутри вызывает POST storage embed'],
  ['POI', 'site-poi-get', 'storage-poi-get', 'GET сайта проксирует GET storage POI'],
  ['POI', 'site-poi-put', 'storage-poi-put', 'PUT сайта проксирует PUT storage POI'],
  ['Скачивание', 'site-download', 'storage-download', 'сайт проверяет права и запрашивает signed downloadUrl'],
  ['Архив', 'site-archive', 'storage-archive', 'сайт проверяет права и отправляет в архив'],
  ['Архив', 'site-restore', 'storage-restore', 'сайт проверяет права и восстанавливает из архива'],
  ['Удаление', 'site-delete', 'storage-delete', 'сайт проверяет права и удаляет storage asset'],
  ['Webhook', 'storage-webhook', 'site-storage-webhook', 'storage сам вызывает POST endpoint сайта']
];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#xa;');
}

function mxCell(id, value, style, x, y, width, height) {
  return [
    `    <mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />`,
    '    </mxCell>'
  ].join('\n');
}

function edge(id, source, target, label, color) {
  return [
    `    <mxCell id="${id}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${color};strokeWidth=2;endArrow=block;endFill=1;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>'
  ].join('\n');
}

function cardStyle(method) {
  const c = METHOD[method] || METHOD.GET;
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${c.card}`,
    `strokeColor=${c.stroke}`,
    'fontColor=#f8fafc',
    'fontStyle=0',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=top'
  ].join(';');
}

function badgeStyle(method) {
  const c = METHOD[method] || METHOD.GET;
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${c.fill}`,
    `strokeColor=${c.fill}`,
    'fontColor=#05070a',
    'fontStyle=1',
    'fontSize=18',
    'arcSize=8',
    'spacing=8',
    'align=center',
    'verticalAlign=middle'
  ].join(';');
}

function headerStyle(fill, stroke = '#64748b') {
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    'fontColor=#0f172a',
    'fontStyle=1',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=top'
  ].join(';');
}

function pageBadgeStyle() {
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    'fillColor=#f8fafc',
    'strokeColor=#94a3b8',
    'fontColor=#0f172a',
    'fontStyle=1',
    'fontSize=11',
    'arcSize=8',
    'spacing=8',
    'align=center',
    'verticalAlign=middle'
  ].join(';');
}

function endpointCell(id, endpoint, x, y, options = {}) {
  const [method, path, description, page] = endpoint;
  const cells = [
    mxCell(id, `\n\n${path}\n${description}`, cardStyle(method), x, y, 620, 150),
    mxCell(`${id}-method`, method, badgeStyle(method), x + 14, y + 14, 138, 50)
  ];

  if (options.showPage && page) {
    cells.push(mxCell(`${id}-page`, page, pageBadgeStyle(), x + 174, y + 14, 250, 50));
  }

  return [
    ...cells
  ];
}

const cells = ['    <mxCell id="0" />', '    <mxCell id="1" parent="0" />'];
const edges = [];

cells.push(mxCell(
  'title',
  'Функциональная связка API сайта и API storage/player\n\nСлева endpoint сайта. Справа endpoint сервера хранения/плеера. Стрелка показывает функциональную связь. Методы могут отличаться: например GET сайта может внутри вызывать POST storage.',
  headerStyle('#111827', '#111827').replace('fontColor=#0f172a', 'fontColor=#ffffff'),
  40,
  20,
  1760,
  150
));

cells.push(mxCell('site-header', 'API сайта\n\nH3DID, карточка, каталог, права, публикация, связь h3druAssetId -> storageAssetId.', headerStyle('#e0f2fe'), 40, 210, 620, 120));
cells.push(mxCell('storage-header', 'API storage/player\n\nstorageAssetId, файлы, upload, preview, POI, embed, download, archive, webhooks.', headerStyle('#dcfce7'), 1180, 210, 620, 120));

let y = 380;
let lastGroup = '';

rows.forEach(([group, from, to, label], index) => {
  if (group !== lastGroup) {
    cells.push(mxCell(`group-${index}`, group, headerStyle('#f8fafc'), 40, y, 1760, 50));
    y += 80;
    lastGroup = group;
  }

  const fromEndpoint = siteEndpoints[from] || storageEndpoints[from];
  const toEndpoint = siteEndpoints[to] || storageEndpoints[to];
  const fromIsSite = Boolean(siteEndpoints[from]);
  const toIsSite = Boolean(siteEndpoints[to]);
  const fromX = fromIsSite ? 40 : 1180;
  const toX = toIsSite ? 40 : 1180;
  const fromId = `from-${index}`;
  const toId = `to-${index}`;

  cells.push(...endpointCell(fromId, fromEndpoint, fromX, y, { showPage: fromIsSite }));
  cells.push(...endpointCell(toId, toEndpoint, toX, y, { showPage: toIsSite }));

  const method = fromEndpoint[0];
  edges.push(edge(`edge-${index}`, fromId, toId, label, METHOD[method]?.fill || '#64748b'));

  y += 190;
});

const diagram = [
  '<mxGraphModel dx="1800" dy="1100" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1900" pageHeight="3700" math="0" shadow="0">',
  '  <root>',
  ...cells,
  ...edges,
  '  </root>',
  '</mxGraphModel>'
].join('\n');

const xml = [
  '<mxfile host="app.diagrams.net" modified="2026-05-16T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">',
  '  <diagram id="site-storage-functional-map" name="Site Storage Functional Map">',
  diagram,
  '  </diagram>',
  '</mxfile>'
].join('\n');

fs.mkdirSync(path.dirname(outputDrawio), { recursive: true });
fs.writeFileSync(outputDrawio, `${xml}\n`);

console.log(`Created ${outputDrawio}`);
