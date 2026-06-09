const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
const GROUP_ORDER = ['Upload', 'Assets', 'Processing', 'Preview', 'POI', 'Download', 'Embed', 'Webhooks'];

const METHOD_COLORS = {
  GET: '#55a2ff',
  POST: '#08bf7a',
  PUT: '#f59e0b',
  PATCH: '#a78bfa',
  DELETE: '#f2645a',
  HEAD: '#94a3b8',
  OPTIONS: '#22d3ee',
  TRACE: '#94a3b8'
};

const GROUP_COLORS = {
  Upload: '#dbeafe',
  Assets: '#dcfce7',
  Processing: '#fef3c7',
  Preview: '#ede9fe',
  POI: '#fee2e2',
  Download: '#cffafe',
  Embed: '#e0e7ff',
  Webhooks: '#f1f5f9'
};

const SELECTED_SCHEMAS = [
  'CreateUploadRequest',
  'UploadUrlResponse',
  'CompleteUploadRequest',
  'StorageAsset',
  'FileUrlResponse',
  'PreviewAsset',
  'PoiItem',
  'CreateStorageEmbedRequest',
  'StorageEmbedResponse',
  'AssetStatusWebhook',
  'StorageError'
];

function readSpec(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function refName(ref) {
  return String(ref || '').split('/').pop();
}

function schemaName(schema) {
  if (!schema) return '';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.oneOf) return schema.oneOf.map(schemaName).filter(Boolean).join(' | ');
  if (schema.items) return `${schemaName(schema.items)}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type || 'object';
}

function responseSchemaName(response) {
  const content = response?.content?.['application/json'];
  return schemaName(content?.schema);
}

function requestSchemaName(operation) {
  const content = operation?.requestBody?.content?.['application/json'];
  return schemaName(content?.schema);
}

function parameterText(parameters = []) {
  if (!parameters.length) return 'нет';
  return parameters.map((parameter) => {
    if (parameter.$ref) return refName(parameter.$ref);
    return `${parameter.name} (${parameter.in})`;
  }).join(', ');
}

function securityText(operation) {
  if (!operation.security?.length) return 'не указана';
  return operation.security.map((entry) => Object.keys(entry).join(', ')).filter(Boolean).join(', ');
}

function responseText(responses = {}) {
  return Object.entries(responses).map(([code, response]) => {
    const schema = responseSchemaName(response);
    return `${code}: ${response.description || ''}${schema ? ` -> ${schema}` : ''}`;
  }).join('\n');
}

function collectGroups(spec) {
  const groups = new Map();

  Object.entries(spec.paths ?? {}).forEach(([endpoint, pathItem]) => {
    METHODS.forEach((method) => {
      const operation = pathItem?.[method];
      if (!operation) return;

      const block = operation.tags?.[0] || 'Other';
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push({
        method: method.toUpperCase(),
        endpoint,
        summary: operation.summary || operation.operationId || '',
        description: operation.description || '',
        operationId: operation.operationId || '',
        auth: securityText(operation),
        parameters: parameterText(operation.parameters || []),
        request: requestSchemaName(operation) || 'нет',
        requestRequired: operation.requestBody?.required === true,
        responses: responseText(operation.responses || {})
      });
    });
  });

  return groups;
}

function schemaFields(schema, spec) {
  if (!schema) return [];
  if (schema.$ref) return schemaFields(spec.components?.schemas?.[refName(schema.$ref)], spec);
  if (schema.oneOf) return schema.oneOf.map((item) => schemaName(item)).filter(Boolean);
  if (schema.items) return [`items: ${schemaName(schema.items)}`];
  if (schema.enum) return [`enum: ${schema.enum.join(', ')}`];

  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, property]) => {
    const mark = required.has(name) ? '*' : '';
    const desc = property.description ? ` - ${property.description}` : '';
    const enumText = property.enum ? ` [${property.enum.join(', ')}]` : '';
    return `${name}${mark}: ${schemaName(property)}${enumText}${desc}`;
  });
}

function makeSchemaCardText(name, schema, spec) {
  const lines = [`# ${name}`, ''];
  const fields = schemaFields(schema, spec);

  if (schema.description) {
    lines.push(schema.description.trim(), '');
  }
  if (schema.required?.length) {
    lines.push(`required: ${schema.required.join(', ')}`, '');
  }
  if (fields.length) {
    fields.forEach((field) => lines.push(`- ${field}`));
  } else {
    lines.push('- без полей');
  }

  return lines.join('\n');
}

function node(nodes, data) {
  nodes.push(data);
  return data;
}

function edge(edges, id, fromNode, toNode, fromSide = 'right', toSide = 'left') {
  edges.push({ id, fromNode, toNode, fromSide, toSide });
}

