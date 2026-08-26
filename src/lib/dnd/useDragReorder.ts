import { useCallback, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, TouchEvent } from 'react'

export type DragReorderKey = string | number

export type DragReorderController<K extends DragReorderKey> = {
  isDragging: (key: K) => boolean
  isDropTarget: (key: K) => boolean
  getHandleProps: (key: K) => {
    draggable: true
    'data-drag-key': string
    onDragStart: (event: DragEvent<HTMLElement>) => void
    onDragEnd: () => void
    onTouchStart: (event: TouchEvent<HTMLElement>) => void
    onTouchMove: (event: TouchEvent<HTMLElement>) => void
    onTouchEnd: () => void
    onTouchCancel: () => void
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  }
  getItemProps: (key: K) => {
    'data-drag-key': string
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
}

const DRAG_KEY_ATTR = 'data-drag-key'

/**
 * Generic pointer + touch + keyboard drag-to-reorder controller, reusable across any list in the
 * app. It only tracks gesture state (which key is being dragged, which key it's currently over) —
 * the consumer supplies the ordered list of keys and an onReorder(sourceKey, targetKey) callback
 * that decides what a drop actually means (array splice, sortOrder rewrite, persistence, etc).
 *
 * Usage: spread getHandleProps(key) onto the drag handle element (e.g. a grip icon button) and
 * getItemProps(key) onto the row/item container so drops anywhere on the row are recognized.
 * Ctrl/Cmd+ArrowUp/ArrowDown on a focused handle moves that item one step, for keyboard access.
 */
export function useDragReorder<K extends DragReorderKey>(
  orderedKeys: K[],
  onReorder: (sourceKey: K, targetKey: K) => void,
): DragReorderController<K> {
  const [draggingKey, setDraggingKey] = useState<K | null>(null)
  const [overKey, setOverKey] = useState<K | null>(null)
  const draggingKeyRef = useRef<K | null>(null)

  const reset = useCallback(() => {
    draggingKeyRef.current = null
    setDraggingKey(null)
    setOverKey(null)
  }, [])

  const beginDrag = useCallback((key: K) => {
    draggingKeyRef.current = key
    setDraggingKey(key)
  }, [])

  const finishDrag = useCallback((targetKey: K | null) => {
    const sourceKey = draggingKeyRef.current
    if (sourceKey !== null && targetKey !== null && sourceKey !== targetKey) {
      onReorder(sourceKey, targetKey)
    }
    reset()
  }, [onReorder, reset])

  const findKeyFromPoint = useCallback((x: number, y: number): K | null => {
    const element = document.elementFromPoint(x, y)
    const rowElement = element?.closest(`[${DRAG_KEY_ATTR}]`)
    const rawKey = rowElement?.getAttribute(DRAG_KEY_ATTR)
    if (rawKey === null || rawKey === undefined) return null
    return orderedKeys.find((key) => String(key) === rawKey) ?? null
  }, [orderedKeys])

  const getHandleProps = useCallback((key: K) => ({
    draggable: true as const,
    [DRAG_KEY_ATTR]: String(key),
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(key))
      beginDrag(key)
    },
    onDragEnd: () => reset(),
    onTouchStart: () => beginDrag(key),
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      if (draggingKeyRef.current === null) return
      event.preventDefault()
      const touch = event.touches[0]
      if (!touch) return
      setOverKey(findKeyFromPoint(touch.clientX, touch.clientY))
    },
    onTouchEnd: () => finishDrag(overKey),
    onTouchCancel: () => reset(),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const index = orderedKeys.indexOf(key)
      const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
      const targetKey = orderedKeys[targetIndex]
      if (targetKey !== undefined) onReorder(key, targetKey)
    },
  }), [beginDrag, finishDrag, findKeyFromPoint, onReorder, orderedKeys, overKey, reset])

  const getItemProps = useCallback((key: K) => ({
    [DRAG_KEY_ATTR]: String(key),
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (draggingKeyRef.current === null) return
      event.preventDefault()
      if (overKey !== key) setOverKey(key)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      finishDrag(key)
    },
  }), [finishDrag, overKey])

  return {
    isDragging: (key: K) => draggingKey === key,
    isDropTarget: (key: K) => overKey === key && draggingKey !== null && draggingKey !== key,
    getHandleProps,
    getItemProps,
  }
}
