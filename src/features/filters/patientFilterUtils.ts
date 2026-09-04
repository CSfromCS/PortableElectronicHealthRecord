import { toLocalISODate, toLocalTime, isWithinDateTimeWindow, getEffectiveAdmitDate, formatDateMMDD, formatClock } from '@/lib/dateTime'
import { getAppliedPatientTags } from '@/features/tags/tagUtils'
import type { Patient, TagDefinition, TagEvent } from '@/types'

export type TagFilterMode = 'AND' | 'OR'

export type TagWardFilterState = {
  tagIds: number[]
  tagMode: TagFilterMode
  wards: string[]
}

export const EMPTY_TAG_WARD_FILTER: TagWardFilterState = { tagIds: [], tagMode: 'OR', wards: [] }

export const isTagWardFilterActive = (filter: TagWardFilterState): boolean =>
  filter.tagIds.length > 0 || filter.wards.length > 0

/** Combined count of active individual selections across the Tag and Ward facets, for the filter button's badge. */
export const countTagWardSelections = (filter: TagWardFilterState): number =>
  filter.tagIds.length + filter.wards.length

export const matchesTagFacet = (patient: Pick<Patient, 'tagIds'>, tagIds: number[], mode: TagFilterMode): boolean => {
  if (tagIds.length === 0) return true
  const applied = new Set(patient.tagIds ?? [])
  return mode === 'AND' ? tagIds.every((id) => applied.has(id)) : tagIds.some((id) => applied.has(id))
}

/** Ward facet is always OR across selections — a patient can only be in one ward at a time, so AND would always match zero. */
export const matchesWardFacet = (patient: Pick<Patient, 'ward'>, wards: string[]): boolean => {
  if (wards.length === 0) return true
  return wards.includes(patient.ward)
}

export const matchesTagWardFilter = (
  patient: Pick<Patient, 'tagIds' | 'ward'>,
  filter: TagWardFilterState,
): boolean => matchesTagFacet(patient, filter.tagIds, filter.tagMode) && matchesWardFacet(patient, filter.wards)

/** Distinct, sorted, non-blank ward values across the given patients — the Ward facet's option list. */
export const collectDistinctWards = (patients: Patient[]): string[] => {
  const wards = new Set<string>()
  patients.forEach((patient) => {
    const ward = patient.ward.trim()
    if (ward) wards.add(ward)
  })
  return [...wards].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export type PatientPoolCriterion = 'active' | 'admitted' | 'discharged' | 'referred' | 'mgh'

export const PATIENT_POOL_CRITERIA: { id: PatientPoolCriterion; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'admitted', label: 'Admitted' },
  { id: 'discharged', label: 'Discharged' },
  { id: 'referred', label: 'Referred' },
  { id: 'mgh', label: 'MGH' },
]

export const DEFAULT_PATIENT_POOL_CRITERIA: PatientPoolCriterion[] = ['active']

/** Criteria other than Active read the shared time window — Active is a pure current-state check and never uses it. */
export const patientPoolCriteriaNeedWindow = (criteria: PatientPoolCriterion[]): boolean =>
  criteria.some((criterion) => criterion !== 'active')

export type DateTimeWindow = {
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
}

export const EMPTY_DATE_TIME_WINDOW: DateTimeWindow = { dateFrom: '', timeFrom: '', dateTo: '', timeTo: '' }

const DEFAULT_WINDOW_LOOKBACK_HOURS = 12

/** Computed default for the Patient Pool facet's shared window when its date/time fields are left
 * blank: the last 12 hours, ending now — matching how other optional date/time fields in this app
 * (e.g. a Vitals entry's time) render a computed default instead of requiring explicit entry. */
export const computeDefaultWindowLookback = (now = new Date()): DateTimeWindow => {
  const from = new Date(now.getTime() - DEFAULT_WINDOW_LOOKBACK_HOURS * 3_600_000)
  return {
    dateFrom: toLocalISODate(from),
    timeFrom: toLocalTime(from),
    dateTo: toLocalISODate(now),
    timeTo: toLocalTime(now),
  }
}

