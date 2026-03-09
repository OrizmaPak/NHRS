async function callJson(fetchFn, url, options = {}) {
  const response = await fetchFn(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, body };
}

async function checkPermission(fetchFn, {
  rbacBaseUrl,
  authorization,
  permissionKey,
  organizationId,
  activeContextId,
  activeContextName,
  activeContextType,
}) {
  const result = await callJson(fetchFn, `${rbacBaseUrl}/rbac/check`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      permissionKey,
      organizationId: organizationId || null,
      activeContextId: activeContextId || null,
      activeContextName: activeContextName || null,
      activeContextType: activeContextType || null,
    }),
  });
  if (!result.ok) return { allowed: false, status: result.status, reason: result.body?.message || 'RBAC check failed' };
  return { allowed: !!result.body?.allowed, status: 200, reason: result.body?.reason || null };
}

function emitAuditEvent(fetchFn, auditBaseUrl, event) {
  void (async () => {
    try {
      await fetchFn(`${auditBaseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (_err) {
      // Intentionally non-blocking
    }
  })();
}

module.exports = {
  callJson,
  checkPermission,
  emitAuditEvent,
};
