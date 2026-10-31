import { getAppliedPatientTags } from '@/features/tags/tagUtils'
import type { Patient, TagDefinition, TagEvent } from '@/types'

/** Settings → "Archive old discharged patients": how long after discharge a patient is old enough. */
export const ARCHIVE_AFTER_DAYS = 14

/**
 * When a discharged patient was discharged, as best the record says: the Discharge Date (and Time)
 * if one is set, else when their Terminal tag was last applied, else when the profile was last
 * touched. Null for a patient who is still active, or when no usable time exists.
 */
export const getDischargedAtMs = (
  patient: Patient,
  tagsById: Map<number, TagDefinition>,
  tagEvents: TagEvent[],
): number | null => {
  const terminalTags = getAppliedPatientTags(patient, tagsById).filter((tag) => tag.terminal)
  if (terminalTags.length === 0) return null

  const dischargeDate = (patient.dischargeDate ?? '').trim()
  if (dischargeDate) {
    const dischargeTime = (patient.dischargeTime ?? '').trim()
    const parsed = Date.parse(`${dischargeDate}T${dischargeTime || '00:00'}`)
    if (Number.isFinite(parsed)) return parsed
  }

  const terminalTagIds = new Set(terminalTags.map((tag) => tag.id))
  const latestApplied = tagEvents
    .filter((event) => event.patientId === patient.id && event.action === 'added' && terminalTagIds.has(event.tagId))
    .map((event) => Date.parse(event.at))
    .filter(Number.isFinite)
    .reduce<number | null>((latest, at) => (latest === null || at > latest ? at : latest), null)
  if (latestApplied !== null) return latestApplied

  const fallback = Date.parse(patient.lastModified ?? patient.createdAt ?? '')
  return Number.isFinite(fallback) ? fallback : null
}

/** Discharged patients whose discharge is more than `days` ago. */
export const findPatientsToArchive = (
  patients: Patient[],
  tagsById: Map<number, TagDefinition>,
  tagEvents: TagEvent[],
  now = new Date(),
  days = ARCHIVE_AFTER_DAYS,
): Patient[] => {
  const cutoff = now.getTime() - days * 86_400_000
  return patients.filter((patient) => {
    if (patient.id === undefined) return false
    const dischargedAt = getDischargedAtMs(patient, tagsById, tagEvents)
    return dischargedAt !== null && dischargedAt < cutoff
  })
}
