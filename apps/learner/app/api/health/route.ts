/**
 * Liveness for the platform. No database and no session: a health check that
 * needs either turns a dependency blip into a restart.
 */
export function GET() {
  return Response.json({ ok: true, service: "learner" });
}
