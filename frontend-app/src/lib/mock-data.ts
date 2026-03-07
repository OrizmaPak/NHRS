import providerLogo from '@/assets/logos/provider-logo.svg';
import stateLogo from '@/assets/logos/state-logo.svg';
import nhrsMark from '@/assets/logos/nhrs-mark.svg';
import type { AppContext, UserProfile } from '@/types/auth';
import type { ThemeConfig } from '@/types/theme';

export const mockUser: UserProfile = {
  id: 'user-001',
  fullName: 'Amina Okafor',
  email: 'amina.okafor@nhrs.gov.ng',
  phone: '+234 800 000 0001',
  roles: ['citizen', 'doctor', 'taskforce_reviewer'],
};

export const mockContexts: AppContext[] = [
  {
    id: 'ctx-public',
    type: 'platform',
    name: 'NHRS Public',
    subtitle: 'National citizen portal',
    themeScopeType: 'platform',
    themeScopeId: null,
    permissions: ['dashboard.read', 'doctor.registry.read'],
  },
  {
    id: 'ctx-hospital-01',
    type: 'organization',
    name: 'St. Catherine Teaching Hospital',
    subtitle: 'Provider context',
    logoUrl: providerLogo,
    themeScopeType: 'organization',
    themeScopeId: 'org-001',
    permissions: ['dashboard.read', 'provider.patient.read', 'provider.patient.write', 'records.read', 'records.write', 'ui.theme.update'],
  },
  {
    id: 'ctx-state-lagos',
    type: 'state',
    name: 'Lagos State Oversight',
    subtitle: 'Government context',
    themeScopeType: 'state',
    themeScopeId: 'state-lagos',
    permissions: ['dashboard.read', 'analytics.read', 'governance.case.read', 'ui.theme.update'],
  },
  {
    id: 'ctx-taskforce-state',
    type: 'taskforce',
    name: 'Taskforce - Lagos State',
    subtitle: 'Emergency and correction operations',
    themeScopeType: 'taskforce',
    themeScopeId: 'taskforce-lagos',
    permissions: ['governance.case.read', 'governance.case.update_status', 'emergency.request.read'],
  },
];

export const mockThemes: ThemeConfig[] = [
  {
    id: 'theme-platform-default',
    scopeType: 'platform',
    scopeId: null,
    parentThemeId: null,
    themeTokens: {},
    accessibilityDefaults: {},
    version: 1,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'theme-org-001',
    scopeType: 'organization',
    scopeId: 'org-001',
    parentThemeId: 'theme-platform-default',
    themeTokens: {
      colors: {
        primary: '#0D3B66',
        secondary: '#0077B6',
        accent: '#F77F00',
      },
      logo: {
        lightUrl: providerLogo,
        darkUrl: providerLogo,
        markUrl: nhrsMark,
      },
    },
    accessibilityDefaults: {
      fontScaleDefault: 1.05,
    },
    version: 4,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'theme-state-lagos',
    scopeType: 'state',
    scopeId: 'state-lagos',
    parentThemeId: 'theme-platform-default',
    themeTokens: {
      colors: {
        primary: '#0055A4',
        secondary: '#008751',
        accent: '#F7C325',
      },
      logo: {
        lightUrl: stateLogo,
        darkUrl: stateLogo,
        markUrl: stateLogo,
      },
      typography: {
        headingFontFamily: 'Sora, Plus Jakarta Sans, sans-serif',
      },
    },
    accessibilityDefaults: {
      highContrastDefault: true,
    },
    version: 2,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'theme-taskforce-lagos',
    scopeType: 'taskforce',
    scopeId: 'taskforce-lagos',
    parentThemeId: 'theme-state-lagos',
    themeTokens: {
      colors: {
        primary: '#112A46',
        accent: '#D72638',
      },
    },
    accessibilityDefaults: {
      reduceMotionDefault: true,
    },
    version: 1,
    updatedAt: new Date().toISOString(),
  },
];
