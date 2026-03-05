function emitNotificationEvent({ fetchClient, notificationApiBaseUrl, event }) {
  setImmediate(async () => {
    try {
      await fetchClient(`${notificationApiBaseUrl}/internal/notifications/events`, {
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
