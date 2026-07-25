const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

const METHOD_COLORS = {
  get: '#2563eb',
  post: '#16a34a',
  put: '#d97706',
  patch: '#7c3aed',
  delete: '#dc2626',
  head: '#475569',
  options: '#0891b2',
  trace: '#64748b'
};

const $ = (id) => document.getElementById(id);

function setStatus(message) {
  $('status').textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseSpec(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('OpenAPI YAML/JSON пустой.');
  }

  const spec = jsyaml.load(trimmed);
  if (!spec || typeof spec !== 'object') {
    throw new Error('Не удалось прочитать OpenAPI.');
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    throw new Error('В OpenAPI не найден раздел paths.');
  }

  return spec;
}

function collectOperations(spec) {
  const declaredTags = Array.isArray(spec.tags) ? spec.tags.map((tag) => tag.name).filter(Boolean) : [];
  const groups = new Map();

  declaredTags.forEach((tagName) => {
    groups.set(tagName, {
      name: tagName,
      description: spec.tags.find((tag) => tag.name === tagName)?.description || '',
      operations: []
    });
  });

  Object.entries(spec.paths).forEach(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') return;

    METHODS.forEach((method) => {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') return;

      const tagName = Array.isArray(operation.tags) && operation.tags[0] ? operation.tags[0] : 'Other';
      if (!groups.has(tagName)) {
        groups.set(tagName, { name: tagName, description: '', operations: [] });
      }

      groups.get(tagName).operations.push({
        method: method.toUpperCase(),
        methodKey: method,
        path,
        summary: operation.summary || operation.operationId || '',
        operationId: operation.operationId || ''
      });
    });
  });

  return [...groups.values()].filter((group) => group.operations.length > 0);
}

function collectSchemas(spec) {
  const schemas = spec.components?.schemas;
  if (!schemas || typeof schemas !== 'object') return [];
  return Object.keys(schemas).sort();
}

function requireMiro() {
  if (!window.miro?.board) {
    throw new Error('Miro SDK недоступен. Открой это приложение внутри Miro board.');
  }
}

async function createShape({ x, y, width, height, content, fillColor, borderColor = '#d8dee8', textColor = '#17202a', fontSize = 14 }) {
  return miro.board.createShape({
    x,
    y,
    width,
    height,
    shape: 'rectangle',
    content,
    style: {
      fillColor,
      borderColor,
      borderWidth: 1,
      color: textColor,
      fontSize,
      textAlign: 'left'
    }
  });
}

async function drawOpenApiMap(spec, options) {
  requireMiro();

  const groups = collectOperations(spec);
  if (groups.length === 0) {
    throw new Error('В спецификации не найдено ни одного endpoint.');
  }

  const created = [];
  const columnWidth = 430;
  const gap = 90;
  const startX = 0;
  const startY = 0;
  const cardHeight = 82;
  const cardGap = 14;
  const headerHeight = 92;

  const title = await createShape({
    x: startX + ((groups.length - 1) * (columnWidth + gap)) / 2,
    y: startY - 160,
    width: Math.min(760, groups.length * columnWidth),
    height: 80,
    fillColor: '#111827',
    borderColor: '#111827',
    textColor: '#ffffff',
    fontSize: 18,
    content: `<strong>${escapeHtml(spec.info?.title || 'OpenAPI')}</strong><br/>${escapeHtml(spec.info?.version ? `version ${spec.info.version}` : '')}`
  });
  created.push(title);

  const headers = [];

  for (const [groupIndex, group] of groups.entries()) {
    const x = startX + groupIndex * (columnWidth + gap);
    const y = startY;
    const color = ['#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe', '#fee2e2', '#cffafe', '#e2e8f0'][groupIndex % 7];

    const header = await createShape({
      x,
      y,
      width: columnWidth,
      height: headerHeight,
      fillColor: color,
      borderColor: '#94a3b8',
      fontSize: 18,
      content: `<strong>${escapeHtml(group.name)}</strong><br/><span>${escapeHtml(group.description || `${group.operations.length} endpoints`)}</span>`
    });
    created.push(header);
    headers.push(header);

    for (const [operationIndex, operation] of group.operations.entries()) {
      const methodColor = METHOD_COLORS[operation.methodKey] || '#475569';
      const card = await createShape({
        x,
        y: y + headerHeight + 34 + operationIndex * (cardHeight + cardGap),
        width: columnWidth,
        height: cardHeight,
        fillColor: '#ffffff',
        borderColor: methodColor,
        fontSize: 13,
        content: `<strong><span style="color:${methodColor}">${operation.method}</span> ${escapeHtml(operation.path)}</strong><br/>${escapeHtml(operation.summary)}`
      });
      created.push(card);
    }
  }

  if (options.drawConnectors) {
    for (let i = 0; i < headers.length - 1; i += 1) {
      const connector = await miro.board.createConnector({
        start: { item: headers[i].id },
        end: { item: headers[i + 1].id },
        style: {
          strokeColor: '#64748b',
          strokeWidth: 2
        }
      });
      created.push(connector);
    }
  }

  if (options.drawSchemas) {
    const schemas = collectSchemas(spec);
    if (schemas.length > 0) {
      const x = startX;
      const y = startY + Math.max(...groups.map((group) => headerHeight + 34 + group.operations.length * (cardHeight + cardGap))) + 120;
      const schemaShape = await createShape({
        x,
        y,
        width: Math.min(900, groups.length * columnWidth),
        height: Math.min(520, 80 + schemas.length * 24),
        fillColor: '#f8fafc',
        borderColor: '#94a3b8',
        fontSize: 13,
        content: `<strong>Schemas</strong><br/>${schemas.map(escapeHtml).join('<br/>')}`
      });
      created.push(schemaShape);
    }
  }

  await miro.board.viewport.zoomTo(created);
  return { groups, created };
}

async function loadFromUrl() {
  const url = $('spec-url').value.trim();
  if (!url) {
    setStatus('Укажи URL OpenAPI YAML/JSON.');
    return;
  }

  setStatus('Загружаю OpenAPI...');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить URL: HTTP ${response.status}`);
  }
  const text = await response.text();
  $('spec-text').value = text;
  const spec = parseSpec(text);
  const groups = collectOperations(spec);
  setStatus(`Загружено: ${spec.info?.title || 'OpenAPI'}\nГрупп: ${groups.length}\nEndpoints: ${groups.reduce((sum, group) => sum + group.operations.length, 0)}`);
}

async function draw() {
  const spec = parseSpec($('spec-text').value);
  const result = await drawOpenApiMap(spec, {
    drawConnectors: $('draw-connectors').checked,
    drawSchemas: $('draw-schemas').checked
  });
  setStatus(`Готово.\nГрупп: ${result.groups.length}\nСоздано объектов на доске: ${result.created.length}`);
}

$('load-url').addEventListener('click', () => {
  loadFromUrl().catch((error) => setStatus(error.message));
});

$('draw').addEventListener('click', () => {
  draw().catch((error) => setStatus(error.message));
});
