import Link from "next/link";

import { Companion } from "@/components/companion/companion";
import { QuietShell } from "@dp/ui/quiet-shell";
import { buttonPrimary, pageTitle, prose } from "@dp/ui/styles";
import { companionStateFor } from "@dp/domain/companion";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Not found — Deutsch Partner" };

/**
 * Nothing here.
 *
 * A thread that belongs to somebody else lands on this page too, and it must
 * read the same as a mistyped URL: telling the two apart would confirm the
 * thread exists to whoever guessed its id.
 */
export default function NotFound() {
  return (
    <QuietShell>
      <div className="flex flex-col items-center gap-6 text-center">
        <Companion
          state={companionStateFor({ miniLevel: 1, activity: "struggling" })}
          decorative
          className="[--companion-size:6rem]"
        />
        <h1 className={pageTitle}>Nichts gefunden</h1>
        <p className={cn(prose, "max-w-sm")}>
          Nothing found. This page does not exist, or it is not yours.
        </p>
        <Link href="/" className={buttonPrimary}>
          Back to the start
        </Link>
      </div>
    </QuietShell>
  );
}
