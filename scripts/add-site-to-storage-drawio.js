const fs = require('fs');
const path = require('path');

const sourcePath = 'docs/api/drawio/storage-player-api.drawio';
const outputPath = 'docs/api/drawio/storage-player-api-with-site.drawio';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#xa;');
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

function cell(id, value, x, y, width, height, fill, bold = false) {
  return [
    `    <mxCell id="${id}" value="${esc(value)}" style="${esc(style(fill, bold ? '#64748b' : '#94a3b8', '#0f172a', bold))}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />`,
    '    </mxCell>'
  ].join('\n');
}

function edge(id, source, target, color = '#64748b') {
  return [
    `    <mxCell id="${id}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${color};strokeWidth=2;endArrow=block;endFill=1;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>'
  ].join('\n');
}

const API_SHIFT_Y = 1120;
let xml = fs.readFileSync(sourcePath, 'utf8');

xml = xml.replace(/<mxGeometry([^>]*?)y="(-?\d+(?:\.\d+)?)"([^>]*?)>/g, (match, before, y, after) => {
  return `<mxGeometry${before}y="${Number(y) + API_SHIFT_Y}"${after}>`;
});

xml = xml.replace('pageHeight="3600"', 'pageHeight="4800"');

const siteCells = [
  cell('site-title', '# САЙТ / ПОРТАЛ 3D-НАСЛЕДИЕ\n\nВерхний слой - портал. Нижний слой - старая API-карта сервера хранения с POST / GET / PUT / DELETE. Между ними лежат карточки обмена, чтобы стрелки не пересекались.', 40, 20, 1200, 190, '#e0f2fe', true),
  cell('site-h3did', '# 1. H3DID\n\nh3druObjectId\n\nГлавный ID культурного объекта. Здесь остаются CIDOC CRM / Dublin Core, внешние ID, описание, адрес, организация, права.', 40, 270, 560, 210, '#ffffff'),
  cell('site-asset', '# 2. Portal Asset\n\nh3druAssetId\ntwinId\n\nЗапись файла на сайте. После загрузки сайт сохраняет storageAssetId.', 680, 270, 560, 210, '#ffffff'),
  cell('site-catalog', '# 3. Каталог / страница объекта\n\nПубличная страница берет у сервера preview, iframe/embed и fileUrl для просмотра.', 1960, 270, 560, 210, '#ffffff'),
  cell('site-policy', '# 4. Права и жизненный цикл\n\ndraft, published, archived, password_protected\n\nПортал решает, можно ли скачать, удалить, архивировать или восстановить ассет.', 2600, 270, 560, 210, '#ffffff'),
  cell('site-js', '# 5. Страница с iframe\n\nПосле embed страница сайта общается с viewer через window.postMessage: POI, tour, animation events.', 1960, 530, 560, 190, '#ffffff'),
  cell('site-id-map', '# Связка ID\n\nH3DID / h3druObjectId -> twinId -> h3druAssetId -> storageAssetId\n\nH3DID главный на сайте. storageAssetId нужен для команд API хранения.', 680, 530, 560, 190, '#f8fafc'),
  cell('exchange-upload', '# Обмен: загрузка\n\nСайт отправляет:\ntwinId, h3druAssetId, fileName, contentType, sizeBytes.\n\nСайт принимает:\nuploadId, uploadUrl, затем storageAssetId.', 40, 840, 560, 250, '#dcfce7', true),
  cell('exchange-assets', '# Обмен: технический asset\n\nСайт отправляет:\nstorageAssetId.\n\nСайт принимает:\nтехническую карточку файла, fileUrl / signed URL, результат удаления.', 680, 840, 560, 250, '#dbeafe', true),
  cell('exchange-processing', '# Обмен: обработка\n\nСайт спрашивает статус по storageAssetId.\n\nСервер сам отправляет webhook:\nready / failed / archived.', 1320, 840, 560, 250, '#fef3c7', true),
  cell('exchange-preview-poi', '# Обмен: preview и POI\n\nPreview идет в каталог.\n\nPOI читает и сохраняет страница с viewer:\nGET /poi, PUT /poi.', 1960, 840, 560, 250, '#f3e8ff', true),
  cell('exchange-embed-download', '# Обмен: embed и скачивание\n\nEmbed возвращает:\niframeUrl, iframeHtml, query.\n\nDownload/archive/restore/delete зависят от прав портала.', 2600, 840, 560, 250, '#ede9fe', true),
  edge('site-flow-1', 'site-h3did', 'site-asset'),
  edge('site-flow-2', 'site-asset', 'site-id-map'),
  edge('site-flow-3', 'site-catalog', 'site-js'),
  edge('site-upload', 'site-asset', 'exchange-upload'),
  edge('site-assets', 'site-asset', 'exchange-assets'),
  edge('site-processing', 'site-asset', 'exchange-processing'),
  edge('site-preview', 'site-catalog', 'exchange-preview-poi'),
  edge('site-poi', 'site-js', 'exchange-preview-poi'),
  edge('site-embed', 'site-catalog', 'exchange-embed-download'),
  edge('site-policy-edge', 'site-policy', 'exchange-embed-download'),
  edge('api-upload-1', 'exchange-upload', 'endpoint-3', '#08bf7a'),
  edge('api-upload-2', 'exchange-upload', 'endpoint-6', '#08bf7a'),
  edge('api-asset-1', 'exchange-assets', 'endpoint-8', '#55a2ff'),
  edge('api-asset-2', 'exchange-assets', 'endpoint-13', '#55a2ff'),
  edge('api-asset-3', 'exchange-assets', 'endpoint-11', '#f2645a'),
  edge('api-processing-1', 'exchange-processing', 'endpoint-19', '#55a2ff'),
  edge('api-processing-2', 'exchange-processing', 'endpoint-38', '#08bf7a'),
  edge('api-preview-1', 'exchange-preview-poi', 'endpoint-22', '#55a2ff'),
  edge('api-preview-2', 'exchange-preview-poi', 'endpoint-25', '#08bf7a'),
  edge('api-poi-1', 'exchange-preview-poi', 'endpoint-27', '#55a2ff'),
  edge('api-poi-2', 'exchange-preview-poi', 'endpoint-30', '#f59e0b'),
  edge('api-embed-1', 'exchange-embed-download', 'endpoint-35', '#08bf7a'),
  edge('api-download-1', 'exchange-embed-download', 'endpoint-32', '#55a2ff'),
  edge('api-archive-1', 'exchange-embed-download', 'endpoint-15', '#08bf7a'),
  edge('api-archive-2', 'exchange-embed-download', 'endpoint-17', '#08bf7a'),
  edge('api-postmessage', 'site-js', 'postmessage', '#64748b')
].join('\n');

xml = xml.replace('  </root>', `${siteCells}\n  </root>`);
xml = xml.replace('name="Storage Player API"', 'name="Storage Player API + Site"');
xml = xml.replace('id="storage-player-api"', 'id="storage-player-api-with-site"');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, xml);

console.log(`Created ${outputPath}`);
