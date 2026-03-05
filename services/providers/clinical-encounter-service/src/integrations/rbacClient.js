async function checkPermission({ callJson, baseUrl, authorization, permissionKey, organizationId = null, branchId = null }) {
  const res = await callJson(`${baseUrl}/rbac/check`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ permissionKey, organizationId, branchId }),
  });
  return { allowed: !!(res.ok && res.body?.allowed), status: res.status, body: res.body };
}

module.exports = { checkPermission };
