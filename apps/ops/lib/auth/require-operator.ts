import "server-only";

import { notFound, redirect } from "next/navigation";

import { meetsAssurance, type AssuranceLevel } from "@dp/auth/claims";

import { actionLogger, pseudonymFor } from "@/lib/api/composition";
import { getOperatorSession } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import { LOGIN_PATH, MFA_PATH } from "@/lib/auth/routes";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

/**
 * The gate every operator surface stands behind.
 *
 * Three questions, in the order they fail closed: is there a session, is it
 * on the allowlist, and has it presented a second factor. A learner who is
 * signed in but not on the list is signed out of this origin and shown the
 * same page as for a route that does not exist — 404, never 403, because a
 * distinguishable refusal is a way to enumerate who is an operator.
 *
 * Every admission is an audit event (guardrails S24: viewing the cost
 * dashboard is itself a privileged operation), recorded against the
 * operator's pseudonym and never their id. No pseudonym — the salt unset —
 * is a denial: a privileged surface recorded against nobody is the one row
 * this audit trail cannot afford.
 *
 * Pages call this; so does the layout above them; so does every action and
 * the one route handler. Nothing inherits it.
 */
export interface OperatorIdentity {
  readonly id: string;
  readonly email: string | null;
  /** The pseudonym every write is attributed to. */
  readonly hash: string;
  readonly aal: AssuranceLevel;
}

export interface RequireOperatorOptions {
  /** Logged with the admission. */
  readonly route: string;
  /** The step-up pages themselves accept a password-only session. */
  readonly minimumAal?: AssuranceLevel;
  /** The layout passes false, so a page view logs once. */
  readonly audit?: boolean;
}

type Refusal = "signed_out" | "not_operator" | "step_up" | "no_pseudonym";

async function signOutOfThisOrigin(): Promise<void> {
  try {
    const supabase = await createServerSupabaseClient();
    // Local scope: the same account's learner session on the other origin is
    // that product's business, not this one's.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Already gone, or unreachable. Either way there is no session to keep.
  }
}

async function admit(
  options: RequireOperatorOptions,
): Promise<{ ok: true; operator: OperatorIdentity } | { ok: false; refusal: Refusal }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, refusal: "signed_out" };

  if (!isOperator(session.sub)) {
    actionLogger().warn("ops.access_denied", {
      audit: true,
      route: options.route,
      reason: "not_operator",
    });
    await signOutOfThisOrigin();
    return { ok: false, refusal: "not_operator" };
  }

  if (!meetsAssurance(session.aal, options.minimumAal ?? "aal2")) {
    return { ok: false, refusal: "step_up" };
  }

  let hash: string;
  try {
    hash = pseudonymFor(session.sub);
  } catch {
    actionLogger().error("ops.access_denied", {
      audit: true,
      route: options.route,
      reason: "no_pseudonym",
    });
    return { ok: false, refusal: "no_pseudonym" };
  }

  if (options.audit !== false) {
    actionLogger().info("ops.access", {
      audit: true,
      route: options.route,
      userIdHash: hash,
      aal: session.aal,
    });
  }

  return { ok: true, operator: { id: session.sub, email: session.email, hash, aal: session.aal } };
}

/** For a page or a layout: redirects or 404s, never returns without an operator. */
export async function requireOperator(options: RequireOperatorOptions): Promise<OperatorIdentity> {
  const outcome = await admit(options);
  if (outcome.ok) return outcome.operator;

  switch (outcome.refusal) {
    case "signed_out":
      redirect(LOGIN_PATH);
    case "step_up":
      redirect(MFA_PATH);
    case "not_operator":
    case "no_pseudonym":
      notFound();
  }
}

/**
 * For a Server Action: null means do nothing, and say nothing. An action is
 * its own entry point, reachable by anyone who can post to this deployment.
 */
export async function operatorForAction(route: string): Promise<OperatorIdentity | null> {
  const outcome = await admit({ route });
  return outcome.ok ? outcome.operator : null;
}

/** For a route handler: null means answer 404. */
export const operatorForRequest = operatorForAction;
