import type { Patient, TagDefinition } from '@/types'

export type OrderedServiceEntry = { tagId: number; role: 'main' | 'referral' }

/** Ordered list of services currently assigned to a patient, each tagged with its Main/Referral
 * role — Main services first, then Referral, each in the order it was added. Drives the
 * per-service Diagnosis field order (and its M/R badge) and how those lines are composed for
 * reports. */
export const orderedServiceEntries = (
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>,
): OrderedServiceEntry[] => [
  ...patient.mainServiceTagIds.map((tagId): OrderedServiceEntry => ({ tagId, role: 'main' })),
  ...patient.referralServiceTagIds.map((tagId): OrderedServiceEntry => ({ tagId, role: 'referral' })),
]

/** Ordered list of service tag ids currently assigned to a patient — same order as
 * `orderedServiceEntries`, without the role, for callers (report composition) that don't need it. */
export const orderedServiceTagIds = (
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>,
): number[] => orderedServiceEntries(patient).map((entry) => entry.tagId)

/** Settings a caller supplies to `composeDiagnosisTextConfigurable` for how the per-service lines
 * render — kept free of any Tags/templateEngine dependency (just a callback for the label text) so
 * this module doesn't have to import tag-rendering helpers that would create a cycle back through
 * `db.ts`/`templateEngine.ts`, which already import from here. */
export interface DiagnosisComposeOptions {
  /** Whether each assigned service's diagnosis line is prefixed with a label at all. */
  showService: boolean
  /** Resolves a service tag id to the label text to prefix its diagnosis line with. Only called
   * when `showService` is true. */
  labelForService: (tagId: number) => string
  /** Joins consecutive per-service diagnosis lines. */
  lineSeparator: string
}

/** Composes one diagnosis block: one line per assigned service, skipping services with no text
 * yet, using whatever label/separator `options` specifies. Falls back to `unassigned` — the only
 * diagnosis field shown at all — while the patient has zero Main/Referral services (in which case
 * `options` is moot: there's no service to label). */
export const composeDiagnosisTextConfigurable = (
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>,
  unassigned: string,
  byService: Record<number, string>,
  options: DiagnosisComposeOptions,
): string => {
  const serviceIds = orderedServiceTagIds(patient)
  if (serviceIds.length === 0) return unassigned.trim()

  return serviceIds
    .map((id) => {
      const text = (byService[id] ?? '').trim()
      if (!text) return ''
      return options.showService ? `${options.labelForService(id)}: ${text}` : text
    })
    .filter(Boolean)
    .join(options.lineSeparator)
}

/** Composes one diagnosis block: one line per assigned service ("IM: AKI secondary to postrenal
 * obstructive uropathy"), skipping services with no text yet. Falls back to `unassigned` — the
 * only diagnosis field shown at all — while the patient has zero Main/Referral services. Used by
 * the Patients list's own card preview, which (unlike the configurable Template Generator variable
 * — see `composeDiagnosisTextConfigurable` — issue #162) always wants this one fixed rendering. */
export const composeDiagnosisText = (
  patient: Pick<Patient, 'mainServiceTagIds' | 'referralServiceTagIds'>,
  unassigned: string,
  byService: Record<number, string>,
  tagsById: Map<number, TagDefinition>,
): string =>
  composeDiagnosisTextConfigurable(patient, unassigned, byService, {
    showService: true,
    labelForService: (tagId) => tagsById.get(tagId)?.name ?? `#${tagId}`,
    lineSeparator: '\n',
  })

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
