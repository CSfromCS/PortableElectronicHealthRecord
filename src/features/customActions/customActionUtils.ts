import { db } from '@/db'
import { patientHasTagAnywhere } from '@/features/tags/tagUtils'
import type { CustomAction, CustomActionCondition, CustomActionRun, CustomActionTagEffect, Patient, TagDefinition, TagEvent } from '@/types'

/** True if `condition`'s day-of-week/day-of-month restrictions (if any) match `referenceDate` — an
 * empty/undefined list on either axis means no restriction there. Both restrictions (when set)
 * must pass for the date requirement as a whole to be satisfied. */
export const conditionMatchesDate = (condition: CustomActionCondition, referenceDate: Date): boolean => {
  const daysOfWeek = condition.daysOfWeek ?? []
  const daysOfMonth = condition.daysOfMonth ?? []
  const dayOfWeekOk = daysOfWeek.length === 0 || daysOfWeek.includes(referenceDate.getDay())
  const dayOfMonthOk = daysOfMonth.length === 0 || daysOfMonth.includes(referenceDate.getDate())
  return dayOfWeekOk && dayOfMonthOk
}

export const conditionMatchesPatient = (patient: Patient, condition: CustomActionCondition, referenceDate: Date = new Date()): boolean =>
  condition.requiredTagIds.every((tagId) => patientHasTagAnywhere(patient, tagId)) && conditionMatchesDate(condition, referenceDate)

/** Every condition on `action` that currently matches `patient` — conditions are independent, so several can match at once. */
export const resolveMatchingConditions = (patient: Patient, action: CustomAction, referenceDate: Date = new Date()): CustomActionCondition[] =>
  action.conditions.filter((condition) => conditionMatchesPatient(patient, condition, referenceDate))

/**
 * General-scope counterpart to resolveMatchingConditions (issue #120): a General action has no
 * associated patient, so a condition matches purely on its date restriction (if any) — its
 * requiredTagIds are always empty by construction (the UI never offers a tag picker for a
 * General action's conditions) and are ignored here regardless.
 */
export const resolveMatchingGeneralConditions = (action: CustomAction, referenceDate: Date = new Date()): CustomActionCondition[] =>
  action.conditions.filter((condition) => conditionMatchesDate(condition, referenceDate))

/** Tags `condition` requires that `patient` doesn't currently have — used to offer "add the missing tag(s) and run" when nothing matched. */
export const getMissingTagsForCondition = (patient: Patient, condition: CustomActionCondition): number[] =>
  condition.requiredTagIds.filter((tagId) => !patientHasTagAnywhere(patient, tagId))

export const formatPatientLabelForNotice = (patient: Pick<Patient, 'roomNumber' | 'lastName'>): string =>
  patient.lastName ? `Room ${patient.roomNumber} (${patient.lastName})` : `Room ${patient.roomNumber}`

/** Applies every Tag Effect in one atomic write, so effects that add and remove the same tag across different matched conditions don't race each other. */
export const applyTagEffectsToPatient = async (
  patient: Patient,
  effects: CustomActionTagEffect[],
  tagsById: Map<number, TagDefinition>,
): Promise<void> => {
  if (patient.id === undefined || effects.length === 0) return

  const patientId = patient.id
  const tagIds = new Set(patient.tagIds ?? [])
  const now = new Date().toISOString()
  const events: TagEvent[] = []

  effects.forEach((effect) => {
    const tag = tagsById.get(effect.tagId)
    if (!tag || tag.id === undefined) return

    if (effect.action === 'add') {
      if (tagIds.has(tag.id)) return
      tagIds.add(tag.id)
      events.push({ patientId, tagId: tag.id, tagName: tag.name, action: 'added', at: now })
    } else {
      if (!tagIds.has(tag.id)) return
      tagIds.delete(tag.id)
      events.push({ patientId, tagId: tag.id, tagName: tag.name, action: 'removed', at: now })
    }
  })

  if (events.length === 0) return

  await db.transaction('rw', [db.patients, db.tagEvents], async () => {
    await db.patients.update(patientId, { tagIds: Array.from(tagIds), lastModified: now })
    await db.tagEvents.bulkAdd(events)
  })
}

