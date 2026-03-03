const fs = require('fs');
const path = require('path');

const outFile = process.argv[2] || 'docs/openapi.json';
const apiUrl = process.env.API_URL || 'http://localhost/openapi.json';

async function main() {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI from ${apiUrl}: ${response.status} ${response.statusText}`);
  }

  const spec = await response.text();
  const target = path.resolve(outFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, spec, 'utf8');
  console.log(`OpenAPI spec saved to ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
