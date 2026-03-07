export const endpoints = {
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/token/refresh',
    meFallback: '/auth/me',
  },
  identity: {
    me: '/auth/me',
    contexts: '/me/contexts',
    switchContext: '/me/context/switch',
  },
  uiTheme: {
    platform: '/ui/theme/platform',
    effective: '/ui/theme/effective',
    list: '/ui/theme',
    create: '/ui/theme',
    update: (id: string) => `/ui/theme/${id}`,
    logo: (id: string) => `/ui/theme/${id}/logo`,
  },
  doctorRegistry: {
    search: '/doctors/search',
    profile: (doctorId: string) => `/doctors/${doctorId}`,
  },
  records: {
    me: '/records/me',
    byNin: (nin: string) => `/records/${nin}`,
    addSymptom: '/records/me/symptoms',
  },
  emergency: {
    inventorySearch: '/emergency/inventory/search',
    requests: '/emergency/requests',
  },
  provider: {
    patientSearch: '/profile/search',
    patientProfileByNin: (nin: string) => `/profile/by-nin/${nin}`,
    encountersByNin: (nin: string) => `/encounters/${nin}`,
    labsByNin: (nin: string) => `/labs/${nin}/results`,
    pharmacyByNin: (nin: string) => `/pharmacy/${nin}/dispenses`,
  },
};
