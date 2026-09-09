import { useRef, useState } from 'react'
import type { TouchEvent } from 'react'

export type EntrySelectionController = {
  selectionMode: boolean
  setSelectionMode: (value: boolean) => void
  selectedIds: Set<number>
  isSelected: (id: number | undefined) => boolean
  toggle: (id: number | undefined) => void
  /** Selects every id in `ids` if they aren't ALL already selected; otherwise clears the
   * selection (a standard "select all" checkbox toggle). Undefined entries are ignored. */
  toggleSelectAll: (ids: (number | undefined)[]) => void
  exit: () => void
  handleTouchStart: (id: number | undefined) => void
  handleTouchEnd: (event: TouchEvent<HTMLElement>) => void
  cancelLongPress: () => void
}

/**
 * Generic long-press-to-select + checkbox multi-select controller, reusable across any per-patient
 * list (Vitals, Labs, Medications, Orders, Photos) — mirrors the Patients list's own selection
 * gesture exactly (500ms touch long-press enters selection mode and selects the pressed item; a
 * checkbox is always available on desktop; a normal tap/click on a row toggles it once already in
 * selection mode). The consumer owns the actual list and bulk actions; this only tracks which ids
 * are selected. `handleTouchEnd`'s preventDefault suppresses the synthetic click that would
 * otherwise follow a long-press's touchend and double-toggle the item it just selected.
 */
export function useEntrySelection(): EntrySelectionController {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)

  const toggle = (id: number | undefined) => {
    if (id === undefined) return
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exit = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const toggleSelectAll = (ids: (number | undefined)[]) => {
    const definedIds = ids.filter((id): id is number => id !== undefined)
    setSelectedIds((previous) => {
      const allAlreadySelected = definedIds.length > 0 && definedIds.every((id) => previous.has(id))
      return allAlreadySelected ? new Set() : new Set(definedIds)
    })
  }

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleTouchStart = (id: number | undefined) => {
    if (id === undefined) return
    longPressFiredRef.current = false
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      setSelectionMode(true)
      toggle(id)
    }, 500)
  }

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    cancelLongPress()
    if (longPressFiredRef.current) event.preventDefault()
    longPressFiredRef.current = false
  }

  return {
    selectionMode,
    setSelectionMode,
    selectedIds,
    isSelected: (id) => id !== undefined && selectedIds.has(id),
    toggle,
    toggleSelectAll,
    exit,
    handleTouchStart,
    handleTouchEnd,
    cancelLongPress,
  }
}
