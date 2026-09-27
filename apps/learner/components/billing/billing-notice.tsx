import { pageTitle, prose } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * A billing page with nothing to act on: no such plan, payments off, a
 * subscription already held, a price that is missing. Calm and plain, with
 * the way on — never a button that cannot keep its promise.
 */
export function BillingNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <h1 className={pageTitle}>{title}</h1>
      <div className={cn(prose, "flex flex-col gap-3")}>{children}</div>
    </main>
  );
}
