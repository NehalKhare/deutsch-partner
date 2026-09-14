import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/** The board's shell, so the switch between the two pages is a click. */
export default function Loading() {
  return <OpsSkeleton title="Product ops" bands={2} />;
}