function operationText(operation) {
  const lines = [
    `# ${operation.endpoint}`,
    '',
    operation.summary,
    '',
    `operationId: \`${operation.operationId}\``,
    `auth: \`${operation.auth}\``,
    `parameters: ${operation.parameters}`,
    `request: ${operation.request}${operation.requestRequired ? ' (required)' : ''}`,
    '',
    'responses:',
    operation.responses || 'нет'
  ];

  if (operation.description) {
    lines.splice(3, 0, operation.description.trim(), '');
  }

  return lines.join('\n');
}

function makeCanvas(spec) {
  const groups = collectGroups(spec);
  const nodes = [];
  const edges = [];
  let edgeIndex = 1;

  node(nodes, {
    id: 'title',
    type: 'text',
    x: 0,
    y: -520,
    width: 980,
    height: 260,
    color: '#111827',
    text: `# API сервера хранения и плееров\n\nИсточник: \`storage-player-openapi.yaml\`\n\n${spec.info?.summary || ''}\n\nВажно: это API только для сервера хранения/плееров. Портальные карточки, CIDOC CRM, Dublin Core, КАМИС, Госкаталог и ЕГРОКН сюда не входят.`
  });

  node(nodes, {
    id: 'legend',
    type: 'text',
    x: 1040,
    y: -520,
    width: 620,
    height: 260,
    color: '#f8fafc',
    text: [
      '# Цвет методов',
      '',
      '- GET - синий, получение данных',
      '- POST - зеленый, создание/запуск операции',
      '- PUT - оранжевый, сохранение целиком',
      '- DELETE - красный, удаление',
      '',
      'Цветные маленькие карточки рядом с endpoint играют роль Swagger-бейджа метода.'
    ].join('\n')
  });

  const orderedNames = [
    ...GROUP_ORDER.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !GROUP_ORDER.includes(name)).sort()
  ];

  const groupHeaderIds = {};
  const endpointNodeIds = {};
  const columnWidth = 560;
  const startY = 0;
  const columns = [
    { x: 0, groups: ['Upload'] },
    { x: 640, groups: ['Assets'] },
    { x: 1280, groups: ['Processing'] },
    { x: 1920, groups: ['Preview', 'POI', 'Download'] },
    { x: 2560, groups: ['Embed', 'Webhooks'] }
  ];

  orderedNames.forEach((name) => {
    const column = columns.find((candidate) => candidate.groups.includes(name));
    const x = column ? column.x : 0;
    const groupIndexInColumn = column ? column.groups.indexOf(name) : 0;
    const previousGroups = column ? column.groups.slice(0, groupIndexInColumn) : [];
    const previousHeight = previousGroups.reduce((sum, groupName) => {
      const count = groups.get(groupName)?.length || 0;
      return sum + 92 + count * 250 + 96;
    }, 0);
    const y = startY + previousHeight;
    const operations = groups.get(name) || [];

    const headerId = `group-${name.toLowerCase()}`;
    groupHeaderIds[name] = headerId;
    node(nodes, {
      id: headerId,
      type: 'text',
      x,
      y,
      width: columnWidth,
      height: 82,
      color: GROUP_COLORS[name] || '#f8fafc',
      text: `# ${name}\n\n${spec.tags?.find((tag) => tag.name === name)?.description || `${operations.length} endpoints`}`
    });

    operations.forEach((operation, index) => {
      const methodId = `method-${name.toLowerCase()}-${index + 1}`;
      const endpointId = `endpoint-${name.toLowerCase()}-${index + 1}`;
      const cardY = y + 112 + index * 250;
      endpointNodeIds[`${operation.method} ${operation.endpoint}`] = endpointId;

      node(nodes, {
        id: endpointId,
        type: 'text',
        x,
        y: cardY,
        width: columnWidth,
        height: 220,
        color: '#111827',
        text: `\n\n\n${operationText(operation)}`
      });

      node(nodes, {
        id: methodId,
        type: 'text',
        x: x + 12,
        y: cardY + 12,
        width: 168,
        height: 58,
        color: METHOD_COLORS[operation.method] || '#64748b',
        text: `# ${operation.method}`
      });

      if (index === 0) edge(edges, `edge-group-${edgeIndex++}`, headerId, endpointId, 'bottom', 'top');
    });
  });

  const flowEdges = [
    ['group-upload', 'group-assets'],
    ['group-assets', 'group-processing'],
    ['group-processing', 'group-preview'],
    ['group-assets', 'group-poi'],
    ['group-assets', 'group-download'],
    ['group-processing', 'group-embed'],
    ['group-processing', 'group-webhooks']
  ];
  flowEdges.forEach(([from, to]) => {
    if (nodes.some((n) => n.id === from) && nodes.some((n) => n.id === to)) {
      edge(edges, `edge-flow-${edgeIndex++}`, from, to);
    }
  });

  const referenceY = 1500;
  node(nodes, {
    id: 'embed-options',
    type: 'text',
    x: 0,
    y: referenceY,
    width: 620,
    height: 580,
    color: '#e0e7ff',
    text: [
      '# Embed параметры PlayCanvas',
      '',
      '`POST /storage/v1/embed` собирает `iframeUrl` и `iframeHtml`.',
      '',
      '- `load` / `assetUrl` - URL файла модели',
      '- `embed=1` - iframe-режим',
      '- `ui=full|compact|minimal` - пресет интерфейса',
      '- `lang=ru|en|zh` - язык',
      '- `autoplay=0|1` - автозапуск',
      '- `panel=0|1` - боковая панель',
      '- `poi=0|1` - точки интереса',
      '- `tour=0|1` - навигация по точкам',
      '- `measure=0|1` - измерения',
      '- `info=0|1` - информационные элементы',
      '- `modelInfo=0|1` - техническая информация',
      '- `controls=0|1` - кнопки управления',
      '- `fullscreen=0|1` - полноэкранный режим',
      '- `fit=0|1` - вписать модель',
      '- `reset=0|1` - сброс камеры',
      '- `cameraPosition=x,y,z` - позиция камеры',
      '- `cameraFocus=x,y,z` - точка фокуса'
    ].join('\n')
  });

  node(nodes, {
    id: 'postmessage-api',
    type: 'text',
    x: 680,
    y: referenceY,
    width: 620,
    height: 580,
    color: '#fef3c7',
    text: [
      '# window.postMessage API',
      '',
      'Команды от страницы сайта во viewer:',
      '',
      '- `focus-poi` - перейти к POI по `id`',
      '- `open-poi` - открыть POI, сейчас как `focus-poi`',
      '- `clear-poi` - снять активную точку',
      '- `next-poi` - следующая точка',
      '- `prev-poi` - предыдущая точка',
      '- `seek-animation` - перейти к времени/кадру',
      '- `play-animation` - запустить анимацию',
      '- `pause-animation` - остановить анимацию',
      '- `freeze-animation` - зафиксировать кадр',
      '',
      'События от viewer:',
      '',
      '- `poi-selected`',
      '- `poi-cleared`',
      '- `animation-time`'
    ].join('\n')
  });

  node(nodes, {
    id: 'enums-statuses',
    type: 'text',
    x: 1360,
    y: referenceY,
    width: 620,
    height: 580,
    color: '#dcfce7',
    text: [
      '# Enums и статусы',
      '',
      `AssetKind: ${(spec.components.schemas.AssetKind.enum || []).join(', ')}`,
      '',
      `AssetFormat: ${(spec.components.schemas.AssetFormat.enum || []).join(', ')}`,
      '',
      `PlayerType: ${(spec.components.schemas.PlayerType.enum || []).join(', ')}`,
      '',
      `StorageClass: ${(spec.components.schemas.StorageClass.enum || []).join(', ')}`,
      '',
      `StorageAssetStatus: ${(spec.components.schemas.StorageAssetStatus.enum || []).join(', ')}`
    ].join('\n')
  });

  node(nodes, {
    id: 'security-scope',
    type: 'text',
    x: 2040,
    y: referenceY,
    width: 620,
    height: 580,
    color: '#fee2e2',
    text: [
      '# Security и границы API',
      '',
      'HTTP API защищен сервисным токеном портала:',
      '',
      '- `serviceBearerAuth` - Bearer JWT между порталом и сервером хранения',
      '- `webhookSignature` - подпись webhook через `X-H3D-Signature`',
      '',
      'Что не входит в этот API:',
      '',
      '- карточка культурного объекта',
      '- CIDOC CRM',
      '- Dublin Core',
      '- КАМИС / Госкаталог / ЕГРОКН',
      '- каталог сайта',
      '- портальная модерация',
      '- пользовательские роли портала',
      '- выбор активного цифрового двойника'
    ].join('\n')
  });

  const schemaStartY = 2160;
  const schemaCardWidth = 620;
  SELECTED_SCHEMAS.forEach((name, index) => {
    const schema = spec.components?.schemas?.[name];
    if (!schema) return;
    const col = index % 3;
    const row = Math.floor(index / 3);
    const fieldsCount = schemaFields(schema, spec).length;
    node(nodes, {
      id: `schema-${name}`,
      type: 'text',
      x: col * 680,
      y: schemaStartY + row * 560,
      width: schemaCardWidth,
      height: Math.max(360, Math.min(520, 140 + fieldsCount * 28)),
      color: '#f8fafc',
      text: makeSchemaCardText(name, schema, spec)
    });
  });

  return { nodes, edges };
}

const input = process.argv[2] || 'docs/api/storage-player-openapi.yaml';
const output = process.argv[3] || 'docs/api/obsidian/storage-player-api.canvas';
const spec = readSpec(input);
const canvas = makeCanvas(spec);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(canvas, null, 2)}\n`);

console.log(`Exported ${canvas.nodes.length} nodes and ${canvas.edges.length} edges to ${output}`);
