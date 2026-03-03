function matchesPermission(ruleKey, permissionKey) {
  if (ruleKey === '*') {
    return true;
  }
  if (ruleKey.endsWith('.*')) {
    return permissionKey.startsWith(ruleKey.slice(0, -1));
  }
  return ruleKey === permissionKey;
}

function specificity(ruleKey) {
  if (ruleKey === '*') {
    return 0;
  }
  if (ruleKey.endsWith('.*')) {
    return ruleKey.length - 1;
  }
  return 1000 + ruleKey.length;
}

function evaluatePermission({ permissionKey, roleRules, overrideRules }) {
  const matchedRoleRules = (roleRules || [])
    .filter((r) => matchesPermission(r.permissionKey, permissionKey))
    .sort((a, b) => specificity(b.permissionKey) - specificity(a.permissionKey));

  const matchedOverrideRules = (overrideRules || [])
    .filter((r) => matchesPermission(r.permissionKey, permissionKey))
    .sort((a, b) => specificity(b.permissionKey) - specificity(a.permissionKey));

  let effect = 'deny';
  let effectiveFrom = 'none';

  if (matchedRoleRules.length > 0) {
    const topRoleRule = matchedRoleRules[0];
    effect = topRoleRule.effect;
    effectiveFrom = 'role';
  }

  if (matchedOverrideRules.length > 0) {
    const topOverrideRule = matchedOverrideRules[0];
    effect = topOverrideRule.effect;
    effectiveFrom = 'override';
  }

  return {
    allowed: effect === 'allow',
    reason: effect === 'allow' ? 'Permission granted' : 'Permission denied',
    effectiveFrom,
    matchedRules: {
      roleRules: matchedRoleRules,
      overrideRules: matchedOverrideRules,
    },
  };
}

function mergeRules(roleRules, overrideRules) {
  const result = new Map();
  for (const rule of roleRules || []) {
    result.set(rule.permissionKey, { permissionKey: rule.permissionKey, effect: rule.effect, source: 'role' });
  }
  for (const rule of overrideRules || []) {
    result.set(rule.permissionKey, {
      permissionKey: rule.permissionKey,
      effect: rule.effect,
      source: 'override',
    });
  }
  return Array.from(result.values());
}

module.exports = {
  evaluatePermission,
  mergeRules,
  matchesPermission,
};
