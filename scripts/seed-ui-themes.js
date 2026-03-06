const { MongoClient, ServerApiVersion } = require('mongodb');

const mongoUri = process.env.SUPPORT_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.UI_THEME_DB_NAME || process.env.DB_NAME || 'nhrs_ui_theme_db';

if (!mongoUri) {
  throw new Error('Missing SUPPORT_MONGODB_URI or MONGODB_URI');
}

function nowIso() {
  return new Date().toISOString();
}

async function upsertTheme(col, payload) {
  await col.updateOne(
    { scope_type: payload.scope_type, scope_id: payload.scope_id, deletedAt: null },
    {
      $set: {
        ...payload,
        updatedAt: nowIso(),
      },
      $setOnInsert: {
        id: payload.id,
        createdAt: nowIso(),
        version: 1,
        deletedAt: null,
      },
    },
    { upsert: true }
  );
}

async function main() {
  const client = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();

  const db = client.db(dbName);
  const col = db.collection('ui_themes');

  await col.createIndex({ scope_type: 1, scope_id: 1, deletedAt: 1 }, { unique: true });

  const platformThemeId = 'theme-platform-default';
  const stateThemeId = 'theme-state-lagos';

  await upsertTheme(col, {
    id: platformThemeId,
    scope_type: 'platform',
    scope_id: null,
    parent_theme_id: null,
    theme_tokens: {
      colors: {
        primary: '#0B5FFF',
        secondary: '#0A2540',
        accent: '#00B894',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        text: '#111827',
        muted: '#6B7280',
        border: '#D1D5DB',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      typography: {
        fontFamily: 'Inter',
        headingFontFamily: 'Inter',
        baseFontSize: 16,
        lineHeight: 1.5,
      },
      radius: { sm: 4, md: 8, lg: 12 },
      logo: {
        lightUrl: 'https://cdn.example.com/nhrs/platform-logo-light.png',
        darkUrl: 'https://cdn.example.com/nhrs/platform-logo-dark.png',
        markUrl: 'https://cdn.example.com/nhrs/platform-mark.png',
      },
      ui: {
        sidebarStyle: 'solid',
        topbarStyle: 'solid',
      },
    },
    accessibility_defaults: {
      highContrastDefault: false,
      reduceMotionDefault: false,
      dyslexiaFontDefault: false,
      fontScaleDefault: 1.0,
    },
    updatedBy: 'seed-script',
  });

  await upsertTheme(col, {
    id: stateThemeId,
    scope_type: 'state',
    scope_id: 'lagos',
    parent_theme_id: platformThemeId,
    theme_tokens: {
      colors: {
        primary: '#0A7A3F',
        accent: '#22C55E',
      },
      logo: {
        lightUrl: 'https://cdn.example.com/nhrs/lagos-logo-light.png',
      },
    },
    accessibility_defaults: {
      highContrastDefault: true,
      fontScaleDefault: 1.1,
    },
    updatedBy: 'seed-script',
  });

  await upsertTheme(col, {
    id: 'theme-org-sample-hospital',
    scope_type: 'organization',
    scope_id: 'org-sample-hospital',
    parent_theme_id: stateThemeId,
    theme_tokens: {
      colors: {
        primary: '#8B1C62',
        secondary: '#3F124D',
      },
      logo: {
        lightUrl: 'https://cdn.example.com/nhrs/org-hospital-logo-light.png',
        markUrl: 'https://cdn.example.com/nhrs/org-hospital-mark.png',
      },
      typography: {
        headingFontFamily: 'Poppins',
      },
    },
    accessibility_defaults: {
      reduceMotionDefault: true,
      fontScaleDefault: 1.1,
    },
    updatedBy: 'seed-script',
  });

  console.log(`Seeded UI themes in ${dbName}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
