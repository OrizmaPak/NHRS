import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-slate-300 shadow-[inset_0_1px_2px_rgba(15,23,42,0.18)] transition-[background-color,box-shadow] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-emerald-500 data-[state=checked]:shadow-[inset_0_1px_2px_rgba(6,95,70,0.18),0_0_0_1px_rgba(16,185,129,0.22)]',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_rgba(15,23,42,0.22)] transition-transform duration-300 ease-out will-change-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1"
    />
  </SwitchPrimitive.Root>
));

Switch.displayName = 'Switch';
