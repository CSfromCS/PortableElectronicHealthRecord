import type { DropPosition } from './useDragReorder'

/** Moves the item with sourceKey to sit immediately before/after the item with targetKey,
 * preserving the rest of the order — an explicit insertion point, not a swap, so the result never
 * depends on which direction the source happened to move from. */
export function moveItemByKey<T, K>(items: T[], getKey: (item: T) => K, sourceKey: K, targetKey: K, position: DropPosition): T[] {
  if (sourceKey === targetKey) return items
  const sourceIndex = items.findIndex((item) => getKey(item) === sourceKey)
  if (sourceIndex === -1) return items

  const next = [...items]
  const [moved] = next.splice(sourceIndex, 1)

  const targetIndex = next.findIndex((item) => getKey(item) === targetKey)
  if (targetIndex === -1) return items

  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
  next.splice(insertIndex, 0, moved)
  return next
}
