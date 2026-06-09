const fs = require('fs');
const path = require('path');

const outputDrawio = 'docs/api/drawio/portal-conceptual-model.drawio';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#xa;');
}

function style(parts) {
  return parts.join(';');
}

function cell(id, value, styleValue, x, y, width, height) {
  return [
    `    <mxCell id="${id}" value="${esc(value)}" style="${esc(styleValue)}" vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />`,
    '    </mxCell>',
  ].join('\n');
}

function edge(id, source, target, label, color = '#64748B') {
  return [
    `    <mxCell id="${id}" value="${esc(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${color};strokeWidth=2;endArrow=block;endFill=1;fontSize=12;fontColor=#334155;labelBackgroundColor=#FFFFFF;" edge="1" parent="1" source="${source}" target="${target}">`,
    '      <mxGeometry relative="1" as="geometry" />',
    '    </mxCell>',
  ].join('\n');
}

function box(fill, stroke, font = '#0F172A', bold = true) {
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `fontColor=${font}`,
    bold ? 'fontStyle=1' : 'fontStyle=0',
    'arcSize=8',
    'spacing=14',
    'align=left',
    'verticalAlign=top',
  ]);
}

function band(fill, stroke) {
  return style([
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    'fontColor=#0F172A',
    'fontStyle=1',
    'arcSize=8',
    'spacing=12',
    'align=left',
    'verticalAlign=top',
  ]);
}

const cells = ['    <mxCell id="0" />', '    <mxCell id="1" parent="0" />'];
const edges = [];

cells.push(cell(
  'title',
  'Концептуальная модель портала Heritage3D\n\nСхема показывает не endpoint’ы, а основные сущности: кто входит в систему, кто владеет H3DID, где хранятся описания, как цифровые представления связаны с файлами и почему медиахранилище содержит только технические объекты.',
  box('#111827', '#111827', '#FFFFFF'),
  40,
  30,
  2200,
  120,
));

cells.push(cell('auth-band', 'Авторизация и управление доступом', band('#E0F2FE', '#0284C7'), 40, 190, 2200, 60));
cells.push(cell('portal-band', 'Портал Heritage3D: смысл, права, публикация, каталог', band('#DCFCE7', '#16A34A'), 40, 500, 1420, 60));
cells.push(cell('storage-band', 'Медиахранилище и плееры: файлы, обработка, просмотр', band('#FEF3C7', '#D97706'), 1520, 500, 720, 60));

cells.push(cell(
  'geoscan-login',
  'Geoscan Login\n\nЕдиный вход и учетная запись.\nОтвечает на вопрос:\n«кто пользователь?»',
  box('#DBEAFE', '#2563EB'),
  70,
  280,
  330,
  150,
));

cells.push(cell(
  'user',
  'Пользователь\n\nuserId\ngeoscanUserId\nпрофиль портала',
  box('#DBEAFE', '#2563EB'),
  480,
  280,
  300,
  150,
));

cells.push(cell(
  'membership',
  'Членство и роли\n\norganization_admin\neditor\nmoderator\nworkgroup_member\nviewer',
  box('#EDE9FE', '#7C3AED'),
  870,
  280,
  360,
  150,
));

cells.push(cell(
  'permissions',
  'Политики доступа\n\nсоздать объект\nзагрузить модель\nредактировать metadata\nопубликовать\nскачать исходники',
  box('#EDE9FE', '#7C3AED'),
  1320,
  280,
  400,
  150,
));

cells.push(cell(
  'organization',
  'Организация / музей\n\norganizationId\nвладелец H3DID\nпрофиль музея\navatar / cover',
  box('#BBF7D0', '#16A34A'),
  70,
  610,
  360,
  160,
));

cells.push(cell(
  'workgroups',
  'Рабочие группы\n\nworkgroupId\nкоманды внутри музея\nоцифровка\nописание\nмодерация',
  box('#FEF9C3', '#CA8A04'),
  70,
  830,
  360,
  150,
));

cells.push(cell(
  'h3did',
  'Культурный объект\n\nH3DID / h3druObjectId\nглавный сквозной ID\nстатус: draft / review / published\nvisibility',
  box('#D9F99D', '#65A30D'),
  540,
  610,
  410,
  170,
));

cells.push(cell(
  'metadata',
  'Метаданные объекта\n\nDublin Core\nCIDOC CRM\nexternalIds:\nКАМИС, Госкаталог,\nЕГРОКН, Geoscan UUID',
  box('#CCFBF1', '#0F766E'),
  540,
  840,
  410,
  170,
));

cells.push(cell(
  'collections',
  'Коллекции / каталоги\n\ncollectionId\nparentCollectionId\nобъекты музея\nминиатюра коллекции',
  box('#FCE7F3', '#DB2777'),
  1040,
  610,
  360,
  160,
));

cells.push(cell(
  'articles',
  'Статьи\n\narticleId\nтекстовая публикация\nподборка моделей\nпорядок, подписи,\ncamera / POI',
  box('#FCE7F3', '#DB2777'),
  1040,
  840,
  360,
  170,
));

cells.push(cell(
  'twins',
  'Цифровые представления\n\ntwinId\nPlayCanvas 3D\nGeoscan Cloud\ngigapixel 2D\npoint cloud',
  box('#E0F2FE', '#0284C7'),
  540,
  1080,
  410,
  170,
));

