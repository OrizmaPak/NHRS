function emitNotificationEvent({ fetchClient, baseUrl, event }) {
  setImmediate(async () => {
    try {
      await fetchClient(`${baseUrl}/internal/notifications/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (_err) {
      // non-blocking
    }
  });
}

module.exports = { emitNotificationEvent };
