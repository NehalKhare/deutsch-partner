import { signOutAction } from "@/app/login/actions";
import { OpsShell } from "@/components/ops-shell";
import { requireOperator } from "@/lib/auth/require-operator";

/**
 * The operator shell.
 *
 * Guarding here means a new route under this segment is protected by default:
 * signed in, on the allowlist, and past the second factor. Every page checks
 * again on its own, because a page is also reachable through a prefetch that
 * never rendered its parent; this one logs nothing so a view is audited once.
 */
export default async function OperatorLayout({ children }: LayoutProps<"/">) {
  const operator = await requireOperator({ route: "layout", audit: false });

  return (
    <OpsShell email={operator.email} signOut={signOutAction}>
      {children}
    </OpsShell>
  );
}
