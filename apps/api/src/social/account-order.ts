/**
 * The project's connections in the order its members arranged them; accounts that are not in the
 * saved order (connected later) follow, oldest first. Ids in the saved order that no longer exist
 * are ignored.
 */
export function orderAccounts<T extends { id: string; createdAt: Date }>(
  accounts: readonly T[],
  saved: readonly string[],
): T[] {
  const rank = new Map(saved.map((id, i) => [id, i]));
  return [...accounts].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
