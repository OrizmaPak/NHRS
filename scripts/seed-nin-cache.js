const { MongoClient, ServerApiVersion } = require('mongodb');

const clusterUri = process.env.IDENTITY_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.AUTH_DB_NAME || process.env.DB_NAME || 'nhrs_auth_db';

if (!clusterUri) {
  throw new Error('Missing IDENTITY_MONGODB_URI or MONGODB_URI');
}

const genders = ['M', 'F'];
const firstNames = ['Amina', 'Chinedu', 'Fatima', 'Tunde', 'Blessing', 'Ibrahim', 'Kelechi', 'Zainab', 'Emeka', 'Hauwa'];
const lastNames = ['Okafor', 'Adeyemi', 'Ibrahim', 'Balogun', 'Okeke', 'Mohammed', 'Eze', 'Yakubu', 'Olawale', 'Bello'];
const otherNames = ['James', 'Grace', 'Maryam', 'David', 'Sofia', 'Samuel', 'Joy', 'Daniel', 'Esther', 'Ahmed'];

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function makeDob(i) {
  const day = 1 + (i % 28);
  const month = 1 + (i % 12);
  const year = 1985 + (i % 20);
  return `${pad(day, 2)}${pad(month, 2)}${year}`;
}

function makeNin(i) {
  return `9${pad(i + 1, 10)}`;
}

function makePhone(i) {
  return `080${pad(i + 1, 8)}`;
}

function makeEmail(i) {
  return `citizen${pad(i + 1, 3)}@example.com`;
}

async function main() {
  const client = new MongoClient(clusterUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  const db = client.db(dbName);
  const col = db.collection('nin_cache');

  const docs = Array.from({ length: 100 }, (_, i) => {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const otherName = otherNames[i % otherNames.length];

    return {
      nin: makeNin(i),
      firstName,
      lastName,
      otherName,
      dob: makeDob(i),
      gender: genders[i % 2],
      phone: makePhone(i),
      email: makeEmail(i),
      lastFetchedAt: new Date(),
      lastRefreshedAt: null,
      refreshRequested: false,
      source: 'seed',
      version: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  await col.createIndex({ nin: 1 }, { unique: true });
  await col.deleteMany({ source: 'seed' });
  await col.insertMany(docs, { ordered: true });

  console.log(`Seeded nin_cache in ${dbName} with ${docs.length} records.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
