import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/** Nested inside the board's, so arriving here shows this page's own title. */
export default function Loading() {
  return <OpsSkeleton title="Market scans & runs" bands={3} />;
}
