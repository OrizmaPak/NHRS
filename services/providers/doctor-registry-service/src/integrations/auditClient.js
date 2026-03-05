function emitAuditEvent({ fetchClient, auditApiBaseUrl, event }) {
  setImmediate(async () => {
    try {
      await fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...event,
          createdAt: new Date().toISOString(),
        }),
      });
    } catch (_err) {
      // non-blocking
    }
  });
}

module.exports = { emitAuditEvent };
