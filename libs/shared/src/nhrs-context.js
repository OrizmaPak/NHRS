const crypto = require('crypto');

const CONTEXT_HEADER = 'x-nhrs-context';
const CONTEXT_SIGNATURE_HEADER = 'x-nhrs-context-signature';

function encodeContext(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeContext(encoded) {
  const raw = Buffer.from(String(encoded), 'base64').toString('utf8');
  return JSON.parse(raw);
}

function signEncodedContext(encodedContext, secret) {
  return crypto.createHmac('sha256', secret).update(String(encodedContext)).digest('hex');
}

function buildSignedContext({
  requestId,
  userId = null,
  roles = [],
  orgId = null,
  branchId = null,
  permissionsChecked = [],
  membershipChecked = false,
  ttlSeconds = 60,
  now = new Date(),
}) {
  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + Math.max(Number(ttlSeconds) || 60, 1) * 1000);
  const payload = {
    v: 1,
    requestId,
    userId,
    roles: Array.isArray(roles) ? roles.map((r) => String(r)) : [],
    orgId: orgId || null,
    branchId: branchId || null,
    permissionsChecked: Array.isArray(permissionsChecked) ? permissionsChecked : [],
    membershipChecked: !!membershipChecked,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  return payload;
}

function verifySignedContext({ encodedContext, signature, secret, now = new Date() }) {
  if (!encodedContext || !signature) {
    return { ok: false, code: 'MISSING_TRUST_CONTEXT' };
  }
  const expected = signEncodedContext(encodedContext, secret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(String(signature), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, code: 'INVALID_TRUST_CONTEXT' };
  }
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, code: 'INVALID_TRUST_CONTEXT' };
  }
  let context;
  try {
    context = decodeContext(encodedContext);
  } catch (_err) {
    return { ok: false, code: 'INVALID_TRUST_CONTEXT' };
  }
  if (!context?.expiresAt || new Date(context.expiresAt).getTime() < new Date(now).getTime()) {
    return { ok: false, code: 'EXPIRED_TRUST_CONTEXT' };
  }
  return { ok: true, context };
}

function createContextVerificationHook({
  secret,
  allowLegacy = true,
  requiredMatcher = () => false,
}) {
  return async function nhrsContextHook(req, reply) {
    const encodedContext = req.headers[CONTEXT_HEADER];
    const signature = req.headers[CONTEXT_SIGNATURE_HEADER];
    const required = !!requiredMatcher(req);

    if (!encodedContext || !signature) {
      if (required && !allowLegacy) {
        return reply.code(401).send({ message: 'MISSING_TRUST_CONTEXT' });
      }
      return;
    }

    const verified = verifySignedContext({
      encodedContext,
      signature,
      secret,
    });
    if (!verified.ok) {
      return reply.code(401).send({ message: verified.code });
    }

    req.nhrs = verified.context;

    // Trust context over raw headers.
    if (verified.context.orgId) req.headers['x-org-id'] = verified.context.orgId;
    if (verified.context.branchId) req.headers['x-branch-id'] = verified.context.branchId;
    if (verified.context.requestId) req.headers['x-request-id'] = verified.context.requestId;
    if (!req.auth && verified.context.userId) {
      req.auth = {
        userId: String(verified.context.userId),
        roles: Array.isArray(verified.context.roles) ? verified.context.roles : [],
      };
    }
  };
}

module.exports = {
  CONTEXT_HEADER,
  CONTEXT_SIGNATURE_HEADER,
  encodeContext,
  decodeContext,
  signEncodedContext,
  buildSignedContext,
  verifySignedContext,
  createContextVerificationHook,
};
