"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that cannot be pressed twice into one action.
 *
 * Plain forms in a server component are the house pattern, and a plain button
 * stays pressable while its action runs — two quick clicks on Practise opened
 * two threads, and two on Run a scan would start two runs against a quota of
 * five a minute. It is also the only acknowledgement a press gets when the
 * action's real work happens in the background after the response.
 *
 * useFormStatus is the whole reason this is a client component; without
 * JavaScript the form still submits normally.
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