cells.push(cell(
  'site-assets',
  'Ассеты сайта\n\nh3druAssetId\nтип asset\nстатус публикации\nможно ли скачать\nсвязь со storage',
  box('#E0F2FE', '#0284C7'),
  1040,
  1080,
  360,
  170,
));

cells.push(cell(
  'catalog',
  'Публичный каталог\n\nстраницы музеев\nстраницы коллекций\nстраницы объектов\nстатьи\nпоиск и фильтры',
  box('#F8FAFC', '#94A3B8'),
  70,
  1080,
  360,
  170,
));

cells.push(cell(
  'storage-api',
  'Storage/player API\n\nupload\nstatus\npreview\nmanifest\nembed\ndownload\nwebhooks',
  box('#FED7AA', '#EA580C'),
  1560,
  610,
  320,
  190,
));

cells.push(cell(
  'storage-asset',
  'Технический asset\n\nstorageAssetId\nfileName\nformat\nsize\nchecksum\nprocessingStatus',
  box('#FEF3C7', '#D97706'),
  1910,
  610,
  300,
  190,
));

cells.push(cell(
  's3',
  'S3 / object storage\n\nисходники\nоптимизированные модели\nтекстуры\ngigapixel tiles\npreview\nmanifest',
  box('#FEF3C7', '#D97706'),
  1910,
  880,
  300,
  190,
));

cells.push(cell(
  'viewer',
  'Плееры / viewer iframe\n\nPlayCanvas\nGeoscan Cloud\ngigapixel viewer\npostMessage события',
  box('#FED7AA', '#EA580C'),
  1560,
  880,
  320,
  190,
));

cells.push(cell(
  'principle',
  'Принцип разделения\n\nСайт хранит описание, права, публикацию, роли и связи.\nМедиахранилище хранит только файлы и техническое состояние.\nAPI связывает эти слои и проверяет доступ.',
  box('#F8FAFC', '#64748B'),
  540,
  1320,
  1360,
  130,
));

edges.push(edge('e-login-user', 'geoscan-login', 'user', 'подтверждает личность', '#2563EB'));
edges.push(edge('e-user-membership', 'user', 'membership', 'имеет членство', '#7C3AED'));
edges.push(edge('e-membership-org', 'membership', 'organization', 'роль внутри организации', '#7C3AED'));
edges.push(edge('e-membership-permissions', 'membership', 'permissions', 'задает права', '#7C3AED'));
edges.push(edge('e-permissions-h3did', 'permissions', 'h3did', 'разрешает действия', '#7C3AED'));

edges.push(edge('e-org-h3did', 'organization', 'h3did', 'владеет объектами', '#16A34A'));
edges.push(edge('e-org-workgroups', 'organization', 'workgroups', 'создает команды', '#CA8A04'));
edges.push(edge('e-workgroups-h3did', 'workgroups', 'h3did', 'ведут работу', '#CA8A04'));
edges.push(edge('e-h3did-metadata', 'h3did', 'metadata', 'описан через', '#0F766E'));
edges.push(edge('e-h3did-collections', 'h3did', 'collections', 'входит в', '#DB2777'));
edges.push(edge('e-collections-articles', 'collections', 'articles', 'может использоваться в', '#DB2777'));
edges.push(edge('e-articles-h3did', 'articles', 'h3did', 'подборка объектов', '#DB2777'));
edges.push(edge('e-h3did-twins', 'h3did', 'twins', 'имеет представления', '#0284C7'));
edges.push(edge('e-twins-assets', 'twins', 'site-assets', 'использует ассеты', '#0284C7'));
edges.push(edge('e-catalog-org', 'catalog', 'organization', 'показывает музей', '#64748B'));
edges.push(edge('e-catalog-h3did', 'catalog', 'h3did', 'показывает объект', '#64748B'));
edges.push(edge('e-catalog-collections', 'catalog', 'collections', 'показывает коллекции', '#64748B'));
edges.push(edge('e-catalog-articles', 'catalog', 'articles', 'показывает статьи', '#64748B'));

edges.push(edge('e-assets-storage-api', 'site-assets', 'storage-api', 'сайт вызывает API', '#EA580C'));
edges.push(edge('e-storage-api-storage-asset', 'storage-api', 'storage-asset', 'создает / читает', '#EA580C'));
edges.push(edge('e-storage-asset-s3', 'storage-asset', 's3', 'физические файлы', '#D97706'));
edges.push(edge('e-storage-api-viewer', 'storage-api', 'viewer', 'embed / manifest', '#EA580C'));
edges.push(edge('e-viewer-catalog', 'viewer', 'catalog', 'iframe на странице', '#EA580C'));

const diagram = [
  '<mxGraphModel dx="2200" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2280" pageHeight="1520" math="0" shadow="0">',
  '  <root>',
  ...cells,
  ...edges,
  '  </root>',
  '</mxGraphModel>',
].join('\n');

const xml = [
  '<mxfile host="app.diagrams.net" modified="2026-05-18T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">',
  '  <diagram id="portal-conceptual-model" name="Portal Conceptual Model">',
  diagram,
  '  </diagram>',
  '</mxfile>',
].join('\n');

fs.mkdirSync(path.dirname(outputDrawio), { recursive: true });
fs.writeFileSync(outputDrawio, `${xml}\n`);
console.log(`Created ${outputDrawio}`);
