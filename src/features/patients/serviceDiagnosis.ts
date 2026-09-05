import type { Patient, TagDefinition } from '@/types'

/** Ordered list of service tag ids currently assigned to a patient — Main services first, then
 * Referral, each in the order it was added. Drives both the per-service Diagnosis field order and
 * how those lines are composed for reports. */
export const orderedServiceTagIds = (
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>,
): number[] => [...patient.mainServiceTagIds, ...patient.referralServiceTagIds]

/** Composes one diagnosis block: one line per assigned service ("IM: AKI secondary to postrenal
 * obstructive uropathy"), skipping services with no text yet. Falls back to `unassigned` — the
 * only diagnosis field shown at all — while the patient has zero Main/Referral services. */
export const composeDiagnosisText = (
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>,
  unassigned: string,
  byService: Record<number, string>,
  tagsById: Map<number, TagDefinition>,
): string => {
  const serviceIds = orderedServiceTagIds(patient)
  if (serviceIds.length === 0) return unassigned.trim()

  return serviceIds
    .map((id) => {
      const text = (byService[id] ?? '').trim()
      if (!text) return ''
      const label = tagsById.get(id)?.name ?? `#${id}`
      return `${label}: ${text}`
    })
    .filter(Boolean)
    .join('\n')
}

type DiagnosisFieldsPatch = Partial<
  Pick<
    Patient,
    'admissionDiagnosisUnassigned' | 'admissionDiagnosisByService' | 'dischargeDiagnosisUnassigned' | 'dischargeDiagnosisByService'
  >
>

/** When a patient's very first-ever service (Main or Referral) is added, carries any existing
 * "unassigned" diagnosis text (both Admission and Discharge) into that service's own entry —
 * mirrors the one-time DB migration's rule for pre-existing patients, applied live going forward.
 * Returns the fields to merge into the patient update, or null when there's nothing to move
 * (patient already had a service, or had no unassigned text to carry). */
export const migrateUnassignedDiagnosisOnFirstService = (
  patient: Pick<
    Patient,
    | 'mainServiceTagIds'
    | 'referralServiceTagIds'
    | 'admissionDiagnosisUnassigned'
    | 'admissionDiagnosisByService'
    | 'dischargeDiagnosisUnassigned'
    | 'dischargeDiagnosisByService'
  >,
  newServiceTagId: number,
): DiagnosisFieldsPatch | null => {
  const hadNoServicesBefore = patient.mainServiceTagIds.length === 0 && patient.referralServiceTagIds.length === 0
  if (!hadNoServicesBefore) return null

  const patch: DiagnosisFieldsPatch = {}
  if (patient.admissionDiagnosisUnassigned.trim()) {
    patch.admissionDiagnosisUnassigned = ''
    patch.admissionDiagnosisByService = { ...patient.admissionDiagnosisByService, [newServiceTagId]: patient.admissionDiagnosisUnassigned }
  }
  if (patient.dischargeDiagnosisUnassigned.trim()) {
    patch.dischargeDiagnosisUnassigned = ''
    patch.dischargeDiagnosisByService = { ...patient.dischargeDiagnosisByService, [newServiceTagId]: patient.dischargeDiagnosisUnassigned }
  }
  return Object.keys(patch).length > 0 ? patch : null
}
