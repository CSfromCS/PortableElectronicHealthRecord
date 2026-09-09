import { useCallback, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, TouchEvent } from 'react'

export type DragReorderKey = string | number

/** Where a drop would insert the dragged item relative to the hovered row. */
export type DropPosition = 'before' | 'after'

export type DragReorderController<K extends DragReorderKey> = {
  isDragging: (key: K) => boolean
  /** 'before'/'after' when this key is the current hover target and a drop right now would
   * insert the dragged item immediately before/after it — null otherwise. Render a thin
   * insertion-line indicator on whichever edge this returns (e.g. a top/bottom border), instead
   * of highlighting the whole row — which edge lights up is determined by which half of the row
   * the pointer is over, so the landing spot is unambiguous regardless of drag direction. */
  dropIndicator: (key: K) => DropPosition | null
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

/** className fragment for the thin insertion-line indicator described by `dropIndicator(key)` —
 * a colored top/bottom border rather than a ring around the whole row, so it's unambiguous which
 * edge the dragged item will land on. Pass through `cn(...)` alongside a row's own border classes
 * so tailwind-merge resolves any width/color overlap in this class's favor. */
export const dropIndicatorClassName = (position: DropPosition | null): string | undefined => {
  if (position === 'before') return 'border-t-2 border-t-action-primary'
  if (position === 'after') return 'border-b-2 border-b-action-primary'
  return undefined
}

type DragTarget<K> = { key: K; position: DropPosition }

/** Splits `rect` at its vertical midpoint to decide whether `clientY` is over the top or bottom
 * half of a row — the top half means "insert before this row", the bottom half "insert after". */
const positionWithinRect = (clientY: number, rect: DOMRect): DropPosition =>
  clientY < rect.top + rect.height / 2 ? 'before' : 'after'

/**
 * Generic pointer + touch + keyboard drag-to-reorder controller, reusable across any list in the
 * app. It only tracks gesture state (which key is being dragged, which key/edge it's currently
 * over) — the consumer supplies the ordered list of keys and an
 * onReorder(sourceKey, targetKey, position) callback that decides what a drop actually means
 * (array splice, sortOrder rewrite, persistence, etc). `position` always reflects an explicit
 * "insert before/after the target" instruction, determined by which half of the target row the
 * pointer was over — never an implicit "swap with" or direction-dependent placement.
 *
 * Usage: spread getHandleProps(key) onto the drag handle element (e.g. a grip icon button) and
 * getItemProps(key) onto the row/item container so drops anywhere on the row are recognized.
 * Ctrl/Cmd+ArrowUp/ArrowDown on a focused handle moves that item one step, for keyboard access.
 */
export function useDragReorder<K extends DragReorderKey>(
  orderedKeys: K[],
  onReorder: (sourceKey: K, targetKey: K, position: DropPosition) => void,
): DragReorderController<K> {
  const [draggingKey, setDraggingKey] = useState<K | null>(null)
  const [overTarget, setOverTarget] = useState<DragTarget<K> | null>(null)
  const draggingKeyRef = useRef<K | null>(null)
  const overTargetRef = useRef<DragTarget<K> | null>(null)

  const setOverTargetBoth = useCallback((next: DragTarget<K> | null) => {
    overTargetRef.current = next
    setOverTarget(next)
  }, [])

  const reset = useCallback(() => {
    draggingKeyRef.current = null
    setDraggingKey(null)
    setOverTargetBoth(null)
  }, [setOverTargetBoth])

  const beginDrag = useCallback((key: K) => {
    draggingKeyRef.current = key
    setDraggingKey(key)
  }, [])

  const finishDrag = useCallback((target: DragTarget<K> | null) => {
    const sourceKey = draggingKeyRef.current
    if (sourceKey !== null && target !== null && sourceKey !== target.key) {
      onReorder(sourceKey, target.key, target.position)
    }
    reset()
  }, [onReorder, reset])

  const findTargetFromPoint = useCallback((x: number, y: number): DragTarget<K> | null => {
    const element = document.elementFromPoint(x, y)
    const rowElement = element?.closest(`[${DRAG_KEY_ATTR}]`)
    const rawKey = rowElement?.getAttribute(DRAG_KEY_ATTR)
    if (!rowElement || rawKey === null || rawKey === undefined) return null
    const key = orderedKeys.find((candidate) => String(candidate) === rawKey) ?? null
    if (key === null) return null
    return { key, position: positionWithinRect(y, rowElement.getBoundingClientRect()) }
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
      setOverTargetBoth(findTargetFromPoint(touch.clientX, touch.clientY))
    },
    onTouchEnd: () => finishDrag(overTargetRef.current),
    onTouchCancel: () => reset(),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const index = orderedKeys.indexOf(key)
      if (event.key === 'ArrowUp') {
        const targetKey = orderedKeys[index - 1]
        if (targetKey !== undefined) onReorder(key, targetKey, 'before')
      } else {
        const targetKey = orderedKeys[index + 1]
        if (targetKey !== undefined) onReorder(key, targetKey, 'after')
      }
    },
  }), [beginDrag, finishDrag, findTargetFromPoint, onReorder, orderedKeys, reset, setOverTargetBoth])

  const getItemProps = useCallback((key: K) => ({
    [DRAG_KEY_ATTR]: String(key),
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (draggingKeyRef.current === null) return
      event.preventDefault()
      const position = positionWithinRect(event.clientY, event.currentTarget.getBoundingClientRect())
      if (overTargetRef.current?.key !== key || overTargetRef.current?.position !== position) {
        setOverTargetBoth({ key, position })
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const position = positionWithinRect(event.clientY, event.currentTarget.getBoundingClientRect())
      finishDrag({ key, position })
    },
  }), [finishDrag, setOverTargetBoth])

  return {
    isDragging: (key: K) => draggingKey === key,
    dropIndicator: (key: K) => (overTarget?.key === key && draggingKey !== null && draggingKey !== key ? overTarget.position : null),
    getHandleProps,
    getItemProps,
  }
}
