function emitAuditEvent({ fetchClient, baseUrl, event }) {
  setImmediate(async () => {
    try {
      await fetchClient(`${baseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (_err) {
      // non-blocking
    }
  });
}

module.exports = { emitAuditEvent };
