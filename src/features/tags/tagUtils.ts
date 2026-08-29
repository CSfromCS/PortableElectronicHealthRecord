import { db } from '@/db'
import { toLocalISODate } from '@/lib/dateTime'
import type { Patient, TagDefinition, TagGroupDefinition } from '@/types'
import { AUTOMATION_ROLE_FAMILY, type AutomationRoleFamily, UNGROUPED_LABEL } from './tagConstants'

export const sortTagGroups = (groups: TagGroupDefinition[]): TagGroupDefinition[] =>
  [...groups].sort((a, b) => a.sortOrder - b.sortOrder)

export const sortTagsInGroup = (tags: TagDefinition[]): TagDefinition[] =>
  [...tags].sort((a, b) => a.sortOrder - b.sortOrder)

export type TagGroupBucket = {
  groupId: number | null
  groupName: string
  tags: TagDefinition[]
}

/** Groups tags under their Tag Group in canonical (group order, then tag order) order; Ungrouped is always last. */
export const bucketTagsByGroup = (
  tags: TagDefinition[],
  groups: TagGroupDefinition[],
): TagGroupBucket[] => {
  const orderedGroups = sortTagGroups(groups)
  const tagsByGroupId = new Map<number | null, TagDefinition[]>()

  tags.forEach((tag) => {
    const key = tag.groupId ?? null
    const list = tagsByGroupId.get(key) ?? []
    list.push(tag)
    tagsByGroupId.set(key, list)
  })

  const buckets: TagGroupBucket[] = orderedGroups
    .filter((group) => group.id !== undefined)
    .map((group) => ({
      groupId: group.id as number,
      groupName: group.name,
      tags: sortTagsInGroup(tagsByGroupId.get(group.id as number) ?? []),
    }))

  const ungrouped = sortTagsInGroup(tagsByGroupId.get(null) ?? [])
  buckets.push({ groupId: null, groupName: UNGROUPED_LABEL, tags: ungrouped })

  return buckets.filter((bucket) => bucket.tags.length > 0)
}

/** Canonical, app-wide tag order: group order, then tag order within each group (point 1b). */
export const orderTagsCanonically = (
  tags: TagDefinition[],
  groups: TagGroupDefinition[],
): TagDefinition[] => bucketTagsByGroup(tags, groups).flatMap((bucket) => bucket.tags)

export const getVisiblePatientTags = (
  patient: Pick<Patient, 'tagIds'>,
  tagsById: Map<number, TagDefinition>,
  groups: TagGroupDefinition[],
): TagDefinition[] => {
  const applied = (patient.tagIds ?? [])
    .map((tagId) => tagsById.get(tagId))
    .filter((tag): tag is TagDefinition => tag !== undefined && tag.visibleOnPatientCard)
  return orderTagsCanonically(applied, groups)
}

export const getAppliedPatientTags = (
  patient: Pick<Patient, 'tagIds'>,
  tagsById: Map<number, TagDefinition>,
): TagDefinition[] =>
  (patient.tagIds ?? [])
    .map((tagId) => tagsById.get(tagId))
    .filter((tag): tag is TagDefinition => tag !== undefined)

/** A patient is active iff they have zero Terminal-flagged tags applied (point 6). */
export const isPatientActive = (
  patient: Pick<Patient, 'tagIds'>,
  tagsById: Map<number, TagDefinition>,
): boolean => getAppliedPatientTags(patient, tagsById).every((tag) => !tag.terminal)

export type TagAmbiguity = {
  terminalConflicts: TagDefinition[]
  automationRoleConflicts: Map<AutomationRoleFamily, TagDefinition[]>
}

/**
 * Point 7: flags 2+ terminal tags applied at once, or 2+ tags whose Automation Role falls in the
 * same family (e.g. Category: CD + Category: PD) — an automation lookup for "the" Category or
 * Relationship tag on this patient would find more than one candidate.
 */
