/** Moves the item with sourceKey to sit where the item with targetKey currently is, preserving the rest of the order. */
export function moveItemByKey<T, K>(items: T[], getKey: (item: T) => K, sourceKey: K, targetKey: K): T[] {
  const sourceIndex = items.findIndex((item) => getKey(item) === sourceKey)
  const targetIndex = items.findIndex((item) => getKey(item) === targetKey)
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return items

  const next = [...items]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}
