import { db } from '@/db'
import { toPendingProblemBlocks } from '@/features/problems/problemUtils'
import type { DailyUpdate } from '@/types'

export type ChecklistItem = { text: string; completed: boolean }

export const normalizeChecklistItems = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
  (items ?? [])
    .map((item) => ({
      text: item.text.trim(),
      completed: Boolean(item.completed),
    }))
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
