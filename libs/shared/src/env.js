function isWeakSecret(value) {
  if (!value) return true;
  const v = String(value);
  if (v.length < 16) return true;
  if (v.toLowerCase().includes('change-me')) return true;
  if (v.toLowerCase().includes('default')) return true;
  return false;
}

function assertRequiredEnv(env, keys) {
  const missing = [];
  for (const key of keys) {
    if (!env[key]) missing.push(key);
  }
  if (missing.length > 0) {
    const err = new Error(`INVALID_ENV_SECRET_CONFIGURATION: missing ${missing.join(', ')}`);
    err.code = 'INVALID_ENV_SECRET_CONFIGURATION';
    throw err;
  }
}

function enforceProductionSecrets({
  env = process.env,
  required = [],
  secrets = [],
}) {
  if (String(env.NODE_ENV || 'development') === 'development') return;
  assertRequiredEnv(env, required);
  const weak = secrets.filter((key) => isWeakSecret(env[key]));
  if (weak.length > 0) {
    const err = new Error(`INVALID_ENV_SECRET_CONFIGURATION: weak ${weak.join(', ')}`);
    err.code = 'INVALID_ENV_SECRET_CONFIGURATION';
    throw err;
  }
}

module.exports = {
  isWeakSecret,
  assertRequiredEnv,
  enforceProductionSecrets,
};