/** Resolves the window actually used for filtering: each blank field in `raw` falls back to the same field in `defaults`, independently — mirrors FlexibleDateInput/FlexibleTimeInput's own per-field blank-means-default behavior. */
export const resolveWindowDefaults = (raw: DateTimeWindow, defaults: DateTimeWindow): DateTimeWindow => ({
  dateFrom: raw.dateFrom || defaults.dateFrom,
  timeFrom: raw.timeFrom || defaults.timeFrom,
  dateTo: raw.dateTo || defaults.dateTo,
  timeTo: raw.timeTo || defaults.timeTo,
})

/** True when `at` (a stored ISO UTC timestamp, e.g. a TagEvent's `at`) falls within `window`, compared in local date/time — matching how the window's own date/time fields are entered and how other date-scoped data (VitalEntry, OrderEntry) in this app is compared. */
export const isTimestampWithinWindow = (at: string, window: DateTimeWindow): boolean => {
  const eventDate = new Date(at)
  if (Number.isNaN(eventDate.getTime())) return false
  return isWithinDateTimeWindow(
    toLocalISODate(eventDate),
    toLocalTime(eventDate),
    window.dateFrom,
    window.dateTo,
    window.timeFrom,
    window.timeTo,
  )
}

const wasTagEventAddedWithinWindow = (
  patientId: number,
  tagId: number,
  tagEvents: TagEvent[],
  window: DateTimeWindow,
): boolean =>
  tagEvents.some(
    (event) =>
      event.patientId === patientId
      && event.tagId === tagId
      && event.action === 'added'
      && isTimestampWithinWindow(event.at, window),
  )

/** Most recent event for this (patient, tag), if any — used to check whether a tag's *current* application happened inside the window. */
const latestTagEvent = (patientId: number, tagId: number, tagEvents: TagEvent[]): TagEvent | null =>
  tagEvents
    .filter((event) => event.patientId === patientId && event.tagId === tagId)
    .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null

export type PatientPoolContext = {
  tagsById: Map<number, TagDefinition>
  tagEvents: TagEvent[]
  /** The tag whose Automation Role is "Relationship: Referral" — Referred reads this tag's history. Unset when no such tag exists (criterion then matches nobody). */
  referralTagId: number | null
  /** The tag literally named "MGH" (case-insensitive) — MGH reads this tag's history, since there's no dedicated Automation Role for it. Unset when no such tag exists. */
  mghTagId: number | null
}

export const buildPatientPoolContext = (tagsById: Map<number, TagDefinition>, tagEvents: TagEvent[]): PatientPoolContext => {
  let referralTagId: number | null = null
  let mghTagId: number | null = null
  tagsById.forEach((tag) => {
    if (tag.automationRole === 'relationship-referral') referralTagId = tag.id ?? null
    if (tag.name.trim().toLowerCase() === 'mgh') mghTagId = tag.id ?? null
  })
  return { tagsById, tagEvents, referralTagId, mghTagId }
}

const matchesActive = (patient: Patient, context: PatientPoolContext): boolean =>
  getAppliedPatientTags(patient, context.tagsById).every((tag) => !tag.terminal)

const matchesAdmitted = (patient: Patient, window: DateTimeWindow | null): boolean => {
  if (!window) return true
  const admitDate = getEffectiveAdmitDate(patient.admitDate, patient.createdAt)
  return admitDate >= window.dateFrom && admitDate <= window.dateTo
}

