async function fetchDoctorStatus({
  callJson,
  baseUrl,
  userId,
  internalServiceToken,
}) {
  if (!userId) {
    return { ok: false, status: 400, body: { message: 'Missing userId' } };
  }
  return callJson(`${baseUrl}/doctors/${encodeURIComponent(String(userId))}/status`, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalServiceToken,
    },
  });
}

module.exports = { fetchDoctorStatus };
