import { db } from '@/db'
import { appendChecklistItemsForPatientDate } from '@/features/checklist/checklistUtils'
import type { CustomAction, Patient, TagDefinition } from '@/types'
import {
  actionHasApplicableEffect,
  applyCustomActionEffects,
  formatPatientLabelForNotice,
  resolveMatchingConditions,
} from './customActionUtils'

/** Adds checklist items to a patient's checklist for a date straight in the database, skipping any
 * text already listed there, and marks the patient as modified. */
export const appendChecklistItemsToPatientDate = async (patientId: number, date: string, items: string[]): Promise<void> => {
  if (items.length === 0) return
  await appendChecklistItemsForPatientDate(patientId, date, items)
  await db.patients.update(patientId, { lastModified: new Date().toISOString() })
}

/**
 * Fires every "Automatic on tag added" Custom Action whose trigger tag is in `addedTagIds`,
 * regardless of how the tag(s) got added. A patient matching none of an action's conditions is
 * simply left unaffected, and named in the returned messages. Shared by the app and the MCP
 * bridge so tagging a patient does the same thing wherever it happens.
 */
export const runAutomaticCustomActionsForTagAddition = async (options: {
  patientAfterAdd: Patient
  addedTagIds: number[]
  customActions: CustomAction[]
  tagsById: Map<number, TagDefinition>
  today: string
  appendChecklistItems: (patientId: number, date: string, items: string[]) => Promise<void>
}): Promise<string[]> => {
  const { patientAfterAdd, addedTagIds, customActions, tagsById, today, appendChecklistItems } = options
  if (patientAfterAdd.id === undefined || addedTagIds.length === 0) return []
  const patientId = patientAfterAdd.id
  const addedTagIdSet = new Set(addedTagIds)
  const matchingActions = customActions.filter(
    (action) => !action.disabled && action.triggerType === 'automatic' && action.triggerTagId !== undefined && addedTagIdSet.has(action.triggerTagId),
  )

  const unaffectedMessages: string[] = []
  for (const action of matchingActions) {
    const matched = resolveMatchingConditions(patientAfterAdd, action)
    if (!actionHasApplicableEffect(action, matched)) {
      unaffectedMessages.push(`"${action.name}" did not affect ${formatPatientLabelForNotice(patientAfterAdd)} — no condition was met.`)
      continue
    }
    await applyCustomActionEffects(
      patientAfterAdd,
      action,
      matched,
      tagsById,
      (items) => appendChecklistItems(patientId, today, items),
    )
  }
  return unaffectedMessages
}
