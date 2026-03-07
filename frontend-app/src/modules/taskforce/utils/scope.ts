import type { AppContext } from '@/types/auth';

export type DerivedScope = {
  level: 'NATIONAL' | 'STATE' | 'LGA';
  state?: string;
  lga?: string;
  label: string;
};

function parseLocationToken(source: string): { state?: string; lga?: string } {
  const lower = source.toLowerCase();
  const byDash = source.split('-');
  const bySpace = source.split(' ');

  if (lower.includes('lga')) {
    const lga = byDash[byDash.length - 1] ?? bySpace[bySpace.length - 1];
    return { lga };
  }
  if (lower.includes('state')) {
    const state = byDash[byDash.length - 1] ?? bySpace[bySpace.length - 1];
    return { state };
  }
  return {};
}

export function deriveTaskforceScope(context: AppContext | null): DerivedScope {
  if (!context) {
    return { level: 'NATIONAL', label: 'National' };
  }

  const tokens = [context.name, context.subtitle ?? '', context.id].join(' ');
  const lower = tokens.toLowerCase();
  const location = parseLocationToken(tokens);

  if (lower.includes('lga')) {
    return {
      level: 'LGA',
      state: location.state,
      lga: location.lga ?? context.name,
      label: location.lga ? `${location.lga} LGA` : 'LGA',
    };
  }

  if (lower.includes('state')) {
    return {
      level: 'STATE',
      state: location.state ?? context.name,
      label: location.state ? `${location.state} State` : 'State',
    };
  }

  return { level: 'NATIONAL', label: 'National' };
}
