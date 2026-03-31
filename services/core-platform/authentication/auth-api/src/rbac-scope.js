function normalizeAllowedPermissionKeys(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      if (!item || typeof item !== 'object') return true;
      const effect = String(item.effect ?? item.value ?? '').trim().toLowerCase();
      if (effect === 'deny') return false;
      if (Object.prototype.hasOwnProperty.call(item, 'granted') && item.granted === false) {
        return false;
      }
      return true;
    })
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return String(item.permissionKey || item.key || item.permission || '');
      }
      return '';
    })
    .filter(Boolean);
}

module.exports = {
  normalizeAllowedPermissionKeys,
};
