import { db } from '@/db'
import { toPendingProblemBlocks } from '@/features/problems/problemUtils'
import type { DailyUpdate } from '@/types'

export type ChecklistItem = { text: string; completed: boolean; notes?: string }

export const normalizeChecklistItems = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
  (items ?? [])
    .map((item) => {
      const trimmedNotes = (item.notes ?? '').trim()
      return {
        text: item.text.trim(),
        completed: Boolean(item.completed),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      }
    })
    .filter((item) => item.text.length > 0)

export const toPendingChecklistItems = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
  normalizeChecklistItems(items)
    .filter((item) => !item.completed)
    .map((item) => ({ ...item, completed: false }))

/**
 * New items go immediately after the last unchecked item (i.e. right before the first checked
 * item), or at the very top if every existing item is already checked — mirroring where a
 * reopened item lands when an item is marked pending again (default insertion-position logic,
 * see issue #69).
 */
export const insertNewChecklistItem = (items: ChecklistItem[], newItem: ChecklistItem): ChecklistItem[] => {
  const firstCompletedIndex = items.findIndex((item) => item.completed)
  const insertIndex = firstCompletedIndex < 0 ? items.length : firstCompletedIndex
  const nextItems = [...items]
  nextItems.splice(insertIndex, 0, newItem)
  return nextItems
}

export type ChecklistSplitResult = {
  items: ChecklistItem[]
  /** Index of the newly created (after-cursor) item, to move the cursor to. Null if the split
   * had nothing to do (e.g. Enter pressed on an already-blank draft line). */
  focusIndex: number | null
}

/**
 * Splits the item at `index` at `caretOffset` within `fieldValue` into two items, in place —
 * neither is re-sorted (issue #78, distinct from `insertNewChecklistItem`'s default-position
 * logic, which this leaves untouched for other entry points). The text before the cursor stays
 * at `index`; the text after becomes a new item immediately following it, inheriting the same
 * completed state (so splitting inside an already-completed item marks both halves completed).
 * `index` may be one past the end of `items` — used for the always-present blank draft line at
 * the end of the list — in which case a real item is only created if there's actual text.
 */
export const splitChecklistItemAtCursor = (
  items: ChecklistItem[],
  index: number,
  fieldValue: string,
  caretOffset: number,
): ChecklistSplitResult => {
  const before = fieldValue.slice(0, caretOffset).trim()
  const after = fieldValue.slice(caretOffset).trim()
  const existing = items[index]

  if (!existing && !before && !after) {
    return { items, focusIndex: null }
  }

  const completed = existing?.completed ?? false
  const beforeItem: ChecklistItem = existing?.notes ? { text: before, completed, notes: existing.notes } : { text: before, completed }
  const nextItems = [...items]
  nextItems[index] = beforeItem
  nextItems.splice(index + 1, 0, { text: after, completed })
  return { items: nextItems, focusIndex: index + 1 }
}

export type ChecklistMergeResult = {
  items: ChecklistItem[]
  focusIndex: number
  caretOffset: number
}

/**
 * Backspacing at the start of an empty line merges it into the previous item — deletes the
 * empty item and moves the cursor to the end of the previous item's (unchanged, since the
 * merged line was empty) text, mirroring standard text-editor empty-line deletion.
 */
export const mergeChecklistItemIntoPrevious = (items: ChecklistItem[], index: number): ChecklistMergeResult | null => {
  if (index <= 0 || index >= items.length) return null
  const previous = items[index - 1]
  const current = items[index]
  if (!previous || !current) return null

  const nextItems = [...items]
  nextItems.splice(index - 1, 2, { ...previous, text: previous.text + current.text })
  return { items: nextItems, focusIndex: index - 1, caretOffset: previous.text.length }
}

/**
 * Ensures the list always ends with exactly one blank, unchecked line — the "type here to add
 * a new item" affordance at the bottom of a continuous checklist (issue #78), rendered like any
 * other row but not itself persisted (normalizeChecklistItems drops empty-text items on save).
 */
export const withTrailingBlankChecklistItem = (items: ChecklistItem[]): ChecklistItem[] => {
  const lastItem = items[items.length - 1]
  if (lastItem && lastItem.text.trim().length === 0) return items
  return [...items, { text: '', completed: false }]
}

export const selectLatestDailyUpdate = (updates: DailyUpdate[]): DailyUpdate | null => {
  if (updates.length === 0) return null

  return updates.reduce((latest, candidate) => {
    if (candidate.date > latest.date) return candidate
    if (candidate.date < latest.date) return latest

    const latestTimestamp = Date.parse(latest.lastUpdated)
    const candidateTimestamp = Date.parse(candidate.lastUpdated)
    if (Number.isFinite(candidateTimestamp) && Number.isFinite(latestTimestamp)) {
      return candidateTimestamp >= latestTimestamp ? candidate : latest
    }

    return candidate
  })
}

/**
 * Appends `itemTexts` to a patient's checklist for `date` directly in IndexedDB, using the same
 * default insertion position and carry-forward-from-prior-date behavior as the Checklist tab
 * itself. Used by Custom Actions (issue #75) when appending to a patient whose Checklist tab
 * isn't the currently open form — callers editing an already-open form should instead update
 * that form's local state so the existing autosave persists everything together.
 */
export const appendChecklistItemsForPatientDate = async (
  patientId: number,
  date: string,
  itemTexts: string[],
): Promise<void> => {
  const cleanTexts = itemTexts.map((text) => text.trim()).filter((text) => text.length > 0)
  if (cleanTexts.length === 0) return

  const now = new Date().toISOString()
  const existingEntry = await db.dailyUpdates.where('[patientId+date]').equals([patientId, date]).first()

  if (existingEntry) {
    let checklist = normalizeChecklistItems(existingEntry.checklist)
    cleanTexts.forEach((text) => {
      checklist = insertNewChecklistItem(checklist, { text, completed: false })
    })
    await db.dailyUpdates.update(existingEntry.id as number, { checklist, lastUpdated: now })
    return
  }

  const priorUpdates = (await db.dailyUpdates.where('patientId').equals(patientId).toArray())
    .filter((entry) => entry.date < date)
  const latestPriorUpdate = selectLatestDailyUpdate(priorUpdates)

  let checklist = toPendingChecklistItems(latestPriorUpdate?.checklist)
  cleanTexts.forEach((text) => {
    checklist = insertNewChecklistItem(checklist, { text, completed: false })
  })

  await db.dailyUpdates.add({
    patientId,
    date,
    problems: toPendingProblemBlocks(latestPriorUpdate?.problems),
    assessment: '',
    plans: '',
    checklist,
    lastUpdated: now,
  })
}
