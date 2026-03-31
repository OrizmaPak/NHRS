const ALLOWED_NOTIFICATION_CHANNELS = new Set(['sms', 'email', 'whatsapp']);

function computeOnboarding(profile) {
  const completedSteps = [];
  if (profile?.onboarding?.hasSetPassword) completedSteps.push('password_set');
  if (profile?.onboarding?.hasVerifiedPhone) completedSteps.push('phone_verified');
  if (profile?.onboarding?.hasVerifiedEmail) completedSteps.push('email_verified');
  if (profile?.address?.line1) completedSteps.push('address_added');
  if (profile?.displayName) completedSteps.push('display_name_set');

  const totalWeight = 5;
  const completenessScore = Math.min(100, Math.round((completedSteps.length / totalWeight) * 100));

  return { completedSteps, completenessScore };
}

function sanitizeNotificationChannels(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((v) => String(v).toLowerCase()).filter((v) => ALLOWED_NOTIFICATION_CHANNELS.has(v))));
}

function pickEditableProfileFields(payload) {
  const out = {};
  if (typeof payload?.displayName === 'string') {
    out.displayName = payload.displayName.trim();
  }
  if (payload?.address && typeof payload.address === 'object') {
    out.address = {
      country: payload.address.country || null,
      state: payload.address.state || null,
      lga: payload.address.lga || null,
      city: payload.address.city || null,
      line1: payload.address.line1 || null,
      line2: payload.address.line2 || null,
      postalCode: payload.address.postalCode || null,
    };
  }
  if (payload?.preferences && typeof payload.preferences === 'object') {
    out.preferences = {
      notificationChannels: sanitizeNotificationChannels(payload.preferences.notificationChannels),
      language: payload.preferences.language || null,
    };
  }
  return out;
}

function pickSelfEditableProfileFields(payload) {
  const out = pickEditableProfileFields(payload);

  if (typeof payload?.otherName === 'string') {
    out.otherName = payload.otherName.trim() || null;
  }
  if (typeof payload?.dob === 'string') {
    out.dob = payload.dob.trim() || null;
  }
  if (typeof payload?.gender === 'string') {
    out.gender = payload.gender.trim() || null;
  }
  if (typeof payload?.nationality === 'string') {
    out.nationality = payload.nationality.trim() || null;
  }
  if (typeof payload?.stateOfOrigin === 'string') {
    out.stateOfOrigin = payload.stateOfOrigin.trim() || null;
  }
  if (typeof payload?.localGovernment === 'string') {
    out.localGovernment = payload.localGovernment.trim() || null;
  }

  return out;
}

function sanitizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((value) => String(value || '').trim()).filter(Boolean)));
}

function hasMeaningfulString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMeaningfulArray(value) {
  return Array.isArray(value) && sanitizeStringArray(value).length > 0;
}

function pickMissingFields(existing, incoming) {
  const out = {};
  if (!incoming || typeof incoming !== 'object') return out;

  for (const [key, value] of Object.entries(incoming)) {
    const current = existing && typeof existing === 'object' ? existing[key] : undefined;

    if (Array.isArray(value)) {
      if (!hasMeaningfulArray(current) && hasMeaningfulArray(value)) {
        out[key] = sanitizeStringArray(value);
      }
      continue;
    }

    if (value && typeof value === 'object') {
      const nested = pickMissingFields(current && typeof current === 'object' ? current : {}, value);
      if (Object.keys(nested).length > 0) {
        out[key] = nested;
      }
      continue;
    }

    if (!hasMeaningfulString(current) && hasMeaningfulString(value)) {
      out[key] = String(value).trim();
    }
  }

  return out;
}

function pickManagedProfileFields(payload) {
  const out = pickEditableProfileFields(payload);

  if (typeof payload?.firstName === 'string') {
    out.firstName = payload.firstName.trim() || null;
  }
  if (typeof payload?.lastName === 'string') {
    out.lastName = payload.lastName.trim() || null;
  }
  if (typeof payload?.otherName === 'string') {
    out.otherName = payload.otherName.trim() || null;
  }
  if (typeof payload?.dob === 'string') {
    out.dob = payload.dob.trim() || null;
  }
  if (typeof payload?.gender === 'string') {
    out.gender = payload.gender.trim() || null;
  }
  if (typeof payload?.phone === 'string') {
    out.phone = payload.phone.trim() || null;
  }
  if (typeof payload?.email === 'string') {
    out.email = payload.email.trim().toLowerCase() || null;
  }
  if (Array.isArray(payload?.professionTypes)) {
    out.professionTypes = sanitizeStringArray(payload.professionTypes);
  }

  return out;
}

function pickMissingManagedProfileFields(existing, payload) {
  return pickMissingFields(existing || {}, pickManagedProfileFields(payload));
}

function pickMissingSelfProfileFields(existing, payload) {
  return pickMissingFields(existing || {}, pickSelfEditableProfileFields(payload));
}

function buildProfileUpsertFromEnsure(input, existing) {
  const now = new Date();
  const onboarding = {
    hasSetPassword: !!input?.hasSetPassword,
    hasVerifiedPhone: !!input?.phoneVerified,
    hasVerifiedEmail: !!input?.emailVerified,
    completedSteps: [],
    completenessScore: 0,
  };

  const base = {
    userId: String(input.userId),
    nin: input.nin || null,
    email: input.email || null,
    phone: input.phone || null,
    emailVerified: !!input.emailVerified,
    phoneVerified: !!input.phoneVerified,
    displayName: existing?.displayName || null,
    firstName: existing?.firstName || null,
    lastName: existing?.lastName || null,
    otherName: existing?.otherName || null,
    dob: existing?.dob || null,
    gender: existing?.gender || null,
    address: existing?.address || null,
    professionTypes: Array.isArray(existing?.professionTypes) ? existing.professionTypes : ['citizen'],
    profileStatus: existing?.profileStatus || 'incomplete',
    onboarding,
    preferences: existing?.preferences || { notificationChannels: ['sms'], language: 'en' },
    metadata: {
      createdAt: existing?.metadata?.createdAt || now,
      updatedAt: now,
      createdFrom: existing?.metadata?.createdFrom || (input.createdFrom || 'nin_login'),
    },
  };

  const computed = computeOnboarding(base);
  base.onboarding.completedSteps = computed.completedSteps;
  base.onboarding.completenessScore = computed.completenessScore;
  if (computed.completenessScore >= 80) {
    base.profileStatus = 'active';
  } else if (computed.completenessScore >= 40) {
    base.profileStatus = 'pending';
  }
  return base;
}

function mergeProfileView({ profile, ninSummary, rolesSummary, membershipSummary }) {
  const onboardingComputed = computeOnboarding(profile || {});
  return {
    profile: {
      ...(profile || {}),
      onboarding: {
        ...(profile?.onboarding || {}),
        completedSteps: onboardingComputed.completedSteps,
        completenessScore: onboardingComputed.completenessScore,
      },
    },
    ninSummary: ninSummary || null,
    rolesSummary: rolesSummary || null,
    membershipSummary: membershipSummary || null,
  };
}

module.exports = {
  computeOnboarding,
  pickEditableProfileFields,
  pickSelfEditableProfileFields,
  pickManagedProfileFields,
  pickMissingSelfProfileFields,
  pickMissingManagedProfileFields,
  buildProfileUpsertFromEnsure,
  mergeProfileView,
};
