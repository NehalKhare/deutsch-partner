import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { scenarioErrorResponse } from "@/lib/api/scenarios";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import { createScenarioRepository } from "@dp/db/scenario-repository";
import type { DatabaseClient } from "@dp/db/types";

/**
 * GET /api/scenarios/[slug]
 *
 * One scenario with its full body — the metadata-retrieval half of the
 * scenarios API. A plain RLS-scoped read, no model call, so it carries no
 * rate limiter beyond authentication. A malformed slug reads the same as a
 * missing one: both are "not found", so the route confirms nothing about
 * what exists.
 */

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) {
    const { status, message } = scenarioErrorResponse("unauthenticated");
    return json({ error: "unauthenticated", message }, status);
  }

  const { slug } = await params;
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const scenario = await createScenarioRepository(supabase).getBySlug(slug);

  if (!scenario.ok) {
    const { status, message } = scenarioErrorResponse("not_found");
    return json({ error: "not_found", message }, status);
  }

  return json({ scenario: scenario.data }, 200);
}
