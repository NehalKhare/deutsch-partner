import Link from "next/link";

import { QuietShell } from "@dp/ui/quiet-shell";
import { linkInline, pageTitle, prose } from "@dp/ui/styles";

/**
 * The same page for "no such route" and "not yours". Operator routes answer
 * 404 rather than 403 to a signed-in learner, so nothing here may suggest
 * what exists.
 */
export default function NotFound() {
  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Nothing here</h1>
        <p className={prose}>There is no page at this address.</p>
      </div>
      <Link href="/login" className={linkInline}>
        Sign in
      </Link>
    </QuietShell>
  );
}
