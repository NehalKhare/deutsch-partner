import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/** The board's shell, so arriving from the rail is a click. */
export default function Loading() {
  return <OpsSkeleton title="Feature proposals" bands={2} />;
}
