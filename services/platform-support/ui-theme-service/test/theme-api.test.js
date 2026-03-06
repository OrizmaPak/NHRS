const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.NHRS_CONTEXT_ALLOW_LEGACY = 'true';

const { createApp } = require('../src/server');

function createCollectionStore() {
  const items = [];
  return {
    items,
    createIndex: async () => ({}),
    insertOne: async (doc) => {
      items.push(structuredClone(doc));
      return { acknowledged: true };
    },
    findOne: async (filter = {}, options = {}) => {
      let result = items.filter((doc) => Object.entries(filter).every(([k, v]) => (doc[k] ?? null) === v));
      if (options.sort && options.sort.updatedAt) {
        result = result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      }
      return result[0] ? structuredClone(result[0]) : null;
    },
    find: (filter = {}) => {
      let result = items.filter((doc) => Object.entries(filter).every(([k, v]) => (doc[k] ?? null) === v));
      return {
        sort: () => ({ toArray: async () => structuredClone(result) }),
        toArray: async () => structuredClone(result),
      };
    },
    updateOne: async (filter = {}, update = {}) => {
      const idx = items.findIndex((doc) => Object.entries(filter).every(([k, v]) => (doc[k] ?? null) === v));
      if (idx >= 0 && update.$set) {
        items[idx] = { ...items[idx], ...structuredClone(update.$set) };
      }
      return { acknowledged: true };
    },
  };
}

function makeDb() {
  const stores = { ui_themes: createCollectionStore() };
  return {
    collection(name) {
      if (!stores[name]) stores[name] = createCollectionStore();
      return stores[name];
    },
    __stores: stores,
  };
}

function makeToken(sub, roles = []) {
  return jwt.sign({ sub, roles, type: 'access' }, 'change-me');
}

test('effective theme falls back to platform and resolves inheritance', async () => {
  const db = makeDb();
  const app = createApp({ db, dbReady: true });

  const platform = {
    id: 'platform-theme',
    scope_type: 'platform',
    scope_id: null,
    parent_theme_id: null,
    theme_tokens: { colors: { background: '#ffffff', text: '#111111', primary: '#0055cc' } },
    accessibility_defaults: { highContrastDefault: false },
    updatedBy: 'seed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    version: 1,
  };
  const stateTheme = {
    ...platform,
    id: 'state-theme',
    scope_type: 'state',
    scope_id: 'lagos',
    theme_tokens: { colors: { primary: '#009966' } },
    version: 2,
  };
  const orgTheme = {
    ...platform,
    id: 'org-theme',
    scope_type: 'organization',
    scope_id: 'org-1',
    parent_theme_id: 'state-theme',
    theme_tokens: { colors: { secondary: '#ffcc00' } },
    version: 3,
  };

  db.__stores.ui_themes.items.push(platform, stateTheme, orgTheme);

  const res = await app.inject({ method: 'GET', url: '/ui/theme/effective?scope_type=organization&scope_id=org-1' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.theme.theme_tokens.colors.primary, '#009966');
  assert.equal(body.theme.theme_tokens.colors.secondary, '#ffcc00');
  assert.equal(Array.isArray(body.theme.sources), true);

  await app.close();
});

test('create theme enforces scope ownership', async () => {
  const db = makeDb();
  const app = createApp({ db, dbReady: true });
  const orgAdminToken = makeToken('u-1', ['org_admin']);

  const forbidden = await app.inject({
    method: 'POST',
    url: '/ui/theme',
    headers: { authorization: `Bearer ${orgAdminToken}`, 'x-org-id': 'org-1' },
    payload: {
      scope_type: 'organization',
      scope_id: 'org-2',
      theme_tokens: { colors: { background: '#ffffff', text: '#111111' } },
    },
  });
  assert.equal(forbidden.statusCode, 403);

  const allowed = await app.inject({
    method: 'POST',
    url: '/ui/theme',
    headers: { authorization: `Bearer ${orgAdminToken}`, 'x-org-id': 'org-1' },
    payload: {
      scope_type: 'organization',
      scope_id: 'org-1',
      theme_tokens: { colors: { background: '#ffffff', text: '#111111', primary: '#0044aa' } },
    },
  });
  assert.equal(allowed.statusCode, 201);

  await app.close();
});

test('logo route accepts URL patch and bumps version', async () => {
  const db = makeDb();
  const app = createApp({ db, dbReady: true });
  const token = makeToken('p-1', ['platform_admin']);

  db.__stores.ui_themes.items.push({
    id: 'platform-theme',
    scope_type: 'platform',
    scope_id: null,
    parent_theme_id: null,
    theme_tokens: { logo: {} },
    accessibility_defaults: {},
    updatedBy: 'seed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    version: 1,
  });

  const res = await app.inject({
    method: 'POST',
    url: '/ui/theme/platform-theme/logo',
    headers: { authorization: `Bearer ${token}` },
    payload: { lightUrl: 'https://cdn.example/logo-light.png' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().theme_tokens.logo.lightUrl, 'https://cdn.example/logo-light.png');
  assert.equal(res.json().version, 2);

  await app.close();
});
