"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that cannot be pressed twice into one action.
 *
 * The curriculum's row actions are plain forms in a server component, and a
 * plain button stays pressable while the action runs — two quick clicks on
 * Practise opened two threads. useFormStatus is the whole reason this is a
 * client component; without JavaScript the form still submits normally.
 */
export function PendingButton({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className}>
      {children}
    </button>
  );
}
