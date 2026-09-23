import { z } from "zod";

import { createLearnerSupport, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForRequest } from "@/lib/auth/require-operator";

/**
 * GET /learners/:learnerId/export
 *
 * Every row the product holds about one learner, plus their account's own
 * details, as a JSON download — the data access half of guardrails S16.
 *
 * The one surface that shows an email, because the export is the learner's
 * own answer to "what do you hold about me". Operator only, 404 for everyone
 * else and for anyone without a profile; audited under both pseudonyms and
 * never with the address; rate limited; and `no-store` so no cache between
 * here and the operator's disk keeps a copy.
 */
export const runtime = "nodejs";

const notFound = () => new Response(null, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly learnerId: string }> },
): Promise<Response> {
  const operator = await operatorForRequest("/learners/export");
  if (!operator) return notFound();

  const learnerId = z.uuid().safeParse((await params).learnerId);
  if (!learnerId.success) return notFound();

  const decision = await limiterFor("ops_learner_write").check(operator.hash);
  if (!decision.allowed) return new Response(null, { status: 429 });

  const { learners, accounts, logger } = createLearnerSupport();
  const rows = await learners.export(learnerId.data);
  if (!rows.ok) return new Response(null, { status: 503 });
  if (rows.data === null) return notFound();

  const account = await accounts.get(learnerId.data);
  const learnerHash = pseudonymFor(learnerId.data);

  logger.info("learner.exported", { audit: true, userIdHash: operator.hash, learnerHash });

  return new Response(JSON.stringify({ account, ...rows.data }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="learner-${learnerHash.slice(0, 8)}-export.json"`,
      "cache-control": "no-store",
    },
  });
}
