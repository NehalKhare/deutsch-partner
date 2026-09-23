/**
 * Maps items with at most `limit` calls in flight, preserving input order in
 * the results. N workers each pull the next unclaimed index, so a slow item
 * delays only its own worker, never the queue behind it.
 *
 * The mapper must not reject: the ingestion pipeline converts every failure
 * into a reported outcome, and this helper holds it to that by letting a
 * rejection propagate and abandon the run.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };

  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
