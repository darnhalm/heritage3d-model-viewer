const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function readSpec(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return yaml.load(source);
}

function collectEndpoints(spec) {
  const rows = [];

  Object.entries(spec.paths ?? {}).forEach(([endpoint, pathItem]) => {
    METHODS.forEach((method) => {
      const operation = pathItem?.[method];
      if (!operation) return;

      rows.push({
        block: operation.tags?.[0] || 'Other',
        method: method.toUpperCase(),
        endpoint,
        description: operation.summary || operation.description || operation.operationId || '',
        operationId: operation.operationId || '',
        auth: operation.security ? Object.keys(operation.security[0] || {}).join(', ') : ''
      });
    });
  });

  return rows;
}

function writeCsv(rows, filePath) {
  const header = ['Block', 'Method', 'Endpoint', 'Description', 'OperationId', 'Auth'];
  const lines = [
    header.map(csvCell).join(','),
    ...rows.map((row) => [
      row.block,
      row.method,
      row.endpoint,
      row.description,
      row.operationId,
      row.auth
    ].map(csvCell).join(','))
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function writeMarkdown(rows, spec, filePath) {
  const byBlock = new Map();
  rows.forEach((row) => {
    if (!byBlock.has(row.block)) byBlock.set(row.block, []);
    byBlock.get(row.block).push(row);
  });

  const lines = [
    `# ${spec.info?.title || 'OpenAPI endpoints'}`,
    '',
    `Источник: \`${path.basename(process.argv[2])}\``,
    '',
    `Всего endpoints: ${rows.length}`,
    ''
  ];

  byBlock.forEach((blockRows, block) => {
    lines.push(`## ${block}`, '');
    blockRows.forEach((row) => {
      lines.push(`- \`${row.method}\` \`${row.endpoint}\` — ${row.description}`);
    });
    lines.push('');
  });

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const input = process.argv[2] || 'docs/api/storage-player-openapi.yaml';
const outputDir = process.argv[3] || 'docs/api/miro-import';
const spec = readSpec(input);
const rows = collectEndpoints(spec);

fs.mkdirSync(outputDir, { recursive: true });
writeCsv(rows, path.join(outputDir, 'storage-player-endpoints.csv'));
writeMarkdown(rows, spec, path.join(outputDir, 'storage-player-endpoints.md'));

console.log(`Exported ${rows.length} endpoints to ${outputDir}`);