const matchesDischarged = (patient: Patient, context: PatientPoolContext, window: DateTimeWindow | null): boolean => {
  if (patient.id === undefined) return false
  const appliedTerminalTags = getAppliedPatientTags(patient, context.tagsById).filter((tag) => tag.terminal)
  if (appliedTerminalTags.length === 0) return false
  if (!window) return true

  return appliedTerminalTags.some((tag) => {
    if (tag.id === undefined) return false
    const latest = latestTagEvent(patient.id as number, tag.id, context.tagEvents)
    return latest !== null && latest.action === 'added' && isTimestampWithinWindow(latest.at, window)
  })
}

const matchesReferred = (patient: Patient, context: PatientPoolContext, window: DateTimeWindow | null): boolean => {
  if (patient.id === undefined || context.referralTagId === null) return false
  if (!window) return (patient.tagIds ?? []).includes(context.referralTagId)
  return wasTagEventAddedWithinWindow(patient.id, context.referralTagId, context.tagEvents, window)
}

const matchesMgh = (patient: Patient, context: PatientPoolContext, window: DateTimeWindow | null): boolean => {
  if (patient.id === undefined || context.mghTagId === null) return false
  if (!window) return (patient.tagIds ?? []).includes(context.mghTagId)
  return wasTagEventAddedWithinWindow(patient.id, context.mghTagId, context.tagEvents, window)
}

/** Point 2 of issue #81: multiple checked Patient Pool criteria combine via OR — a patient matches if they satisfy ANY checked criterion. Active never consults the window even when one is set. */
export const matchesPatientPool = (
  patient: Patient,
  criteria: PatientPoolCriterion[],
  window: DateTimeWindow | null,
  context: PatientPoolContext,
): boolean => {
  if (criteria.length === 0) return true
  return criteria.some((criterion) => {
    switch (criterion) {
      case 'active': return matchesActive(patient, context)
      case 'admitted': return matchesAdmitted(patient, window)
      case 'discharged': return matchesDischarged(patient, context, window)
      case 'referred': return matchesReferred(patient, context, window)
      case 'mgh': return matchesMgh(patient, context, window)
      default: return false
    }
  })
}

/** Human-readable lines describing the Tag and Ward facets currently in effect for a view — empty for a facet at its default (no restriction). Used to show the viewer exactly what a view's filter is doing, not just a badge count. */
export const describeTagWardFilter = (
  filter: TagWardFilterState,
  tagsById: Map<number, TagDefinition>,
): string[] => {
  const lines: string[] = []
  if (filter.tagIds.length > 0) {
    const names = filter.tagIds.map((id) => tagsById.get(id)?.name ?? `#${id}`).join(', ')
    lines.push(`Tags (${filter.tagMode === 'AND' ? 'all of' : 'any of'}): ${names}`)
  }
  if (filter.wards.length > 0) {
    lines.push(`Ward (any of): ${filter.wards.join(', ')}`)
  }
  return lines
}

/** Human-readable line describing the Patient Pool facet currently in effect, including the actual resolved window (so a blank field's computed default is visible, not just "no window entered"). `resolvedWindow` should already have blanks substituted via `resolveWindowDefaults`. Labeled "Special/Timebound Filter" to match the dialog section — this facet only exists on the census/reporting picker, unlike Tags/Ward. */
export const describePatientPoolFilter = (
  criteria: PatientPoolCriterion[],
  useWindow: boolean,
  resolvedWindow: DateTimeWindow,
): string => {
  const labels = criteria.length > 0
    ? criteria.map((id) => PATIENT_POOL_CRITERIA.find((c) => c.id === id)?.label ?? id).join(', ')
    : 'none (all patients)'
  const prefix = 'Special/Timebound Filter'
  if (!patientPoolCriteriaNeedWindow(criteria)) return `${prefix}: ${labels}`
  if (!useWindow) return `${prefix}: ${labels} (any time)`

  const windowText = `${formatDateMMDD(resolvedWindow.dateFrom)} ${formatClock(resolvedWindow.timeFrom)} – ${formatDateMMDD(resolvedWindow.dateTo)} ${formatClock(resolvedWindow.timeTo)}`
  return `${prefix}: ${labels} (${windowText})`
}
