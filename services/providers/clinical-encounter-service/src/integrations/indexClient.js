async function registerIndexEntry({ callJson, baseUrl, nin, entryType, pointers, token, orgId, branchId, payload = {} }) {
  const url = `${baseUrl}/records/${encodeURIComponent(String(nin))}/entries`;
  return callJson(url, {
    method: 'POST',
    headers: {
      authorization: token,
      'x-org-id': orgId,
      'x-branch-id': branchId || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ entryType, payload, pointers }),
  });
}

module.exports = { registerIndexEntry };