export const findTagAmbiguities = (
  patient: Pick<Patient, 'tagIds'>,
  tagsById: Map<number, TagDefinition>,
): TagAmbiguity => {
  const applied = getAppliedPatientTags(patient, tagsById)
  const terminalConflicts = applied.filter((tag) => tag.terminal)

  const byFamily = new Map<AutomationRoleFamily, TagDefinition[]>()
  applied.forEach((tag) => {
    const family = AUTOMATION_ROLE_FAMILY[tag.automationRole]
    if (!family) return
    const list = byFamily.get(family) ?? []
    list.push(tag)
    byFamily.set(family, list)
  })

  const automationRoleConflicts = new Map<AutomationRoleFamily, TagDefinition[]>()
  byFamily.forEach((tags, family) => {
    if (tags.length >= 2) automationRoleConflicts.set(family, tags)
  })

  return {
    terminalConflicts: terminalConflicts.length >= 2 ? terminalConflicts : [],
    automationRoleConflicts,
  }
}

export const hasTagAmbiguity = (ambiguity: TagAmbiguity): boolean =>
  ambiguity.terminalConflicts.length > 0 || ambiguity.automationRoleConflicts.size > 0

export const renderTagDisplayText = (tag: TagDefinition): string =>
  tag.displayType === 'emoji' ? (tag.emoji ?? tag.name) : (tag.displayText?.trim() || tag.name)

/** Applies a tag to a patient and records a Tag Event History entry (point 3, point 8). */
export const applyTagToPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  if ((patient.tagIds ?? []).includes(tag.id)) return

  const now = new Date().toISOString()
  await db.transaction('rw', [db.patients, db.tagEvents], async () => {
    await db.patients.update(patient.id as number, {
      tagIds: [...(patient.tagIds ?? []), tag.id as number],
      lastModified: now,
      // Terminal tags (e.g. Discharged) default the Discharge Date field to today; it stays
      // independently editable afterward, same pattern as referralDate defaulting from admitDate.
      ...(tag.terminal ? { dischargeDate: toLocalISODate() } : {}),
    })
    await db.tagEvents.add({
      patientId: patient.id as number,
      tagId: tag.id as number,
      tagName: tag.name,
      action: 'added',
      at: now,
    })
  })
}

/** Removes a tag from a patient and records a Tag Event History entry (point 3, point 8). */
export const removeTagFromPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  if (!(patient.tagIds ?? []).includes(tag.id)) return

  const now = new Date().toISOString()
  await db.transaction('rw', [db.patients, db.tagEvents], async () => {
    await db.patients.update(patient.id as number, {
      tagIds: (patient.tagIds ?? []).filter((id) => id !== tag.id),
      lastModified: now,
    })
    await db.tagEvents.add({
      patientId: patient.id as number,
      tagId: tag.id as number,
      tagName: tag.name,
      action: 'removed',
      at: now,
    })
  })
}

export const toggleTagOnPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if ((patient.tagIds ?? []).includes(tag.id as number)) {
    await removeTagFromPatient(patient, tag)
  } else {
    await applyTagToPatient(patient, tag)
  }
}

/** Removes every currently-applied Terminal tag from a patient, restoring active state (point 6). */
export const clearTerminalTagsFromPatient = async (
  patient: Patient,
  tagsById: Map<number, TagDefinition>,
): Promise<void> => {
  const terminalTagsApplied = getAppliedPatientTags(patient, tagsById).filter((tag) => tag.terminal)
  if (terminalTagsApplied.length === 0 || patient.id === undefined) return

  const now = new Date().toISOString()
  const removedIds = new Set(terminalTagsApplied.map((tag) => tag.id))
  await db.transaction('rw', [db.patients, db.tagEvents], async () => {
    await db.patients.update(patient.id as number, {
      tagIds: (patient.tagIds ?? []).filter((id) => !removedIds.has(id)),
      lastModified: now,
    })
    await db.tagEvents.bulkAdd(
      terminalTagsApplied.map((tag) => ({
        patientId: patient.id as number,
        tagId: tag.id as number,
        tagName: tag.name,
        action: 'removed' as const,
        at: now,
      })),
    )
  })
}
