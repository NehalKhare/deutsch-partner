import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/** The page's own title while the inbox is read. */
export default function Loading() {
  return <OpsSkeleton title="Notifications" bands={2} />;
}
