import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/** The page's own title while the aggregate is read. */
export default function Loading() {
  return <OpsSkeleton title="Trainer feedback" bands={3} />;
}
