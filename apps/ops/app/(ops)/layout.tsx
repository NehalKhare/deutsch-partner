import { signOutAction } from "@/app/login/actions";
import { OpsNotifications } from "@/components/ops-notifications";
import { OpsShell } from "@/components/ops-shell";
import { requireOperator } from "@/lib/auth/require-operator";
import { currentOpsNotifications } from "@/lib/notifications";

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
  // After the gate, never before: the inbox is operator scope.
  const notifications = await currentOpsNotifications();

  return (
    <OpsShell
      email={operator.email}
      signOut={signOutAction}
      notifications={<OpsNotifications initial={notifications} />}
    >
      {children}
    </OpsShell>
  );
}
