import { db } from '@/db'
import { getAppliedPatientTags } from '@/features/tags/tagUtils'
import type { CustomAction, CustomActionRun, CustomActionTagEffect, CustomActionVariantKey, Patient, TagDefinition, TagEvent } from '@/types'

export type CustomActionVariantResolution = {
  variantKey: CustomActionVariantKey | null
  categoryAmbiguous: boolean
  relationshipAmbiguous: boolean
}

/**
 * Determines which of the four Task List Variants applies to a patient right now (issue #75,
 * point 3): exactly one Category-role tag and exactly one Relationship-role tag must be applied.
 * Zero or 2+ of either counts as ambiguous for this lookup — unlike the general tag-ambiguity
 * badge (findTagAmbiguities), which only flags 2+, a Custom Action can't guess when neither role
 * has been assigned yet either.
 */
export const resolveCustomActionVariant = (
  patient: Pick<Patient, 'tagIds'>,
  tagsById: Map<number, TagDefinition>,
): CustomActionVariantResolution => {
  const applied = getAppliedPatientTags(patient, tagsById)
  const categoryTags = applied.filter((tag) => tag.automationRole === 'category-cd' || tag.automationRole === 'category-pd')
  const relationshipTags = applied.filter((tag) => tag.automationRole === 'relationship-main' || tag.automationRole === 'relationship-referral')

  const categoryAmbiguous = categoryTags.length !== 1
  const relationshipAmbiguous = relationshipTags.length !== 1
  if (categoryAmbiguous || relationshipAmbiguous) {
    return { variantKey: null, categoryAmbiguous, relationshipAmbiguous }
  }

  const category = categoryTags[0].automationRole === 'category-cd' ? 'cd' : 'pd'
  const relationship = relationshipTags[0].automationRole === 'relationship-main' ? 'main' : 'referral'
  return { variantKey: `${category}-${relationship}` as CustomActionVariantKey, categoryAmbiguous: false, relationshipAmbiguous: false }
}

export const formatPatientLabelForNotice = (patient: Pick<Patient, 'roomNumber' | 'lastName'>): string =>
  patient.lastName ? `Room ${patient.roomNumber} (${patient.lastName})` : `Room ${patient.roomNumber}`

/** Applies every Tag Effect in one atomic write, so effects that add and remove the same tag don't race each other (point 3). */
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

export type CustomActionRunResult = {
  /** Set when the Category/Relationship lookup was ambiguous — the checklist portion was skipped, but Tag Effects still ran (point 3). */
  ambiguityMessage: string | null
}

/**
 * Runs one Custom Action for one patient: resolves the Task List Variant and appends it via
 * `appendChecklistItems` (or reports ambiguity instead), then applies Tag Effects independently
 * regardless of the checklist outcome (point 3). Does not touch the once-per-day duplicate-
 * prevention record — callers running a Manual action record that themselves via
 * `recordCustomActionRun`, since Automatic actions don't participate in that rule at all.
 */
export const runCustomActionForPatient = async (
  patient: Patient,
  action: CustomAction,
  tagsById: Map<number, TagDefinition>,
  appendChecklistItems: (items: string[]) => Promise<void> | void,
): Promise<CustomActionRunResult> => {
  const { variantKey, categoryAmbiguous, relationshipAmbiguous } = resolveCustomActionVariant(patient, tagsById)

  let ambiguityMessage: string | null = null
  if (variantKey) {
    const items = action.variants[variantKey]
    if (items.length > 0) await appendChecklistItems(items)
  } else {
    const reasons = [categoryAmbiguous ? 'Category' : null, relationshipAmbiguous ? 'Relationship' : null].filter(Boolean)
    ambiguityMessage = `Could not run "${action.name}" for ${formatPatientLabelForNotice(patient)} — ${reasons.join(' and ')} is ambiguous. Resolve and retry.`
  }

  await applyTagEffectsToPatient(patient, action.tagEffects, tagsById)

  return { ambiguityMessage }
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
