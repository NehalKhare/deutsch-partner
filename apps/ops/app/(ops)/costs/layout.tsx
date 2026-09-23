import { CostsTabs } from "@/components/costs/costs-tabs";

/**
 * The spend room's four pages share one row of tabs.
 *
 * No operator check of its own: the (ops) layout above it guards the segment,
 * and every page checks again, because a page is reachable through a prefetch
 * that never rendered its parents.
 */
export default function CostsLayout({ children }: LayoutProps<"/costs">) {
  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-6 pt-6 md:px-10">
        <CostsTabs />
      </div>
      {children}
    </>
  );
}
