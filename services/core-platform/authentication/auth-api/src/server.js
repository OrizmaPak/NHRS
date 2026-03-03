const fastify = require('fastify')({ logger: true });
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const serviceName = 'auth-api';
const port = Number(process.env.PORT) || 8081;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_auth_db';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';

const accessTtlSec = 15 * 60;
const refreshTtlSec = 7 * 24 * 60 * 60;
const otpTtlMs = 10 * 60 * 1000;

let dbReady = false;
let redisReady = false;
let mongoClient;
let redisClient;
let db;

const collections = {
  ninCache: () => db.collection('nin_cache'),
  users: () => db.collection('users'),
  roles: () => db.collection('roles'),
  otp: () => db.collection('otp_codes'),
  sessions: () => db.collection('sessions'),
};

function toObjectIdOrNull(value) {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }
  return new ObjectId(value);
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      nin: user.nin,
      roles: user.roles || ['citizen'],
      type: 'access',
    },
    jwtSecret,
    { expiresIn: accessTtlSec }
  );
}

function signRefreshToken(userId, jti) {
  return jwt.sign(
    {
      sub: String(userId),
      jti,
      type: 'refresh',
    },
    jwtSecret,
    { expiresIn: refreshTtlSec }
  );
}

async function getRolePermissions(roleNames) {
  const roles = await collections
    .roles()
    .find({ name: { $in: roleNames || [] } })
    .toArray();

  return Array.from(
    new Set(
      roles.flatMap((role) => (Array.isArray(role.permissions) ? role.permissions : []))
    )
  );
}

async function issueSessionAndTokens(user, meta = {}) {
  const jti = crypto.randomUUID();
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user._id, jti);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + refreshTtlSec * 1000);

  await collections.sessions().insertOne({
    userId: user._id,
    jti,
    issuedAt: now,
    expiresAt,
    revokedAt: null,
    deviceMeta: {
      ip: meta.ip || null,
      userAgent: meta.userAgent || null,
    },
  });

  await redisClient.set(
    `refresh:${jti}`,
    JSON.stringify({ userId: String(user._id), revoked: false }),
    { EX: refreshTtlSec }
  );

  return { accessToken, refreshToken, expiresIn: accessTtlSec, jti };
}

function toUserResponse(user, scope = []) {
  return {
    id: String(user._id),
    nin: user.nin,
    email: user.email || null,
    phone: user.phone || null,
    phoneVerified: !!user.phoneVerified,
    emailVerified: !!user.emailVerified,
    roles: user.roles || ['citizen'],
    status: user.status || 'active',
    requiresPasswordChange: !!user.requiresPasswordChange,
    passwordSetAt: user.passwordSetAt || null,
    scope,
  };
}

async function requireAuth(req, reply) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const payload = jwt.verify(token, jwtSecret);
    if (payload.type !== 'access') {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const user = await collections.users().findOne({ _id: new ObjectId(payload.sub) });
    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    req.user = user;
    req.tokenPayload = payload;
  } catch (err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireAdmin(req, reply) {
  if (!req.user || !Array.isArray(req.user.roles) || !req.user.roles.includes('admin')) {
    return reply.code(403).send({ message: 'Admin role required' });
  }
}

async function connect() {
  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI');
  }

  mongoClient = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await mongoClient.connect();
  db = mongoClient.db(dbName);
  await db.command({ ping: 1 });

  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (err) => fastify.log.error({ err }, 'Redis client error'));
  await redisClient.connect();

  await Promise.all([
    collections.ninCache().createIndex({ nin: 1 }, { unique: true }),
    collections.users().createIndex({ nin: 1 }, { unique: true }),
    collections.users().createIndex({ email: 1 }, { sparse: true }),
    collections.users().createIndex({ phone: 1 }, { sparse: true }),
    collections.roles().createIndex({ name: 1 }, { unique: true }),
    collections.otp().createIndex({ destination: 1, channel: 1, status: 1 }),
    collections.sessions().createIndex({ jti: 1 }, { unique: true }),
  ]);

  await collections.roles().updateOne(
    { name: 'citizen' },
    { $setOnInsert: { name: 'citizen', permissions: ['profile:read:self'] } },
    { upsert: true }
  );

  await collections.roles().updateOne(
    { name: 'admin' },
    {
      $setOnInsert: {
        name: 'admin',
        permissions: ['rbac:manage', 'rbac:assign', 'rbac:read', 'nin:read', 'nin:refresh'],
      },
    },
    { upsert: true }
  );

  dbReady = true;
  redisReady = true;
  fastify.log.info({ dbName, redisUrl }, 'auth-api dependencies connected');
}

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  redisReady,
  dbName,
}));

