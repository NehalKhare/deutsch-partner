import { siteEnv } from "@/lib/env/server";
import { llmsText } from "@/lib/seo/llms";

/** Read per request: the links in it are absolute and the origin is the deployment's. */
export const dynamic = "force-dynamic";

/**
 * /llms.txt, for the answer engines. Plain text, cached for an hour at the
 * edge: it changes when the copy changes, which is a deployment.
 */
export function GET() {
  return new Response(llmsText(siteEnv().appUrl), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
