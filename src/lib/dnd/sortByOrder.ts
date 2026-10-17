/** Returns a copy of `items` in the user's arranged order (`sortOrder`, ascending). Ties — two items
 * sharing a `sortOrder`, e.g. after a sync merge — fall back to `id` so the order stays stable
 * between renders. Every list a user can drag to reorder should reach a picker, dropdown or
 * automation through this, never straight from `db.<table>.toArray()` (which is insertion order). */
export function sortByOrder<T extends { sortOrder: number; id?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || (a.id ?? 0) - (b.id ?? 0))
}
