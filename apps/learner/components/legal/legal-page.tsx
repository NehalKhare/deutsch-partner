import { eyebrow, pageTitle, prose } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { PublicFooter } from "@/components/site/public-footer";
import { PublicHeader } from "@/components/site/public-header";
import { PRICING_PATH } from "@/lib/billing/offers";

/**
 * The shell every legal page stands in: the public header, a title with the
 * version or date above it, running text, and the footer with the links the
 * law puts there. Public and readable without an account, because the
 * Impressum and the privacy policy are owed to a visitor, not to a learner.
 */
export function LegalPage({
  eyebrow: above,
  title,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy">
      <PublicHeader shortcut={{ href: PRICING_PATH, label: "Pricing", beta: true }} />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12 md:px-10 md:py-16">
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>{above}</p>
          <h1 className={pageTitle}>{title}</h1>
        </div>
        {children}
      </main>

      <PublicFooter />
    </div>
  );
}

/** A numbered or named section of a legal text. */
export function LegalSection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-display text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className={cn(prose, "flex flex-col gap-3 text-sm")}>{children}</div>
    </section>
  );
}

export const legalList = "flex list-disc flex-col gap-1.5 pl-5";

/** A definition-style table: label on the left, value on the right. */
export function LegalTable({
  rows,
}: {
  readonly rows: ReadonlyArray<readonly [string, React.ReactNode]>;
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-copy/55">{label}</dt>
          <dd className="text-copy">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