fastify.post('/login', async (req, reply) => {
  const { method, nin, email, phone, password } = req.body || {};

  if (!method || !password) {
    return reply.code(400).send({ message: 'method and password are required' });
  }

  if (method === 'nin') {
    if (!nin || !/^\d{11}$/.test(nin)) {
      return reply.code(400).send({ message: 'nin must be 11 digits' });
    }

    const ninCache = await collections.ninCache().findOne({ nin, isActive: { $ne: false } });
    if (!ninCache) {
      return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
    }

    let user = await collections.users().findOne({ nin });
    if (!user) {
      const insertResult = await collections.users().insertOne({
        nin,
        email: null,
        phone: null,
        passwordHash: null,
        passwordSetAt: null,
        requiresPasswordChange: true,
        phoneVerified: false,
        emailVerified: false,
        roles: ['citizen'],
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      user = await collections.users().findOne({ _id: insertResult.insertedId });
    }

    if (!user.passwordHash) {
      if (password !== ninCache.dob) {
        return reply.code(401).send({ message: 'Invalid credentials' });
      }

      await collections.users().updateOne(
        { _id: user._id },
        { $set: { requiresPasswordChange: true, updatedAt: new Date() } }
      );

      const tokenBundle = await issueSessionAndTokens(user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const scope = await getRolePermissions(user.roles || ['citizen']);

      return reply.send({
        ...tokenBundle,
        requiresPasswordChange: true,
        user: toUserResponse({ ...user, requiresPasswordChange: true }, scope),
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const tokenBundle = await issueSessionAndTokens(user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const scope = await getRolePermissions(user.roles || ['citizen']);

    return reply.send({
      ...tokenBundle,
      requiresPasswordChange: !!user.requiresPasswordChange,
      user: toUserResponse(user, scope),
    });
  }

  if (method === 'phone') {
    if (!phone) {
      return reply.code(400).send({ message: 'phone is required' });
    }

    const user = await collections.users().findOne({ phone });
    if (!user || !user.phone) {
      return reply
        .code(403)
        .send({ message: 'Phone login not enabled. Please login with NIN first and set your phone number.' });
    }

    if (!user.passwordHash) {
      return reply
        .code(403)
        .send({ message: 'Please login with NIN and set a password before using phone login.' });
    }
    if (user.requiresPasswordChange) {
      return reply
        .code(403)
        .send({ message: 'Please login with NIN and set a password before using phone login.' });
    }

    if (!user.phoneVerified) {
      return reply.code(403).send({ message: 'Phone login not enabled until phone number is verified.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const tokenBundle = await issueSessionAndTokens(user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const scope = await getRolePermissions(user.roles || ['citizen']);

    return reply.send({
      ...tokenBundle,
      requiresPasswordChange: !!user.requiresPasswordChange,
      user: toUserResponse(user, scope),
    });
  }

  if (method === 'email') {
    if (!email) {
      return reply.code(400).send({ message: 'email is required' });
    }

    const user = await collections.users().findOne({ email: String(email).toLowerCase() });
    if (!user || !user.email) {
      return reply
        .code(403)
        .send({ message: 'Email login not enabled. Please login with NIN first and set your email.' });
    }

    if (!user.passwordHash) {
      return reply
        .code(403)
        .send({ message: 'Please login with NIN and set a password before using email login.' });
    }
    if (user.requiresPasswordChange) {
      return reply
        .code(403)
        .send({ message: 'Please login with NIN and set a password before using email login.' });
    }

    if (!user.emailVerified) {
      return reply.code(403).send({ message: 'Email login not enabled until email is verified.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const tokenBundle = await issueSessionAndTokens(user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const scope = await getRolePermissions(user.roles || ['citizen']);

    return reply.send({
      ...tokenBundle,
      requiresPasswordChange: !!user.requiresPasswordChange,
      user: toUserResponse(user, scope),
    });
  }

  return reply.code(400).send({ message: 'Unsupported login method' });
});

fastify.post('/password/set', { preHandler: requireAuth }, async (req, reply) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return reply.code(400).send({ message: 'newPassword must be at least 8 characters' });
  }

  if (req.user.passwordHash && !req.user.requiresPasswordChange) {
    return reply.code(400).send({ message: 'Password already set. Use /auth/password/change.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await collections.users().updateOne(
    { _id: req.user._id },
    {
      $set: {
        passwordHash,
        passwordSetAt: new Date(),
        requiresPasswordChange: false,
        updatedAt: new Date(),
      },
    }
  );

  return reply.send({ message: 'Password set successfully' });
});

fastify.post('/password/change', { preHandler: requireAuth }, async (req, reply) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return reply.code(400).send({ message: 'currentPassword and newPassword(min 8) are required' });
  }

  if (!req.user.passwordHash) {
    return reply.code(400).send({ message: 'Password is not set yet. Use /auth/password/set.' });
  }

  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) {
    return reply.code(401).send({ message: 'Invalid credentials' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await collections.users().updateOne(
    { _id: req.user._id },
    {
      $set: {
        passwordHash,
        passwordSetAt: new Date(),
        requiresPasswordChange: false,
        updatedAt: new Date(),
      },
    }
  );

  return reply.send({ message: 'Password changed successfully' });
});

fastify.post('/password/forgot', async (req, reply) => {
  const { channel, destination } = req.body || {};
  if (!channel || !destination || !['phone', 'email'].includes(channel)) {
    return reply.code(400).send({ message: 'channel(phone|email) and destination are required' });
  }

  let user;
  if (channel === 'phone') {
    user = await collections.users().findOne({ phone: destination, phoneVerified: true });
  } else {
    user = await collections.users().findOne({ email: String(destination).toLowerCase(), emailVerified: true });
  }

  if (!user) {
    if (channel === 'phone') {
      return reply.code(403).send({ message: 'Phone recovery not available for this account.' });
    }
    return reply.code(403).send({ message: 'Email recovery not available for this account.' });
  }

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const now = new Date();

  await collections.otp().insertOne({
    userId: user._id,
    channel,
    destination,
    codeHash,
    status: 'pending',
    expiresAt: new Date(now.getTime() + otpTtlMs),
    attempts: 0,
    purpose: 'password_reset',
    createdAt: now,
  });

  fastify.log.info({ channel, destination, code }, 'OTP generated for password/forgot');

  return reply.send({ message: 'OTP sent', channel, destination });
});

fastify.post('/password/reset', async (req, reply) => {
  const { channel, destination, code, newPassword } = req.body || {};
  if (!channel || !destination || !code || !newPassword || String(newPassword).length < 8) {
    return reply
      .code(400)
      .send({ message: 'channel, destination, code and newPassword(min 8) are required' });
  }

  const otpDoc = await collections.otp().findOne(
    {
      channel,
      destination,
      status: 'pending',
      purpose: 'password_reset',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } }
  );

  if (!otpDoc) {
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  const providedHash = hashOtp(code);
  if (providedHash !== otpDoc.codeHash) {
    await collections.otp().updateOne({ _id: otpDoc._id }, { $inc: { attempts: 1 } });
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await collections.users().updateOne(
    { _id: otpDoc.userId },
    {
      $set: {
        passwordHash,
        passwordSetAt: new Date(),
        requiresPasswordChange: false,
        updatedAt: new Date(),
      },
    }
  );

  await collections.otp().updateOne(
    { _id: otpDoc._id },
    { $set: { status: 'verified', verifiedAt: new Date() } }
  );

  return reply.send({ message: 'Password reset successful' });
});

fastify.post('/token/refresh', async (req, reply) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return reply.code(400).send({ message: 'refreshToken is required' });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, jwtSecret);
  } catch (err) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  if (payload.type !== 'refresh' || !payload.jti) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  const redisEntry = await redisClient.get(`refresh:${payload.jti}`);
  if (!redisEntry) {
    return reply.code(401).send({ message: 'Refresh token revoked or expired' });
  }

  const user = await collections.users().findOne({ _id: new ObjectId(payload.sub) });
  if (!user) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  await redisClient.del(`refresh:${payload.jti}`);
  await collections.sessions().updateOne(
    { jti: payload.jti },
    { $set: { revokedAt: new Date() } }
  );

  const tokenBundle = await issueSessionAndTokens(user, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send(tokenBundle);
});

fastify.post('/logout', async (req, reply) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return reply.code(400).send({ message: 'refreshToken is required' });
  }

  try {
    const payload = jwt.verify(refreshToken, jwtSecret);
    if (payload.type === 'refresh' && payload.jti) {
      await redisClient.del(`refresh:${payload.jti}`);
      await collections.sessions().updateOne(
        { jti: payload.jti },
        { $set: { revokedAt: new Date() } }
      );
    }
  } catch (err) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  return reply.send({ message: 'Logged out successfully' });
});

fastify.get('/me', { preHandler: requireAuth }, async (req, reply) => {
  const scope = await getRolePermissions(req.user.roles || ['citizen']);
  return reply.send({ user: toUserResponse(req.user, scope) });
});

fastify.post('/contact/phone', { preHandler: requireAuth }, async (req, reply) => {
  const { phone } = req.body || {};
  if (!phone) {
    return reply.code(400).send({ message: 'phone is required' });
  }

  await collections.users().updateOne(
    { _id: req.user._id },
    { $set: { phone, phoneVerified: false, updatedAt: new Date() } }
  );

  const code = generateOtpCode();
  await collections.otp().insertOne({
    userId: req.user._id,
    channel: 'phone',
    destination: phone,
    codeHash: hashOtp(code),
    status: 'pending',
    expiresAt: new Date(Date.now() + otpTtlMs),
    attempts: 0,
    purpose: 'contact_verify',
    createdAt: new Date(),
  });

  fastify.log.info({ phone, code }, 'OTP generated for phone verification');

  return reply.send({ message: 'OTP sent to phone' });
});

fastify.post('/contact/phone/verify', { preHandler: requireAuth }, async (req, reply) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    return reply.code(400).send({ message: 'phone and code are required' });
  }

  const otpDoc = await collections.otp().findOne(
    {
      userId: req.user._id,
      channel: 'phone',
      destination: phone,
      purpose: 'contact_verify',
      status: 'pending',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } }
  );

  if (!otpDoc || otpDoc.codeHash !== hashOtp(code)) {
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  await collections.otp().updateOne({ _id: otpDoc._id }, { $set: { status: 'verified', verifiedAt: new Date() } });
  await collections.users().updateOne({ _id: req.user._id }, { $set: { phoneVerified: true, updatedAt: new Date() } });

  return reply.send({ message: 'Phone verified successfully' });
});

fastify.post('/contact/email', { preHandler: requireAuth }, async (req, reply) => {
  const { email } = req.body || {};
  if (!email) {
    return reply.code(400).send({ message: 'email is required' });
  }

  const normalizedEmail = String(email).toLowerCase();

  await collections.users().updateOne(
    { _id: req.user._id },
    { $set: { email: normalizedEmail, emailVerified: false, updatedAt: new Date() } }
  );

  const code = generateOtpCode();
  await collections.otp().insertOne({
    userId: req.user._id,
    channel: 'email',
    destination: normalizedEmail,
    codeHash: hashOtp(code),
    status: 'pending',
    expiresAt: new Date(Date.now() + otpTtlMs),
    attempts: 0,
    purpose: 'contact_verify',
    createdAt: new Date(),
  });

  fastify.log.info({ email: normalizedEmail, code }, 'OTP generated for email verification');

  return reply.send({ message: 'OTP sent to email' });
});

fastify.post('/contact/email/verify', { preHandler: requireAuth }, async (req, reply) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return reply.code(400).send({ message: 'email and code are required' });
  }

  const normalizedEmail = String(email).toLowerCase();

  const otpDoc = await collections.otp().findOne(
    {
      userId: req.user._id,
      channel: 'email',
      destination: normalizedEmail,
      purpose: 'contact_verify',
      status: 'pending',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } }
  );

  if (!otpDoc || otpDoc.codeHash !== hashOtp(code)) {
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  await collections.otp().updateOne({ _id: otpDoc._id }, { $set: { status: 'verified', verifiedAt: new Date() } });
  await collections.users().updateOne({ _id: req.user._id }, { $set: { emailVerified: true, updatedAt: new Date() } });

  return reply.send({ message: 'Email verified successfully' });
});

fastify.get('/nin/:nin', async (req, reply) => {
  const { nin } = req.params;
  if (!/^\d{11}$/.test(nin)) {
    return reply.code(400).send({ message: 'nin must be 11 digits' });
  }

  const record = await collections.ninCache().findOne({ nin });
  if (!record) {
    return reply.code(404).send({ message: 'NIN not found in cache' });
  }

  return reply.send(record);
});

fastify.post('/nin/refresh/:nin', async (req, reply) => {
  const { nin } = req.params;
  if (!/^\d{11}$/.test(nin)) {
    return reply.code(400).send({ message: 'nin must be 11 digits' });
  }

  await collections.ninCache().updateOne(
    { nin },
    {
      $set: {
        refreshRequested: true,
        lastRefreshedAt: new Date(),
      },
    }
  );

  return reply.send({ message: 'Fetching from NIN is currently not available.' });
});

fastify.get('/rbac/roles', { preHandler: requireAuth }, async (_req, reply) => {
  const roles = await collections.roles().find({}).toArray();
  return reply.send({ roles });
});

fastify.post('/rbac/roles', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
  const { name, permissions } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }

  await collections.roles().updateOne(
    { name },
    { $set: { name, permissions: Array.isArray(permissions) ? permissions : [] } },
    { upsert: true }
  );

  return reply.send({ message: 'Role upserted successfully' });
});

fastify.post('/rbac/assign-role', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
  const { userId, roleName } = req.body || {};
  if (!userId || !roleName) {
    return reply.code(400).send({ message: 'userId and roleName are required' });
  }
  const targetUserId = toObjectIdOrNull(userId);
  if (!targetUserId) {
    return reply.code(400).send({ message: 'Invalid userId' });
  }

  const role = await collections.roles().findOne({ name: roleName });
  if (!role) {
    return reply.code(404).send({ message: 'Role not found' });
  }

  await collections.users().updateOne(
    { _id: targetUserId },
    { $addToSet: { roles: roleName }, $set: { updatedAt: new Date() } }
  );

  return reply.send({ message: 'Role assigned successfully' });
});

fastify.get('/rbac/user/:userId/scope', { preHandler: requireAuth }, async (req, reply) => {
  const { userId } = req.params;
  const targetUserId = toObjectIdOrNull(userId);
  if (!targetUserId) {
    return reply.code(400).send({ message: 'Invalid userId' });
  }

  if (String(req.user._id) !== userId && !(req.user.roles || []).includes('admin')) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const user = await collections.users().findOne({ _id: targetUserId });
  if (!user) {
    return reply.code(404).send({ message: 'User not found' });
  }

  const scope = await getRolePermissions(user.roles || []);

  return reply.send({
    userId,
    roles: user.roles || [],
    scope,
  });
});

const start = async () => {
  try {
    await connect();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (redisClient) {
      await redisClient.quit();
    }
    if (mongoClient) {
      await mongoClient.close();
    }
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
