import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { useAccessibilityStore } from '@/stores/accessibilityStore';

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function AccessibilityPanel() {
  const {
    darkMode,
    fontScale,
    highContrast,
    reduceMotion,
    readableFont,
    setFontScale,
    toggleDarkMode,
    toggleHighContrast,
    toggleReduceMotion,
    toggleReadableFont,
  } = useAccessibilityStore();

  return (
    <div className="space-y-4">
      <FormField label="Dark mode" hint="Switch to dark surfaces for low-light use">
        <Toggle checked={darkMode} label="Enable dark mode" onChange={toggleDarkMode} />
      </FormField>
      <FormField label="High contrast mode" hint="Boost contrast for low-vision support">
        <Toggle checked={highContrast} label="Enable high contrast" onChange={toggleHighContrast} />
      </FormField>
      <FormField label="Reduce motion" hint="Minimizes animations and transitions">
        <Toggle checked={reduceMotion} label="Prefer reduced motion" onChange={toggleReduceMotion} />
      </FormField>
      <FormField label="Readable font" hint="Uses a high-legibility font stack">
        <Toggle checked={readableFont} label="Enable readable font" onChange={toggleReadableFont} />
      </FormField>
      <FormField label="Font scale" hint="UI scale multiplier (0.9 - 1.3)">
        <Input
          type="number"
          min={0.9}
          max={1.3}
          step={0.05}
          value={fontScale}
          onChange={(event) => setFontScale(Number(event.target.value))}
        />
      </FormField>
    </div>
  );
}
