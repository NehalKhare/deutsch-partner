"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * Waiting for Stripe to tell us.
 *
 * The page Stripe returns to grants nothing (billing-and-plans-spec.md S5):
 * a plan exists when the webhook has written it, and not before. So this
 * asks the server to render the page again — which reads the learner's rows
 * afresh — every two seconds, and the server decides when the plan has
 * arrived. After thirty seconds it stops asking and says so, because a bank
 * payment can take days to clear and a spinner that runs for days is a lie
 * of its own.
 */

export const POLL_EVERY_MS = 2_000;
export const POLL_FOR_MS = 30_000;

export function WaitForPlan() {
  const router = useRouter();
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      router.refresh();
      if (Date.now() - started >= POLL_FOR_MS) {
        clearInterval(timer);
        setWaiting(false);
      }
    }, POLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <p role="status" aria-live="polite" className="text-sm leading-relaxed text-copy/70">
      {waiting ? (
        "Checking with Stripe… this page updates by itself."
      ) : (
        <>
          This is taking longer than usual. It can take a minute, and a bank payment such as
          SEPA Direct Debit can take a few days. Your plan appears on{" "}
          <Link href="/billing" className={cn(linkInline)}>
            Plan &amp; billing
          </Link>{" "}
          as soon as Stripe confirms it.
        </>
      )}
    </p>
  );
}
