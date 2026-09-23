import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/** The board's shell, so arriving from the nav is a click. */
export default function Loading() {
  return <OpsSkeleton title="Feature proposals" bands={2} />;
}