/** Directly adds `tagIds` to a patient (not a Tag Effect — this is used to satisfy a condition's missing requirements on the spot). */
export const addTagsToPatientDirectly = async (patient: Patient, tagIds: number[], tagsById: Map<number, TagDefinition>): Promise<void> => {
  if (patient.id === undefined || tagIds.length === 0) return
  const patientId = patient.id
  const existingTagIds = new Set(patient.tagIds ?? [])
  const toAdd = tagIds.filter((tagId) => !existingTagIds.has(tagId))
  if (toAdd.length === 0) return

  const now = new Date().toISOString()
  await db.transaction('rw', [db.patients, db.tagEvents], async () => {
    await db.patients.update(patientId, { tagIds: [...existingTagIds, ...toAdd], lastModified: now })
    await db.tagEvents.bulkAdd(
      toAdd.map((tagId) => ({
        patientId,
        tagId,
        tagName: tagsById.get(tagId)?.name ?? '',
        action: 'added' as const,
        at: now,
      })),
    )
  })
}

/** True if running `action` would do anything at all for a patient with these matched conditions — the unconditional items/effects always count, even with zero conditions defined. */
export const actionHasApplicableEffect = (action: CustomAction, matchedConditions: CustomActionCondition[]): boolean =>
  action.checklistItems.length > 0 || action.tagEffects.length > 0 || matchedConditions.length > 0

/** General-scope counterpart to actionHasApplicableEffect — a General action never has tag
 * effects, so only its unconditional checklist items and matched conditions count. */
export const actionHasApplicableGeneralEffect = (action: CustomAction, matchedConditions: CustomActionCondition[]): boolean =>
  action.checklistItems.length > 0 || matchedConditions.length > 0

/**
 * Applies an action's unconditional checklist items/Tag Effects plus every already-matched
 * condition's own checklist items and Tag Effects, for one patient. Checklist items append
 * independently (order doesn't matter), but every Tag Effect involved — unconditional and
 * per-condition alike — is combined into a single atomic write so they can't clobber each other.
 */
export const applyCustomActionEffects = async (
  patient: Patient,
  action: CustomAction,
  matchedConditions: CustomActionCondition[],
  tagsById: Map<number, TagDefinition>,
  appendChecklistItems: (items: string[]) => Promise<void> | void,
): Promise<void> => {
  if (action.checklistItems.length > 0) await appendChecklistItems(action.checklistItems)
  for (const condition of matchedConditions) {
    if (condition.checklistItems.length > 0) await appendChecklistItems(condition.checklistItems)
  }
  const combinedTagEffects = [...action.tagEffects, ...matchedConditions.flatMap((condition) => condition.tagEffects)]
  await applyTagEffectsToPatient(patient, combinedTagEffects, tagsById)
}

/**
 * General-scope counterpart to applyCustomActionEffects: appends the action's unconditional
 * checklist items plus every already-matched condition's own checklist items to the General
 * checklist. No tag effects — a General action has no associated patient to apply them to.
 */
export const applyGeneralCustomActionEffects = async (
  action: CustomAction,
  matchedConditions: CustomActionCondition[],
  appendChecklistItems: (items: string[]) => Promise<void> | void,
): Promise<void> => {
  if (action.checklistItems.length > 0) await appendChecklistItems(action.checklistItems)
  for (const condition of matchedConditions) {
    if (condition.checklistItems.length > 0) await appendChecklistItems(condition.checklistItems)
  }
}

export const hasCustomActionRunOnDate = (
  runs: CustomActionRun[],
  actionId: number | undefined,
  patientId: number | undefined,
  date: string,
): boolean => {
  if (actionId === undefined || patientId === undefined) return false
  return runs.some((run) => run.actionId === actionId && run.patientId === patientId && run.date === date)
}

export const recordCustomActionRun = async (actionId: number, patientId: number, date: string): Promise<void> => {
  await db.customActionRuns.add({ actionId, patientId, date, at: new Date().toISOString() })
}
