import { db } from '@/db'
import { toPendingProblemBlocks } from '@/features/problems/problemUtils'
import type { DailyUpdate } from '@/types'

export type ChecklistItem = { text: string; completed: boolean; notes?: string }

/** Shared field cleanup (trim text/notes, coerce completed to boolean) without dropping
 * blank-text items — see normalizeChecklistItemsKeepingBlanks for why that matters. */
const cleanChecklistItemFields = (item: ChecklistItem): ChecklistItem => {
  const trimmedNotes = (item.notes ?? '').trim()
  return {
    text: item.text.trim(),
    completed: Boolean(item.completed),
    ...(trimmedNotes ? { notes: trimmedNotes } : {}),
  }
}

export const normalizeChecklistItems = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
  (items ?? []).map(cleanChecklistItemFields).filter((item) => item.text.length > 0)

/**
 * Like normalizeChecklistItems, but keeps blank-text items instead of dropping them. The
 * per-patient Checklist tab's local form state is the source of truth for what's on screen —
 * normalizeChecklistItems only strips blanks at the point of actually persisting to IndexedDB,
 * which doesn't affect what's still visibly on screen. The Master Checklist view has no such
 * local layer: what's rendered is re-derived from IndexedDB on every edit, so if a split's blank
 * "after" item (e.g. pressing Enter at the end of a line) were stripped on write/read the same
 * way, it would vanish before it could ever be typed into. Used only for the checklist actively
 * being edited "live" in Master Checklist; carrying items forward to a new date still uses the
 * blank-dropping version, since a carried-forward blank is just a stale abandoned edit.
 */
export const normalizeChecklistItemsKeepingBlanks = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
  (items ?? []).map(cleanChecklistItemFields)

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

export type ChecklistInsertResult = {
  items: ChecklistItem[]
  focusIndex: number
}

/**
 * Inserts a new blank item immediately after `index`, inheriting its completed state. Used when
 * Enter is pressed inside an item's *notes* (issue #78 follow-up): unlike splitting the item's
 * main text, the notes text is never divided — it stays put on the original item while a fresh
 * item appears right below it, ready to type into.
 */
export const insertBlankChecklistItemAfter = (items: ChecklistItem[], index: number): ChecklistInsertResult | null => {
  const existing = items[index]
  if (!existing) return null

  const nextItems = [...items]
  nextItems.splice(index + 1, 0, { text: '', completed: existing.completed })
  return { items: nextItems, focusIndex: index + 1 }
}

export type ChecklistMergeResult = {
  items: ChecklistItem[]
  focusIndex: number
  caretOffset: number
}

/**
 * Backspacing at the start of an item (caret at offset 0, regardless of whether the item is
 * empty) merges it into the previous item — appends its text onto the previous item's and
 * deletes it, moving the cursor to the exact join point. Deliberately mirrors
 * splitChecklistItemAtCursor's split: this is how an accidental Enter-triggered split gets
 * undone by simply backspacing it away again, not just an empty-line-deletion shortcut.
 *
 * `currentText` — the item's *live* text, read straight from the DOM field at keydown time —
 * must be passed in rather than read from `items[index].text`: TapToEditField debounces commits,
 * so if Backspace-to-merge fires before that debounce (or a blur) has landed, `items[index].text`
 * would still be whatever was last actually committed, silently discarding whatever was just
 * typed instead of merging it in.
 */
export const mergeChecklistItemIntoPrevious = (
  items: ChecklistItem[],
  index: number,
  currentText: string,
): ChecklistMergeResult | null => {
  if (index <= 0 || index >= items.length) return null
  const previous = items[index - 1]
  if (!previous) return null

  const nextItems = [...items]
  nextItems.splice(index - 1, 2, { ...previous, text: previous.text + currentText })
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
