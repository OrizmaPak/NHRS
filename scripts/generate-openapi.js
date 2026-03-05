const fs = require('fs');
const path = require('path');

const outFile = process.argv[2] || 'docs/openapi.json';
const apiUrl = process.env.API_URL || '';

async function main() {
  let spec = null;

  if (apiUrl) {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI from ${apiUrl}: ${response.status} ${response.statusText}`);
    }
    spec = await response.text();
  } else {
    const { buildApp } = require('../services/core-platform/api-gateway/src/server');
    const app = await buildApp({ registerRoutes: true, resetState: true });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    if (response.statusCode !== 200) {
      await app.close();
      throw new Error(`Failed to generate OpenAPI via gateway buildApp: ${response.statusCode}`);
    }
    spec = response.body;
    await app.close();
  }
  const target = path.resolve(outFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, spec, 'utf8');
  console.log(`OpenAPI spec saved to ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
