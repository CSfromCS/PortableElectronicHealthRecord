import { getEffectiveAdmitDate } from '@/lib/dateTime'
import type { Patient, PatientSortConfig, PatientSortDirection, PatientSortField, PatientSortLevel, TagDefinition } from '@/types'

export type { PatientSortConfig, PatientSortDirection, PatientSortField, PatientSortLevel }

export const PATIENT_SORT_FIELD_LABELS: Record<PatientSortField, string> = {
  ward: 'Ward',
  room: 'Room number',
  name: 'Name (alphabetical)',
  admitDate: 'Admit date',
  tagOrder: 'Tag order',
}

export const PATIENT_SORT_FIELDS: PatientSortField[] = ['ward', 'room', 'name', 'admitDate', 'tagOrder']

export const createPatientSortLevelId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `sort-level-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Builds a fresh level for `field`, carrying over `id`/`direction` from whatever level it's
 * replacing (e.g. when the user changes a level's field via its Select) — a `tagOrder` level
 * starts with an empty tag list. */
export const createPatientSortLevel = (field: PatientSortField, id: string, direction: PatientSortDirection): PatientSortLevel => {
  if (field === 'tagOrder') return { id, field, direction, tagIds: [] }
  return { id, field, direction }
}

export const DEFAULT_PATIENT_SORT_CONFIG: PatientSortConfig = {
  levels: [
    { id: 'default-room', field: 'room', direction: 'asc' },
    { id: 'default-name', field: 'name', direction: 'asc' },
  ],
}

const compareNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const fullName = (patient: Patient) => `${patient.lastName} ${patient.firstName}`

/** Index of the earliest tag (in the level's own `tagIds` order) the patient carries — patients
 * matching none of the listed tags sort after everyone who matches at least one, tied among
 * themselves. */
const tagOrderRank = (patient: Patient, tagIds: number[]): number => {
  const applied = new Set(patient.tagIds ?? [])
  const index = tagIds.findIndex((tagId) => applied.has(tagId))
  return index === -1 ? tagIds.length : index
}

/** Ward is a tag reference, not a string — resolves to the tag's name (blank if unset/unknown) so
 * 'ward' sort levels and the final tie-break can still compare it as text. */
const wardName = (patient: Patient, tagsById: Map<number, TagDefinition>): string =>
  (patient.wardTagId !== undefined ? tagsById.get(patient.wardTagId)?.name : undefined) ?? ''

const compareByLevel = (a: Patient, b: Patient, level: PatientSortLevel, tagsById: Map<number, TagDefinition>): number => {
  const comparison = (() => {
    switch (level.field) {
      case 'ward':
        return compareNatural(wardName(a, tagsById), wardName(b, tagsById))
      case 'room':
        return compareNatural(a.roomNumber, b.roomNumber)
      case 'name':
        return fullName(a).localeCompare(fullName(b))
      case 'admitDate':
        return getEffectiveAdmitDate(a.admitDate, a.createdAt).localeCompare(getEffectiveAdmitDate(b.admitDate, b.createdAt))
      case 'tagOrder':
        return tagOrderRank(a, level.tagIds) - tagOrderRank(b, level.tagIds)
    }
  })()
  return level.direction === 'asc' ? comparison : -comparison
}

/** Sorts patients per a multi-level sort config — each level only breaks ties left by the ones
 * before it. Falls back to a stable Room-then-Name order once every configured level ties,
 * including when the config has zero levels. `tagsById` is only consulted by a 'ward' level (to
 * resolve the patient's ward tag to a name) — pass whatever's already loaded, e.g. from the same
 * `useLiveQuery(() => db.tagDefinitions...)` every other tag lookup in the app already uses. */
export const sortPatientsByConfig = <T extends Patient>(patients: T[], config: PatientSortConfig, tagsById: Map<number, TagDefinition>): T[] => {
  const levels = config.levels
  return [...patients].sort((a, b) => {
    for (const level of levels) {
      const comparison = compareByLevel(a, b, level, tagsById)
      if (comparison !== 0) return comparison
    }
    const byRoom = compareNatural(a.roomNumber, b.roomNumber)
    if (byRoom !== 0) return byRoom
    return fullName(a).localeCompare(fullName(b))
  })
}
