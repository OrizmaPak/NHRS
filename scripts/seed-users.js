const { MongoClient, ServerApiVersion } = require('mongodb');

const clusterUri = process.env.IDENTITY_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.AUTH_DB_NAME || process.env.DB_NAME || 'nhrs_auth_db';
const userCount = Number(process.env.SEED_USER_COUNT || 20);

if (!clusterUri) {
  throw new Error('Missing IDENTITY_MONGODB_URI or MONGODB_URI');
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function makeNin(i) {
  return `9${pad(i + 1, 10)}`;
}

function makeEmail(i) {
  return `citizen${pad(i + 1, 3)}@example.com`;
}

function makePhone(i) {
  return `080${pad(i + 1, 8)}`;
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
  const users = db.collection('users');
  const ninCache = db.collection('nin_cache');

  const now = new Date();
  let created = 0;
  let updated = 0;

  for (let i = 0; i < userCount; i += 1) {
    const nin = makeNin(i);
    const ninProfile = await ninCache.findOne({ nin });
    const firstName = String(ninProfile?.firstName || `Citizen${pad(i + 1, 3)}`);
    const lastName = String(ninProfile?.lastName || 'User');
    const email = String(ninProfile?.email || makeEmail(i)).toLowerCase();
    const phone = String(ninProfile?.phone || makePhone(i));

    const result = await users.updateOne(
      { nin },
      {
        $set: {
          email,
          phone,
          phoneVerified: true,
          emailVerified: true,
          passwordHash: null,
          passwordSetAt: null,
          requiresPasswordChange: true,
          roles: ['citizen'],
          status: 'active',
          failedLoginAttempts: 0,
          lockUntil: null,
          lastFailedLoginAt: null,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          updatedAt: now,
        },
        $setOnInsert: {
          nin,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) created += 1;
    if (result.modifiedCount > 0) updated += 1;
  }

  // Ensure any existing superadmin-like account displays the requested name.
  await users.updateMany(
    {
      roles: {
        $elemMatch: {
          $in: ['superadmin', 'super_admin', 'platform_admin', 'app_admin', 'admin'],
        },
      },
    },
    {
      $set: {
        firstName: 'Super',
        lastName: 'Admin',
        fullName: 'Super Admin',
        updatedAt: now,
      },
    },
  );

  console.log(`Seeded ${userCount} users in ${dbName}. created=${created}, updated=${updated}.`);
  console.log('Login method: nin. Bootstrap password is each user DOB from nin_cache (DDMMYYYY).');
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
