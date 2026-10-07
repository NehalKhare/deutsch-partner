import { createOwnExport } from "@/lib/account/server";
import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { getAuthenticatedAccount } from "@/lib/auth/current-user";

/**
 * GET /api/account/export
 *
 * Everything the product holds about the signed-in learner, as a JSON file
 * (Art. 15 and 20 GDPR). The same rows the operator's export carries, by the
 * same function, with the account's own address on top — the one place this
 * app prints it, because the file is the learner's answer to "what do you
 * hold about me". `no-store`, so nothing between here and their disk keeps
 * a copy; 401 without a full session; audited under the pseudonym.
 */
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const account = await getAuthenticatedAccount();
  if (!account) return new Response(null, { status: 401 });

  const hash = pseudonymOrUnavailable(account.id);
  const decision = await limiterFor("account_export").check(hash);
  if (!decision.allowed) return new Response(null, { status: 429 });

  const rows = await createOwnExport().export(account.id);
  if (!rows.ok) return new Response(null, { status: 503 });
  if (rows.data === null) return new Response(null, { status: 404 });

  actionLogger().info("account.exported", { audit: true, userIdHash: hash });

  return new Response(JSON.stringify({ account: { email: account.email }, ...rows.data }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="deutsch-partner-export.json"',
      "cache-control": "no-store",
    },
  });
}
