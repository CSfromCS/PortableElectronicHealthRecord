import { db } from '@/db'
import type { Patient, TagDefinition, TagGroupDefinition } from '@/types'
import { migrateUnassignedDiagnosisOnFirstService } from '@/features/patients/serviceDiagnosis'
import { SERVICE_TAG_GROUP_NAME } from './tagConstants'
import { findServiceTagByName } from './serviceTagParsing'

export { findServiceTagByName, parseLegacyServiceText } from './serviceTagParsing'

/** Finds the "Service" Tag Group, creating it if it's ever missing (e.g. deleted via Manage Tags). */
export const ensureServiceGroupId = async (groups: TagGroupDefinition[]): Promise<number> => {
  const existing = groups.find((group) => group.name === SERVICE_TAG_GROUP_NAME)
  if (existing?.id !== undefined) return existing.id

  const nextSortOrder = groups.length > 0 ? Math.max(...groups.map((group) => group.sortOrder)) + 1 : 0
  return db.tagGroups.add({ name: SERVICE_TAG_GROUP_NAME, sortOrder: nextSortOrder }) as Promise<number>
}

export const getOrCreateServiceTag = async (
  name: string,
  existingServiceTags: TagDefinition[],
  serviceGroupId: number,
): Promise<TagDefinition> => {
  const trimmed = name.trim()
  const existing = findServiceTagByName(trimmed, existingServiceTags)
  if (existing) return existing

  const now = new Date().toISOString()
  const nextSortOrder = existingServiceTags.length > 0 ? Math.max(...existingServiceTags.map((tag) => tag.sortOrder)) + 1 : 0
  const newTag: Omit<TagDefinition, 'id'> = {
    name: trimmed,
    displayType: 'color',
    color: '#8aa4bd',
    groupId: serviceGroupId,
    sortOrder: nextSortOrder,
    // Service tags are shown via the dedicated Main Service / Referrals sections, not the general tag chip row.
    visibleOnPatientCard: false,
    terminal: false,
    automationRole: 'none',
    createdAt: now,
  }
  const id = await db.tagDefinitions.add(newTag)
  return { ...newTag, id }
}

const withUniqueId = (ids: number[], id: number) => (ids.includes(id) ? ids : [...ids, id])

export const addMainServiceTagToPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  await db.patients.update(patient.id, {
    mainServiceTagIds: withUniqueId(patient.mainServiceTagIds ?? [], tag.id),
    lastModified: new Date().toISOString(),
    ...migrateUnassignedDiagnosisOnFirstService(patient, tag.id),
  })
}

export const removeMainServiceTagFromPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  await db.patients.update(patient.id, {
    mainServiceTagIds: (patient.mainServiceTagIds ?? []).filter((id) => id !== tag.id),
    lastModified: new Date().toISOString(),
  })
}

export const addReferralServiceTagToPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  await db.patients.update(patient.id, {
    referralServiceTagIds: withUniqueId(patient.referralServiceTagIds ?? [], tag.id),
    lastModified: new Date().toISOString(),
    ...migrateUnassignedDiagnosisOnFirstService(patient, tag.id),
  })
}

export const removeReferralServiceTagFromPatient = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  await db.patients.update(patient.id, {
    referralServiceTagIds: (patient.referralServiceTagIds ?? []).filter((id) => id !== tag.id),
    lastModified: new Date().toISOString(),
  })
}

export const resolveServiceTags = (ids: number[] | undefined, tagsById: Map<number, TagDefinition>): TagDefinition[] =>
  (ids ?? [])
    .map((id) => tagsById.get(id))
    .filter((tag): tag is TagDefinition => tag !== undefined)

export const resolveServiceTagNames = (ids: number[] | undefined, tagsById: Map<number, TagDefinition>): string[] =>
  resolveServiceTags(ids, tagsById).map((tag) => tag.name)
