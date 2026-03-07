import { useMemo } from 'react';
import { useAccessibilityStore } from '@/stores/accessibilityStore';
import { useContextStore } from '@/stores/contextStore';
import { useThemeStore } from '@/stores/themeStore';
import { getThemeLogo } from '@/lib/theme';

type BrandLogoProps = {
  compact?: boolean;
  showMeta?: boolean;
  className?: string;
};

export function BrandLogo({ compact = false, showMeta = true, className }: BrandLogoProps) {
  const darkMode = useAccessibilityStore((state) => state.darkMode);
  const activeContext = useContextStore((state) => state.activeContext);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const logoSrc = useMemo(() => getThemeLogo(resolvedTheme, darkMode), [resolvedTheme, darkMode]);
  const name = activeContext?.name ?? 'NHRS Platform';

  if (compact) {
    return (
      <img
        src={resolvedTheme.tokens.logo.markUrl || logoSrc}
        alt={`${name} mark`}
        className={className ?? 'h-9 w-9 rounded-md object-contain'}
      />
    );
  }

  return (
    <div className={className ?? 'flex min-w-0 items-center gap-3'}>
      <img src={logoSrc} alt={`${name} logo`} className="h-10 w-auto max-w-[140px] object-contain" />
      {showMeta ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="truncate text-xs text-muted">National Health Repository System</p>
        </div>
      ) : null}
    </div>
  );
}
