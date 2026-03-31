import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), '..', relativePath), 'utf8');
}

function extractMatches(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => String(match[1] || '').trim()).filter(Boolean);
}

describe('permission catalog consistency', () => {
  const interfaceText = readFile('frontend-app/src/lib/interfacePermissions.ts');
  const navigationText = readFile('frontend-app/src/routes/navigation.ts');
  const routerText = readFile('frontend-app/src/routes/router.tsx');
  const registryText = readFile('services/core-platform/api-gateway/src/permissions/registry.js');
  const rbacText = readFile('services/governance/rbac-service/src/server.js');

  const systemKeys = new Set(extractMatches(rbacText, /\{ key: '([^']+)', [^\n]*scope: '(app|org)'/g));

  it('covers every interface permission key in the RBAC catalog', () => {
    const interfaceKeys = new Set(extractMatches(interfaceText, /makeEntry\('([^']+)'/g));
    const missing = [...interfaceKeys].filter((key) => !systemKeys.has(key) && key !== 'superadmin.only');
    expect(missing).toEqual([]);
  });

  it('covers every navigation permission key in the RBAC catalog', () => {
    const navKeys = new Set<string>();
    for (const match of navigationText.matchAll(/permission:\s*(\[[^\]]+\]|'[^']+')/g)) {
      const raw = String(match[1] || '');
      const values = raw.startsWith('[')
        ? extractMatches(raw, /'([^']+)'/g)
        : [raw.slice(1, -1)];
      for (const value of values) navKeys.add(value);
    }
    const missing = [...navKeys].filter((key) => !systemKeys.has(key) && key !== 'superadmin.only');
    expect(missing).toEqual([]);
  });

  it('covers every route-gated permission key in the RBAC catalog', () => {
    const routeKeys = new Set<string>();
    for (const match of routerText.matchAll(/(?:restricted|contextRestricted|careContextRestricted)\([^,]+,\s*(\[[^\]]+\]|'[^']+')/g)) {
      const raw = String(match[1] || '');
      const values = raw.startsWith('[')
        ? extractMatches(raw, /'([^']+)'/g)
        : [raw.slice(1, -1)];
      for (const value of values) routeKeys.add(value);
    }
    const missing = [...routeKeys].filter((key) => !systemKeys.has(key) && key !== 'superadmin.only');
    expect(missing).toEqual([]);
  });

  it('covers every gateway-enforced permission key in the RBAC catalog', () => {
    const registryKeys = new Set(extractMatches(registryText, /permissionKey:\s*'([^']+)'/g));
    const permissionAnyOfKeys = extractMatches(registryText, /permissionAnyOf:\s*\[([^\]]+)\]/g)
      .flatMap((raw) => extractMatches(raw, /'([^']+)'/g));
    for (const key of permissionAnyOfKeys) {
      registryKeys.add(key);
    }
    const missing = [...registryKeys].filter((key) => !systemKeys.has(key));
    expect(missing).toEqual([]);
  });
});
