export const APP_NAME = 'NHRS Platform';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';
export const THEME_STORAGE_KEY = 'nhrs.theme';
export const ACCESSIBILITY_STORAGE_KEY = 'nhrs.accessibility';
export const CONTEXT_STORAGE_KEY = 'nhrs.context';

export const ALLOW_CONTEXT_SWITCH_FALLBACK =
  import.meta.env.VITE_CONTEXT_SWITCH_FALLBACK === 'true';

export const permissionMap = {
  dashboard: 'auth.me.read',
  providerPatientSearch: 'profile.search',
  providerPatientWrite: 'profile.user.read',
  taskforceCasesRead: 'governance.case.read',
  emergencyRequestsRead: 'emergency.request.read',
  appearanceWrite: 'ui.theme.write',
} as const;
