import { randomBytes } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { FACTOR_NAME } from "../lib/auth/mfa-state";
import {
  DUMMY_LEARNER_EMAIL,
  DUMMY_LEARNER_ONBOARDING,
  usesReservedDomain,
} from "../lib/dev/dummy-learner";
import { totpCode } from "../lib/dev/totp";
import { parseEnv, requireEnvValue } from "@dp/env/schema";

/**
 * Creates the fixture learner and proves it can sign in.
 *
 * The account is confirmed through the admin API — there is no inbox to click
 * a link in — and then everything else happens down the ordinary path: sign in
 * with the publishable key, enrol and answer an authenticator through the same
 * MFA calls the step-up pages make, complete onboarding through the same RPC
 * the form calls, under the same Row Level Security. Seeding a learner by
 * writing rows behind the application would prove nothing about whether a
 * learner can actually get in.
 *
 * Run with: pnpm dummy:user
 */

function abort(message: string): never {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

/** GoTrue has no lookup by address, so page through until the match appears. */
async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const wanted = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) abort(`Could not list users: ${error.message}`);
    if (data.users.length === 0) return null;

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === wanted,
    );
    if (match) return match.id;
  }

  return null;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const env = parseEnv(process.env);

  if (env.NODE_ENV === "production") {
    abort("Refusing to create a fixture account with NODE_ENV=production.");
  }

  const url = requireEnvValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requireEnvValue(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const secretKey = requireEnvValue(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");

  const email = process.env.DEV_SEED_EMAIL?.trim() || DUMMY_LEARNER_EMAIL;
  if (!usesReservedDomain(email)) {
    abort(
      `${email} could reach a real inbox. Fixture accounts must use a ` +
        `reserved domain such as example.com.`,
    );
  }

  // Generated unless pinned, so no working credential is ever committed.
  const supplied = process.env.DEV_SEED_PASSWORD?.trim();
  const password = supplied || randomBytes(18).toString("base64url");

  say();
  say(`  Project   ${new URL(url).host}`);
  say(`  Account   ${email}`);
  say();

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { fixture: true },
  });

  let userId = created.data.user?.id ?? null;

  if (created.error) {
    // Already present from an earlier run. Reset the password so the one
    // printed below is always the one that works.
    userId = await findUserIdByEmail(admin, email);
    if (!userId) abort(`Could not create or find the account: ${created.error.message}`);

    const updated = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updated.error) abort(`Could not reset the password: ${updated.error.message}`);

    say("  Account already existed. Password reset.");
  } else {
    say("  Account created and confirmed.");
  }

  // From here on, only the publishable key: exactly what the browser has.
  const learner = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await learner.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    abort(`Sign-in failed: ${signIn.error?.message ?? "no session returned"}`);
  }
  say("  Signed in with the publishable key.");

  // The second factor. An authenticator pinned with DEV_SEED_TOTP_SECRET is
  // kept if it still answers; otherwise every factor goes and a fresh one is
  // enrolled and verified with a code computed here, exactly as a phone would.
  const suppliedSecret = process.env.DEV_SEED_TOTP_SECRET?.trim();
  let totpSecret: string | null = null;

  const factors = await learner.auth.mfa.listFactors();
  if (factors.error) abort(`Could not list factors: ${factors.error.message}`);
  const verifiedFactor = factors.data.totp.find((factor) => factor.status === "verified");

  if (verifiedFactor && suppliedSecret) {
    const answered = await learner.auth.mfa.challengeAndVerify({
      factorId: verifiedFactor.id,
      code: totpCode(suppliedSecret),
    });
    if (!answered.error) {
      totpSecret = suppliedSecret;
      say("  Authenticator kept: the pinned secret still answers.");
    }
  }

  if (!totpSecret) {
    for (const factor of factors.data.all) {
      const removed = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: userId ?? signIn.data.user.id,
      });
      if (removed.error) abort(`Could not remove an old factor: ${removed.error.message}`);
    }

    const enrolled = await learner.auth.mfa.enroll({ factorType: "totp", friendlyName: FACTOR_NAME });
    if (enrolled.error || !enrolled.data) {
      abort(`Could not enrol an authenticator: ${enrolled.error?.message ?? "no factor returned"}`);
    }

    const confirmed = await learner.auth.mfa.challengeAndVerify({
      factorId: enrolled.data.id,
      code: totpCode(enrolled.data.totp.secret),
    });
    if (confirmed.error) abort(`Could not verify the new authenticator: ${confirmed.error.message}`);

    totpSecret = enrolled.data.totp.secret;
    say("  Authenticator enrolled and answered through the same MFA calls the app makes.");
  }

  const status = await learner
    .from("profiles")
    .select("id, onboarded_at")
    .eq("id", userId ?? signIn.data.user.id)
    .maybeSingle();

  if (status.error) abort(`Could not read the profile: ${status.error.message}`);

  if (status.data?.onboarded_at) {
    say("  Onboarding already complete. Progress left untouched.");
  } else {
    const { error } = await learner.rpc("complete_onboarding", {
      p_learning_goal: DUMMY_LEARNER_ONBOARDING.learningGoal,
      p_selected_level: DUMMY_LEARNER_ONBOARDING.selectedLevel,
      p_target_topics: DUMMY_LEARNER_ONBOARDING.targetTopics,
      p_interests: DUMMY_LEARNER_ONBOARDING.interests,
      p_input_preference: DUMMY_LEARNER_ONBOARDING.inputPreference,
      p_output_preference: DUMMY_LEARNER_ONBOARDING.outputPreference,
      p_correction_preference: DUMMY_LEARNER_ONBOARDING.correctionPreference,
    });

    if (error) abort(`Onboarding failed: ${error.message}`);
    say("  Onboarding completed through the same RPC the form uses.");
  }

  const state = await learner
    .from("learner_states")
    .select("mini_level, effective_cefr, selected_level")
    .maybeSingle();

  if (state.error) abort(`Could not read the learner state: ${state.error.message}`);

  await learner.auth.signOut();

  say();
  say(`  Sign in at ${env.APP_URL}/auth/login`);
  say(`    email        ${email}`);
  say(`    password     ${password}`);
  say(`    authenticator secret  ${totpSecret}`);
  if (!supplied) {
    say(`  Password generated just now. Pin it with DEV_SEED_PASSWORD to keep it stable.`);
  }
  if (totpSecret !== suppliedSecret) {
    say(`  Authenticator enrolled just now. Pin its secret with DEV_SEED_TOTP_SECRET, and`);
    say(`  add it to an authenticator app by hand to sign in from a browser.`);
  }
  say();
  say(
    `  Starting point: ${state.data?.effective_cefr ?? "?"}, mini-level ` +
      `${state.data?.mini_level ?? "?"} (selected ${state.data?.selected_level ?? "?"}).`,
  );
  say();
  say("  This is a real account on a real project. Delete it before the");
  say("  project is reachable by anyone but you.");
  say();
}

main().catch((error: unknown) => {
  abort(error instanceof Error ? error.message : String(error));
});
