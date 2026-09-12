import { type DateTimeWindow, type PatientPoolContext, matchesPatientPool } from '@/features/filters/patientFilterUtils'
import { composeDiagnosisText } from '@/features/patients/serviceDiagnosis'
import { buildLabReportBlockPieces, formatOrderStatus } from '@/features/reporting/reportBuilders'
import { resolveServiceTagNames } from '@/features/tags/serviceTagUtils'
import { getAppliedPatientTags, orderTagsCanonically, renderTagDisplayText } from '@/features/tags/tagUtils'
import {
  formatClock,
  formatClockCompact,
  formatDateMMDD,
  formatDateMMDDYYYY,
  getEffectiveAdmitDate,
  isWithinDateTimeWindow,
  toLocalISODate,
  toLocalTime,
} from '@/lib/dateTime'
import type {
  AutomaticGroupLabelOverride,
  BlockJoinMode,
  BlockVariableConfig,
  BlockVariableId,
  CensusStatus,
  ChecklistEntryFieldId,
  DailyUpdate,
  DateTimeComponentId,
  DateTimeFormatDefinition,
  FlatVariableId,
  GroupVariableInstance,
  LabEntry,
  MedicationEntry,
  MedicationsEntryFieldId,
  OrderEntry,
  OrdersEntryFieldId,
  Patient,
  ProblemBlock,
  ProblemsEntryFieldId,
  ReportTemplate,
  TagAutomationRole,
  TagDefinition,
  TagGroupDefinition,
  TagsVariableConfig,
  TemplateVariableInstance,
  VitalEntry,
  VitalsEntryFieldId,
} from '@/types'

/** Used to generate a Prints Once template's single output — by definition its Format Pattern
 * contains no patient-dependent segment, so which patient object is passed in never matters; this
 * just avoids reaching into a real (or the editor-preview) patient for a generation path that
 * structurally can't read one. */
export const PLACEHOLDER_PATIENT_FOR_PRINTS_ONCE: Patient = {
  id: -1,
  lastModified: '',
  createdAt: new Date().toISOString(),
  roomNumber: '',
  ward: '',
  lastName: '',
  firstName: '',
  age: undefined,
  sex: 'M',
  admitDate: '',
  admitTime: '',
  referralDate: '',
  referralTime: '',
  dischargeDate: undefined,
  dischargeTime: undefined,
  mainServiceTagIds: [],
  referralServiceTagIds: [],
  attendingPhysician: '',
  admissionDiagnosisUnassigned: '',
  admissionDiagnosisByService: {},
  dischargeDiagnosisUnassigned: '',
  dischargeDiagnosisByService: {},
  clinicalSummary: '',
  database: '',
  plans: '',
  medications: '',
  labs: '',
  pendings: '',
  tagIds: [],
}

export const createVariableId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `var-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Matches a `{{var:<id>}}` placeholder token embedded in `ReportTemplate.patternText` — same
 * "special syntax embedded in plain text" approach as this app's existing @-mention text fields
 * (see photoMentions.tsx), just with its own delimiter so it can't collide with literal `@text`.
 * Reused as-is for entry patterns and Date/Time Formats — same token syntax, smaller catalogs. */
const VARIABLE_TOKEN_REGEX = /\{\{var:([a-zA-Z0-9_-]+)\}\}/g

export const buildVariableToken = (id: string): string => `{{var:${id}}}`

export type PatternPart =
  | { type: 'text'; text: string }
  | { type: 'lineBreak' }
  | { type: 'variableRef'; id: string }

/** Splits raw `patternText` into an ordered list of literal-text runs, line breaks (each `\n`),
 * and variable references (by id, not yet resolved to a value or a display label) — the one parser
 * shared by the main template engine, entry patterns, and Date/Time Formats alike. */
export const tokenizePatternText = (patternText: string): PatternPart[] => {
  const parts: PatternPart[] = []
  const lines = patternText.split('\n')

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) parts.push({ type: 'lineBreak' })

    let lastIndex = 0
    for (const match of line.matchAll(VARIABLE_TOKEN_REGEX)) {
      const index = match.index ?? 0
      if (index > lastIndex) parts.push({ type: 'text', text: line.slice(lastIndex, index) })
      parts.push({ type: 'variableRef', id: match[1] })
      lastIndex = index + match[0].length
    }
    if (lastIndex < line.length) parts.push({ type: 'text', text: line.slice(lastIndex) })
  })

  return parts
}

type ResolvedSegment =
  | { kind: 'text'; text: string }
  | { kind: 'lineBreak' }
  | { kind: 'value'; text: string; blank: boolean }

/** Point 3 of issue #82: a blank variable collapses itself AND any literal text immediately
 * adjacent to it on either side, up to the next non-blank variable or line break — so a patient
 * without a referral doesn't produce a dangling "; :" with nothing in it. Only the specific gap
 * around that one blank variable collapses; the rest of the line is unaffected.
 *
 * A second pass then handles the case where a line's only content WAS one of those now-dropped
 * segments (e.g. a `{{list}}` chip placed alone on its own line) — collapsing the segment alone
 * would leave a blank line sitting between its two bounding line breaks. When that happens, one
 * bounding line break is dropped too, merging the empty line away instead of leaving it behind. A
 * line that was already blank in the authored pattern (no chip on it at all, e.g. a deliberate
 * blank line for spacing) is left untouched — only a line that HAD content which fully collapsed
 * gets merged away. */
const collapseBlanks = (resolved: ResolvedSegment[]): ResolvedSegment[] => {
  const dropped = new Set<number>()

  resolved.forEach((segment, index) => {
    if (segment.kind !== 'value' || !segment.blank) return
    dropped.add(index)

    for (let i = index - 1; i >= 0; i -= 1) {
      const left = resolved[i]
      if (left.kind === 'lineBreak') break
      if (left.kind === 'value' && !left.blank) break
      dropped.add(i)
      if (left.kind === 'value' && left.blank) break
    }

    for (let i = index + 1; i < resolved.length; i += 1) {
      const right = resolved[i]
      if (right.kind === 'lineBreak') break
      if (right.kind === 'value' && !right.blank) break
      dropped.add(i)
      if (right.kind === 'value' && right.blank) break
    }
  })

  let lineStart = 0
  for (let i = 0; i <= resolved.length; i += 1) {
    if (i !== resolved.length && resolved[i].kind !== 'lineBreak') continue
    const hadContent = i > lineStart
    const lineFullyDropped = hadContent && Array.from({ length: i - lineStart }, (_, offset) => lineStart + offset).every((j) => dropped.has(j))
    if (lineFullyDropped) {
      if (i < resolved.length) dropped.add(i)
      else if (lineStart > 0) dropped.add(lineStart - 1)
    }
    lineStart = i + 1
  }

  return resolved.filter((_, index) => !dropped.has(index))
}

const renderResolvedSegments = (resolved: ResolvedSegment[]): string => {
  const lines: string[] = ['']
  resolved.forEach((segment) => {
    if (segment.kind === 'lineBreak') {
      lines.push('')
      return
    }
    lines[lines.length - 1] += segment.text
  })
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Date/Time Formats — a small, savable, Google-Sheets-style component catalog,
// selectable wherever a date/time-typed template variable is configured.
// ---------------------------------------------------------------------------

export const DATE_TIME_COMPONENT_ORDER: DateTimeComponentId[] = [
  'monthNum2', 'monthAbbrev', 'monthFull',
  'day2', 'dayNoLeadingZero',
  'year4', 'year2',
  'weekdayAbbrev', 'weekdayFull',
  'hour24', 'hour12', 'hour12NoLeadingZero',
  'minute2',
  'meridiemUpper', 'meridiemLower',
]

export const DATE_TIME_COMPONENT_LABELS: Record<DateTimeComponentId, string> = {
  year4: 'Year (4-digit)',
  year2: 'Year (2-digit)',
  monthNum2: 'Month (2-digit)',
  monthAbbrev: 'Month (abbreviated)',
  monthFull: 'Month (full name)',
  day2: 'Day (2-digit)',
  dayNoLeadingZero: 'Day (no leading zero)',
  weekdayAbbrev: 'Weekday (abbreviated)',
  weekdayFull: 'Weekday (full name)',
  hour24: 'Hour (24-hour)',
  hour12: 'Hour (12-hour, 2-digit)',
  hour12NoLeadingZero: 'Hour (12-hour)',
  minute2: 'Minute',
  meridiemUpper: 'AM/PM',
  meridiemLower: 'am/pm',
}

const WEEKDAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const resolveDateTimeComponent = (componentId: DateTimeComponentId, date: Date): string => {
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  const weekday = date.getDay()
  const hour24 = date.getHours()
  const minute = date.getMinutes()
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  switch (componentId) {
    case 'year4': return String(year)
    case 'year2': return String(year).slice(-2)
    case 'monthNum2': return String(month + 1).padStart(2, '0')
    case 'monthAbbrev': return MONTH_ABBREV[month]
    case 'monthFull': return MONTH_FULL[month]
    case 'day2': return String(day).padStart(2, '0')
    case 'dayNoLeadingZero': return String(day)
    case 'weekdayAbbrev': return WEEKDAY_ABBREV[weekday]
    case 'weekdayFull': return WEEKDAY_FULL[weekday]
    case 'hour24': return String(hour24).padStart(2, '0')
    case 'hour12': return String(hour12).padStart(2, '0')
    case 'hour12NoLeadingZero': return String(hour12)
    case 'minute2': return String(minute).padStart(2, '0')
    case 'meridiemUpper': return hour24 >= 12 ? 'PM' : 'AM'
    case 'meridiemLower': return hour24 >= 12 ? 'pm' : 'am'
    default: return ''
  }
}

export const renderDateTimeFormat = (format: DateTimeFormatDefinition, date: Date): string => {
  const parts = tokenizePatternText(format.patternText)
  let result = ''
  parts.forEach((part) => {
    if (part.type === 'text') { result += part.text; return }
    if (part.type === 'lineBreak') { result += '\n'; return }
    const componentId = format.componentIds[part.id]
    result += componentId ? resolveDateTimeComponent(componentId, date) : buildVariableToken(part.id)
  })
  return result
}

/** Constructs a local `Date` from separate ISO date / "HH:MM" time strings (never UTC-shifted,
 * matching how every other date field in this app already treats its stored strings as local). */
const buildLocalDate = (isoDate: string, hhmm?: string): Date | null => {
  const [yearText, monthText, dayText] = isoDate.split('-')
  const year = Number.parseInt(yearText ?? '', 10)
  const month = Number.parseInt(monthText ?? '', 10)
  const day = Number.parseInt(dayText ?? '', 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null

  let hour = 0
  let minute = 0
  if (hhmm) {
    const [hourText, minuteText] = hhmm.split(':')
    hour = Number.parseInt(hourText ?? '', 10) || 0
    minute = Number.parseInt(minuteText ?? '', 10) || 0
  }
  const date = new Date(year, month - 1, day, hour, minute)
  return Number.isNaN(date.getTime()) ? null : date
}

const renderSavedFormatOr = (
  formatId: string | undefined,
  ctx: TemplateRenderContext,
  isoDate: string,
  hhmm: string | undefined,
  fallback: () => string,
): string => {
  if (formatId) {
    const format = ctx.dateTimeFormatsById.get(formatId)
    if (format) {
      const date = buildLocalDate(isoDate, hhmm)
      if (date) return renderDateTimeFormat(format, date)
    }
  }
  return fallback()
}

export const resolveJoinString = (mode: BlockJoinMode, custom: string): string => {
  if (mode === 'lineBreak') return '\n'
  if (mode === 'blankLine') return '\n\n'
  if (mode === 'space') return ' '
  return custom
}

export const BLOCK_JOIN_MODE_LABELS: Record<BlockJoinMode, string> = {
  lineBreak: 'Line break',
  blankLine: 'Blank line',
  space: 'Space',
  custom: 'Custom',
}

// ---------------------------------------------------------------------------
// Entry-level field catalogs — one per record type, used only inside that
// Block variable's own entryPatternText (never in the top-level Format Pattern).
// ---------------------------------------------------------------------------

export const VITALS_ENTRY_FIELD_ORDER: VitalsEntryFieldId[] = ['entryDate', 'entryTime', 'bp', 'hr', 'rr', 'temp', 'spo2', 'note']
export const ORDERS_ENTRY_FIELD_ORDER: OrdersEntryFieldId[] = ['entryDate', 'entryTime', 'service', 'orderText', 'status', 'note']
export const PROBLEMS_ENTRY_FIELD_ORDER: ProblemsEntryFieldId[] = ['problemIndex', 'problemTitle', 'problemNotes', 'resolvedMarker']
export const CHECKLIST_ENTRY_FIELD_ORDER: ChecklistEntryFieldId[] = ['checkbox', 'itemText', 'itemNotes']
export const MEDICATIONS_ENTRY_FIELD_ORDER: MedicationsEntryFieldId[] = ['medication', 'dose', 'route', 'frequency', 'note', 'statusMarker']

export const ENTRY_FIELD_ORDER_BY_BLOCK: Record<BlockVariableId, string[]> = {
  vitals: VITALS_ENTRY_FIELD_ORDER,
  orders: ORDERS_ENTRY_FIELD_ORDER,
  problems: PROBLEMS_ENTRY_FIELD_ORDER,
  checklist: CHECKLIST_ENTRY_FIELD_ORDER,
  medications: MEDICATIONS_ENTRY_FIELD_ORDER,
  labs: [],
}

export const ENTRY_FIELD_LABELS_BY_BLOCK: Record<BlockVariableId, Record<string, string>> = {
  vitals: {
    entryDate: 'Entry Date', entryTime: 'Entry Time',
    bp: 'BP', hr: 'HR', rr: 'RR', temp: 'Temp', spo2: 'SpO2', note: 'Note',
  },
  orders: {
    entryDate: 'Entry Date', entryTime: 'Entry Time',
    service: 'Service', orderText: 'Order Text', status: 'Status', note: 'Note',
  },
  problems: {
    problemIndex: 'Number', problemTitle: 'Title', problemNotes: 'Notes', resolvedMarker: 'Resolved Marker',
  },
  checklist: {
    checkbox: 'Checkbox', itemText: 'Item Text', itemNotes: 'Item Notes',
  },
  medications: {
    medication: 'Medication', dose: 'Dose', route: 'Route', frequency: 'Frequency', note: 'Note', statusMarker: 'Status Marker',
  },
  labs: {},
}

/** Group-level fields for Tag Combo Grouping's own `groupPatternText`/`groupVariables` — see
 * `GroupVariableInstance`. */
export type GroupFieldId = 'groupLabel' | 'currentDate' | 'currentTime' | 'patientTally' | 'patientInfo'
  | 'admittedTally' | 'admittedList'
  | 'referredTally' | 'referredList'
  | 'dischargedTally' | 'dischargedList'
  | 'signedOutTally' | 'signedOutList'
  | 'expiredTally' | 'expiredList'

export const GROUP_FIELD_ORDER: GroupFieldId[] = [
  'groupLabel', 'currentDate', 'currentTime', 'patientTally', 'patientInfo',
  'admittedTally', 'admittedList',
  'referredTally', 'referredList',
  'dischargedTally', 'dischargedList',
  'signedOutTally', 'signedOutList',
  'expiredTally', 'expiredList',
]

export const GROUP_FIELD_LABELS: Record<GroupFieldId, string> = {
  groupLabel: 'Group Label',
  currentDate: 'Current Date',
  currentTime: 'Current Time',
  patientTally: 'Patient Tally',
  patientInfo: 'Patient Info',
  admittedTally: 'New Admissions (tally)',
  admittedList: 'New Admissions (list)',
  referredTally: 'New Referrals (tally)',
  referredList: 'New Referrals (list)',
  dischargedTally: 'Discharged (tally)',
  dischargedList: 'Discharged (list)',
  signedOutTally: 'Signed Out (tally)',
  signedOutList: 'Signed Out (list)',
  expiredTally: 'Expired (tally)',
  expiredList: 'Expired (list)',
}

const GROUP_FIELD_TO_CENSUS_STATUS: Partial<Record<GroupFieldId, CensusStatus>> = {
  admittedTally: 'admitted', admittedList: 'admitted',
  referredTally: 'referred', referredList: 'referred',
  dischargedTally: 'discharged', dischargedList: 'discharged',
  signedOutTally: 'signedOut', signedOutList: 'signedOut',
  expiredTally: 'expired', expiredList: 'expired',
}

/** `groupFieldId` → the `GroupVariableInstance` it represents — used both by the Group Format
 * chip editor (placing a new chip) and by the v25 migration (remapping an old Census Summary
 * field token onto its new equivalent, see db.ts). */
export const buildGroupVariableInstanceForField = (fieldId: GroupFieldId): GroupVariableInstance => {
  if (fieldId === 'currentDate' || fieldId === 'currentTime') return { kind: 'flat', variableId: fieldId }
  if (fieldId === 'groupLabel') return { kind: 'groupLabel' }
  if (fieldId === 'patientTally') return { kind: 'patientTally' }
  if (fieldId === 'patientInfo') return { kind: 'patientInfo' }
  const status = GROUP_FIELD_TO_CENSUS_STATUS[fieldId]
  const field = fieldId.endsWith('Tally') ? 'tally' : 'list'
  return { kind: 'censusStatus', status: status ?? 'admitted', field }
}

/** The inverse of `buildGroupVariableInstanceForField` — what `GroupFieldId` a saved
 * `GroupVariableInstance` corresponds to, e.g. for pre-filling the Group Format chip editor's
 * `initialFieldIds` from a template's saved `groupVariables`. */
export const groupFieldIdForInstance = (instance: GroupVariableInstance): GroupFieldId => {
  if (instance.kind === 'flat') return instance.variableId
  if (instance.kind === 'groupLabel') return 'groupLabel'
  if (instance.kind === 'patientTally') return 'patientTally'
  if (instance.kind === 'patientInfo') return 'patientInfo'
  return `${instance.status}${instance.field === 'tally' ? 'Tally' : 'List'}` as GroupFieldId
}

/** Entry-level fields whose value is a date/time (so a Date/Time Format can be chosen for that
 * specific chip, via `BlockVariableConfig.entryFieldDateTimeFormats`). */
const DATE_TIME_ENTRY_FIELD_IDS_BY_BLOCK: Record<BlockVariableId, Set<string>> = {
  vitals: new Set(['entryDate', 'entryTime']),
  orders: new Set(['entryDate', 'entryTime']),
  problems: new Set(),
  checklist: new Set(),
  medications: new Set(),
  labs: new Set(),
}

export const isDateTimeCapableEntryField = (blockVariableId: BlockVariableId, fieldId: string): boolean =>
  DATE_TIME_ENTRY_FIELD_IDS_BY_BLOCK[blockVariableId]?.has(fieldId) ?? false

const resolveVitalsEntryField = (fieldId: string, entry: VitalEntry, dateTimeFormatId: string | undefined, ctx: TemplateRenderContext): string => {
  switch (fieldId as VitalsEntryFieldId) {
    case 'entryDate': return renderSavedFormatOr(dateTimeFormatId, ctx, entry.date, undefined, () => formatDateMMDD(entry.date))
    case 'entryTime': return renderSavedFormatOr(dateTimeFormatId, ctx, entry.date, entry.time, () => formatClockCompact(entry.time))
    case 'bp': return entry.bp.trim()
    case 'hr': return entry.hr.trim()
    case 'rr': return entry.rr.trim()
    case 'temp': return entry.temp.trim()
    case 'spo2': return entry.spo2.trim()
    case 'note': return entry.note.trim()
    default: return ''
  }
}

const resolveOrdersEntryField = (fieldId: string, entry: OrderEntry, dateTimeFormatId: string | undefined, ctx: TemplateRenderContext): string => {
  switch (fieldId as OrdersEntryFieldId) {
    case 'entryDate': return renderSavedFormatOr(dateTimeFormatId, ctx, entry.orderDate, undefined, () => entry.orderDate ?? '')
    case 'entryTime': return renderSavedFormatOr(dateTimeFormatId, ctx, entry.orderDate, entry.orderTime, () => entry.orderTime ?? '')
    case 'service': return (entry.service ?? '').trim()
    case 'orderText': return entry.orderText
    case 'status': return formatOrderStatus(entry.status)
    case 'note': return entry.note ?? ''
    default: return ''
  }
}

const resolveProblemsEntryField = (fieldId: string, problem: ProblemBlock, index: number, config: BlockVariableConfig): string => {
  switch (fieldId as ProblemsEntryFieldId) {
    case 'problemIndex': return String(index + 1)
    case 'problemTitle': return problem.title.trim() || 'Untitled problem'
    case 'problemNotes': return problem.notes.trim()
    case 'resolvedMarker': return problem.completed ? config.resolvedGlyph : config.unresolvedGlyph
    default: return ''
  }
}

const resolveChecklistEntryField = (
  fieldId: string,
  item: { text: string; completed: boolean; notes?: string },
  config: BlockVariableConfig,
): string => {
  switch (fieldId as ChecklistEntryFieldId) {
    case 'checkbox': return item.completed ? config.checkedGlyph : config.uncheckedGlyph
    case 'itemText': return item.text.trim()
    case 'itemNotes': return (item.notes ?? '').trim()
    default: return ''
  }
}

const resolveMedicationsEntryField = (fieldId: string, entry: MedicationEntry): string => {
  switch (fieldId as MedicationsEntryFieldId) {
    case 'medication': return entry.medication
    case 'dose': return entry.dose
    case 'route': return entry.route
    case 'frequency': return entry.frequency
    case 'note': return entry.note
    case 'statusMarker': return entry.status === 'discontinued' ? ' (discontinued)' : entry.status === 'completed' ? ' (completed)' : ''
    default: return ''
  }
}

/** Renders one entry (or Checklist/Problems item) through its Block variable's own
 * `entryPatternText`, reusing the exact same tokenize/resolve/collapse pipeline as the top-level
 * Format Pattern — just against `resolveField` instead of a `TemplateVariableInstance` map. Trims
 * trailing blank lines so an entry whose last field resolves blank (e.g. a Problem with no notes)
 * doesn't leave a dangling empty line before the next entry's separator. */
const renderEntryPattern = (
  patternText: string,
  entryFieldIds: Record<string, string>,
  entryFieldDateTimeFormats: Record<string, string>,
  resolveField: (fieldId: string, dateTimeFormatId: string | undefined) => string,
): string => {
  const parts = tokenizePatternText(patternText)
  const resolved: ResolvedSegment[] = parts.map((part) => {
    if (part.type === 'text') return { kind: 'text', text: part.text }
    if (part.type === 'lineBreak') return { kind: 'lineBreak' }
    const fieldId = entryFieldIds[part.id]
    if (!fieldId) return { kind: 'text', text: buildVariableToken(part.id) }
    const text = resolveField(fieldId, entryFieldDateTimeFormats[part.id])
    return { kind: 'value', text, blank: text.trim() === '' }
  })
  return renderResolvedSegments(collapseBlanks(resolved)).replace(/\n+$/, '')
}

const renderGroupHeader = (dateISO: string, config: BlockVariableConfig, ctx: TemplateRenderContext): string =>
  renderSavedFormatOr(config.groupHeaderDateFormatId, ctx, dateISO, undefined, () => formatDateMMDDYYYY(dateISO))

/** Default range-mode settings for a freshly-inserted Block variable, independent of which record
 * type it is — entry-pattern defaults (which DO depend on the record type) live in
 * `buildDefaultBlockVariableConfig` below. Defaults to a single most-recent entry (equivalent to
 * the old, now-removed, 'latest' mode) as the least-surprising starting point. */
export const DEFAULT_BLOCK_VARIABLE_CONFIG: Pick<
  BlockVariableConfig, 'rangeMode' | 'entryCount' | 'relativeMode' | 'fixedDateFrom' | 'fixedTimeFrom' | 'fixedDateTo' | 'fixedTimeTo' | 'lastNDays'
> = {
  rangeMode: 'numberOfEntries',
  entryCount: 1,
  relativeMode: 'lastNDays',
  fixedDateFrom: '',
  fixedTimeFrom: '',
  fixedDateTo: '',
  fixedTimeTo: '',
  lastNDays: 7,
}

/** Builds an entry pattern that exactly reproduces this record type's historical hardcoded
 * formatting — so a freshly-inserted Block variable's default output is unchanged from before
 * entry patterns existed, and the user only sees a difference once they choose to edit it. */
const buildDefaultEntryPattern = (variableId: BlockVariableId): {
  entryPatternText: string
  entryFieldIds: Record<string, string>
} => {
  const entryFieldIds: Record<string, string> = {}
  const token = (fieldId: string): string => {
    const id = createVariableId()
    entryFieldIds[id] = fieldId
    return buildVariableToken(id)
  }

  switch (variableId) {
    case 'vitals':
      return { entryFieldIds, entryPatternText: `${token('entryDate')} ${token('entryTime')} ${token('bp')} ${token('hr')} ${token('rr')} ${token('temp')} ${token('spo2')} ${token('note')}` }
    case 'orders':
      return { entryFieldIds, entryPatternText: `${token('service')} ${token('entryDate')} ${token('entryTime')} • ${token('orderText')} — ${token('note')} (${token('status')})` }
    case 'problems':
      return { entryFieldIds, entryPatternText: `${token('problemIndex')}. ${token('problemTitle')}${token('resolvedMarker')}\n${token('problemNotes')}` }
    case 'checklist':
      return { entryFieldIds, entryPatternText: `- [${token('checkbox')}] ${token('itemText')}` }
    case 'medications':
      return { entryFieldIds, entryPatternText: `${token('medication')} ${token('dose')} ${token('route')} ${token('frequency')} — ${token('note')}${token('statusMarker')}` }
    default:
      return { entryFieldIds: {}, entryPatternText: '' }
  }
}

export const buildDefaultBlockVariableConfig = (variableId: BlockVariableId): BlockVariableConfig => ({
  ...DEFAULT_BLOCK_VARIABLE_CONFIG,
  ...buildDefaultEntryPattern(variableId),
  entryFieldDateTimeFormats: {},
  entrySeparator: 'lineBreak',
  customEntrySeparator: '',
  showGroupHeader: true,
  groupHeaderDateFormatId: undefined,
  groupSeparator: 'blankLine',
  customGroupSeparator: '',
  checkedGlyph: 'x',
  uncheckedGlyph: ' ',
  resolvedGlyph: ' (resolved)',
  unresolvedGlyph: '',
  includeSubjective: false,
  includeObjective: false,
  includeAssessment: false,
  includePlans: false,
  includeActiveMedications: true,
  includeDiscontinuedMedications: false,
  includeCompletedMedications: false,
  includeMedicationNotes: true,
  medicationNotesPosition: 'before',
  labsDateDisplayMode: 'perEntry',
})

export const DEFAULT_TAGS_VARIABLE_CONFIG: TagsVariableConfig = {
  includeAll: true,
  tagIds: [],
  groupIds: [],
  emojiRendering: 'emoji',
}

export type TemplateRenderContext = {
  tagsById: Map<number, TagDefinition>
  tagGroups: TagGroupDefinition[]
  vitalsByPatient: Map<number, VitalEntry[]>
  labsByPatient: Map<number, LabEntry[]>
  ordersByPatient: Map<number, OrderEntry[]>
  medicationsByPatient: Map<number, MedicationEntry[]>
  dailyUpdatesByPatient: Map<number, DailyUpdate[]>
  currentDateText: string
  currentTimeText: string
  /** Raw instant behind currentDateText/currentTimeText — needed so Current Date/Current Time can
   * still be re-rendered through a user-chosen Date/Time Format instead of the built-in default. */
  nowDate: Date
  dateTimeFormatsById: Map<string, DateTimeFormatDefinition>
  /** Every patient in the roster (not just whichever ones are selected for the per-patient body) —
   * a Census Summary variable scans all of them, since it's reporting on census changes generally,
   * independent of which patients happen to be checked for the main per-patient section. */
  allPatients: Patient[]
  /** Same Admitted/Referred/Discharged detection already built for the Patient Filter's
   * Special/Timebound facet — reused as-is by Census Summary's per-tag classification. */
  poolContext: PatientPoolContext
}

/** Current Date/Time are captured once at the start of report generation — every patient's line
 * in the same generated report shows the identical value, even across a multi-second generation. */
export const buildCurrentDateTimeText = (now = new Date()): { currentDateText: string; currentTimeText: string; nowDate: Date } => ({
  currentDateText: new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(now),
  currentTimeText: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now),
  nowDate: now,
})

/** Flat variable ids for which a `dateTimeFormatId` on the instance is meaningful. */
export const DATE_TIME_CAPABLE_FLAT_VARIABLE_IDS = new Set<FlatVariableId>([
  'admitDate', 'admitTime', 'referralDate', 'referralTime', 'dischargeDate', 'dischargeTime', 'currentDate', 'currentTime',
])

const resolveFlatVariable = (
  variableId: FlatVariableId,
  dateTimeFormatId: string | undefined,
  patient: Patient,
  ctx: TemplateRenderContext,
): string => {
  switch (variableId) {
    case 'roomNumber': return patient.roomNumber
    case 'ward': return patient.ward
    case 'lastName': return patient.lastName
    case 'firstName': return patient.firstName
    case 'middleName': return patient.middleName ?? ''
    case 'age': return patient.age !== undefined ? String(patient.age) : ''
    case 'sex': return patient.sex
    case 'mainService': return resolveServiceTagNames(patient.mainServiceTagIds, ctx.tagsById).join(', ')
    case 'referralService': return resolveServiceTagNames(patient.referralServiceTagIds, ctx.tagsById).join(', ')
    case 'admissionDiagnosis': return composeDiagnosisText(patient, patient.admissionDiagnosisUnassigned, patient.admissionDiagnosisByService, ctx.tagsById)
    case 'dischargeDiagnosis': return composeDiagnosisText(patient, patient.dischargeDiagnosisUnassigned, patient.dischargeDiagnosisByService, ctx.tagsById)
    case 'clinicalSummary': return patient.clinicalSummary
    case 'admitDate': {
      const iso = getEffectiveAdmitDate(patient.admitDate, patient.createdAt)
      return iso ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, undefined, () => formatDateMMDDYYYY(iso)) : ''
    }
    case 'admitTime': {
      const iso = getEffectiveAdmitDate(patient.admitDate, patient.createdAt)
      const time = patient.admitTime || toLocalTime(new Date(patient.createdAt))
      return time ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, time, () => formatClock(time)) : ''
    }
    case 'referralDate': {
      const iso = patient.referralDate
      return iso ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, undefined, () => formatDateMMDDYYYY(iso)) : ''
    }
    case 'referralTime': {
      const time = patient.referralTime
      return time ? renderSavedFormatOr(dateTimeFormatId, ctx, patient.referralDate, time, () => formatClock(time)) : ''
    }
    case 'dischargeDate': {
      const iso = patient.dischargeDate
      return iso ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, undefined, () => formatDateMMDDYYYY(iso)) : ''
    }
    case 'dischargeTime': {
      const time = patient.dischargeTime
      return time ? renderSavedFormatOr(dateTimeFormatId, ctx, patient.dischargeDate ?? '', time, () => formatClock(time)) : ''
    }
    case 'database': return patient.database
    case 'currentDate':
      return dateTimeFormatId
        ? renderSavedFormatOr(dateTimeFormatId, ctx, toLocalISODate(ctx.nowDate), undefined, () => ctx.currentDateText)
        : ctx.currentDateText
    case 'currentTime':
      return dateTimeFormatId
        ? renderSavedFormatOr(dateTimeFormatId, ctx, toLocalISODate(ctx.nowDate), `${ctx.nowDate.getHours()}:${ctx.nowDate.getMinutes()}`, () => ctx.currentTimeText)
        : ctx.currentTimeText
    default: return ''
  }
}

/** Tags reads independently of Issue 1's "Visible on Patient Card" toggle — a tag can be hidden
 * from patient cards but still included here, or vice versa — so "include all" means every
 * currently-applied tag, not just the ones visibleOnPatientCard would show. */
const resolveTagsVariable = (config: TagsVariableConfig, patient: Patient, ctx: TemplateRenderContext): string => {
  const applied = getAppliedPatientTags(patient, ctx.tagsById)
  const selected = config.includeAll
    ? applied
    : applied.filter((tag) =>
      (tag.id !== undefined && config.tagIds.includes(tag.id))
      || (tag.groupId !== undefined && config.groupIds.includes(tag.groupId)),
    )
  const ordered = orderTagsCanonically(selected, ctx.tagGroups)
  return ordered
    .map((tag) => {
      if (tag.displayType === 'emoji') {
        return config.emojiRendering === 'emoji' ? (tag.emoji || tag.name) : tag.name
      }
      // Text-with-Color tags always render as their plain name — color can't be represented in plain text.
      return renderTagDisplayText(tag)
    })
    .join(' ')
}

const resolveDateRangeBounds = (config: BlockVariableConfig, admitDateEffective: string): { dateFrom: string; timeFrom: string; dateTo: string; timeTo: string } => {
  const today = toLocalISODate()
  if (config.relativeMode === 'fixed') {
    return {
      // The settings UI requires `fixedDateFrom`/`fixedTimeFrom` before it'll save, so this
      // fallback only matters defensively (e.g. hand-edited/legacy data) — it never reflects an
      // intended "unbounded start".
      dateFrom: config.fixedDateFrom || '0001-01-01',
      timeFrom: config.fixedTimeFrom || '00:00',
      dateTo: config.fixedDateTo || today,
      timeTo: config.fixedTimeTo || '23:59',
    }
  }
  if (config.relativeMode === 'sinceAdmission') return { dateFrom: admitDateEffective, timeFrom: '00:00', dateTo: today, timeTo: '23:59' }
  const from = new Date()
  from.setDate(from.getDate() - Math.max(0, config.lastNDays))
  return { dateFrom: toLocalISODate(from), timeFrom: '00:00', dateTo: today, timeTo: '23:59' }
}

/** Selects which raw entries a Block variable placeholder includes, per its saved rangeMode —
 * accessor-based so callers with differently-named date/time fields (OrderEntry's
 * orderDate/orderTime, DailyUpdate's date-only) don't need to reshape their data first. `hasTime`
 * gates whether Date Range's Fixed Dates time boundaries apply at all — Problems/Checklist have no
 * per-entry time, so their date-range filtering always stays date-only regardless of what's set. */
const filterByRangeMode = <T,>(
  entries: T[],
  config: BlockVariableConfig,
  admitDateEffective: string,
  getDate: (entry: T) => string,
  getTime: (entry: T) => string,
  getCreatedAt: (entry: T) => string,
  hasTime: boolean,
): T[] => {
  const sorted = [...entries].sort((a, b) => {
    const dateA = getDate(a)
    const dateB = getDate(b)
    if (dateA !== dateB) return dateB.localeCompare(dateA)
    const timeA = getTime(a)
    const timeB = getTime(b)
    if (timeA !== timeB) return timeB.localeCompare(timeA)
    return getCreatedAt(b).localeCompare(getCreatedAt(a))
  })

  if (config.rangeMode === 'numberOfEntries') return sorted.slice(0, Math.max(1, config.entryCount))

  const { dateFrom, timeFrom, dateTo, timeTo } = resolveDateRangeBounds(config, admitDateEffective)
  return sorted.filter((entry) => {
    const date = getDate(entry)
    const time = getTime(entry)
    if (!hasTime || !time) return date >= dateFrom && date <= dateTo
    return isWithinDateTimeWindow(date, time, dateFrom, dateTo, timeFrom, timeTo)
  })
}

const resolveVitalsBlock = (config: BlockVariableConfig, entries: VitalEntry[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  const scoped = filterByRangeMode(entries, config, admitDateEffective, (e) => e.date, (e) => e.time, (e) => e.createdAt, true)
  const lines = [...scoped]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)))
    .map((entry) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, config.entryFieldDateTimeFormats, (fieldId, formatId) => resolveVitalsEntryField(fieldId, entry, formatId, ctx)))
  return lines.join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
}

const resolveLabsBlock = (config: BlockVariableConfig, entries: LabEntry[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  // Number of Entries / Date Range apply PER lab template independently, so "2" reliably lands 2
  // entries of the SAME template — which is what the comparison-mode formatting needs — rather
  // than the 2 most recent entries overall regardless of test type.
  const byTemplate = new Map<string, LabEntry[]>()
  entries.forEach((entry) => {
    const list = byTemplate.get(entry.templateId) ?? []
    list.push(entry)
    byTemplate.set(entry.templateId, list)
  })
  const scoped: LabEntry[] = []
  byTemplate.forEach((group) => {
    scoped.push(...filterByRangeMode(group, config, admitDateEffective, (e) => e.date, (e) => e.time ?? '', (e) => e.createdAt, true))
  })

  const pieces = buildLabReportBlockPieces(scoped)
  const entrySep = resolveJoinString(config.entrySeparator, config.customEntrySeparator)

  if (config.labsDateDisplayMode === 'none') {
    return pieces.map((piece) => [piece.label, piece.body].join('\n')).join(entrySep)
  }
  if (config.labsDateDisplayMode === 'groupedByDate') {
    const byDate = new Map<string, typeof pieces>()
    pieces.forEach((piece) => {
      const list = byDate.get(piece.date) ?? []
      list.push(piece)
      byDate.set(piece.date, list)
    })
    const groupTexts = [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, group]) => {
        const header = renderGroupHeader(date, config, ctx)
        const body = group
          .map((piece) => [piece.label, piece.headerDetail, piece.body].filter(Boolean).join('\n'))
          .join(entrySep)
        return [header, body].join('\n')
      })
    return groupTexts.join(resolveJoinString(config.groupSeparator, config.customGroupSeparator))
  }
  // perEntry (default): each block shows its own date. Unset format reproduces this app's
  // historical per-block date line verbatim (dash-style for a comparison, slash-style for a
  // single result) — choosing a format instead renders just the date through it, with the
  // comparison's "vs ..." detail (if any) still appended alongside.
  const hasCustomFormat = Boolean(config.groupHeaderDateFormatId && ctx.dateTimeFormatsById.get(config.groupHeaderDateFormatId))
  return pieces.map((piece) => {
    const dateLine = hasCustomFormat
      ? [renderGroupHeader(piece.date, config, ctx), piece.headerDetail].filter(Boolean).join(' ')
      : piece.legacyDateLine
    return [piece.label, dateLine, piece.body].join('\n')
  }).join(entrySep)
}

const resolveOrdersBlock = (config: BlockVariableConfig, entries: OrderEntry[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  const scoped = filterByRangeMode(entries, config, admitDateEffective, (e) => e.orderDate, (e) => e.orderTime ?? '', (e) => e.createdAt, true)
  const lines = [...scoped]
    .sort((a, b) => (a.orderDate !== b.orderDate ? a.orderDate.localeCompare(b.orderDate) : a.orderTime.localeCompare(b.orderTime)))
    .map((entry) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, config.entryFieldDateTimeFormats, (fieldId, formatId) => resolveOrdersEntryField(fieldId, entry, formatId, ctx)))
  return lines.join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
}

/** Problems/Checklist have no per-entry time, only a per-date DailyUpdate row — each qualifying
 * row becomes its own dated group. */
const resolveProblemsBlock = (config: BlockVariableConfig, updates: DailyUpdate[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  const scoped = filterByRangeMode(updates, config, admitDateEffective, (e) => e.date, () => '', (e) => e.lastUpdated, false)
  const groupTexts = [...scoped]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((update) => {
      const problems = (update.problems ?? []).filter((problem) => problem.title.trim() || problem.notes.trim())
      // Subjective/Objective/Assessment/Plan are per-date DailyUpdate fields, not per-problem
      // entries, so they can't live in entryPatternText like problemTitle/problemNotes — instead
      // each enabled one is appended, labeled, below that date's problem entries (SOAP order).
      const soapLines = [
        config.includeSubjective && update.subjective?.trim() ? `Subjective: ${update.subjective.trim()}` : '',
        config.includeObjective && update.objective?.trim() ? `Objective: ${update.objective.trim()}` : '',
        config.includeAssessment && update.assessment?.trim() ? `Assessment: ${update.assessment.trim()}` : '',
        config.includePlans && update.plans?.trim() ? `Plan: ${update.plans.trim()}` : '',
      ].filter(Boolean)
      if (problems.length === 0 && soapLines.length === 0) return ''
      const problemsBody = problems
        .map((problem, index) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, config.entryFieldDateTimeFormats, (fieldId) => resolveProblemsEntryField(fieldId, problem, index, config)))
        .join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
      const body = [problemsBody, ...soapLines].filter(Boolean).join('\n')
      if (!config.showGroupHeader) return body
      return [renderGroupHeader(update.date, config, ctx), body].join('\n')
    })
    .filter(Boolean)
  return groupTexts.join(resolveJoinString(config.groupSeparator, config.customGroupSeparator))
}

const resolveChecklistBlock = (config: BlockVariableConfig, updates: DailyUpdate[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  const scoped = filterByRangeMode(updates, config, admitDateEffective, (e) => e.date, () => '', (e) => e.lastUpdated, false)
  const groupTexts = [...scoped]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((update) => {
      const items = (update.checklist ?? []).filter((item) => item.text.trim())
      if (items.length === 0) return ''
      const body = items
        .map((item) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, config.entryFieldDateTimeFormats, (fieldId) => resolveChecklistEntryField(fieldId, item, config)))
        .join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
      if (!config.showGroupHeader) return body
      return [renderGroupHeader(update.date, config, ctx), body].join('\n')
    })
    .filter(Boolean)
  return groupTexts.join(resolveJoinString(config.groupSeparator, config.customGroupSeparator))
}

/** MedicationEntry carries no date, so there's no range mode to filter by — `includeXMedications`
 * (status checkboxes) is the equivalent axis, and the freeform Medications-tab text
 * (`Patient.medications`) is folded in as an optional extra line rather than a separate variable,
 * since it isn't itself a list of entries. */
const resolveMedicationsBlock = (config: BlockVariableConfig, patient: Patient, entries: MedicationEntry[]): string => {
  const included = entries.filter((entry) =>
    (entry.status === 'active' && config.includeActiveMedications)
    || (entry.status === 'discontinued' && config.includeDiscontinuedMedications)
    || (entry.status === 'completed' && config.includeCompletedMedications),
  )
  const sorted = [...included].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const structuredLines = sorted
    .map((entry) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, config.entryFieldDateTimeFormats, (fieldId) => resolveMedicationsEntryField(fieldId, entry)))
    .filter((line) => line.trim() !== '')
  const notesLine = config.includeMedicationNotes ? patient.medications.trim() : ''
  const lines = config.medicationNotesPosition === 'before'
    ? [notesLine, ...structuredLines].filter(Boolean)
    : [...structuredLines, notesLine].filter(Boolean)
  return lines.join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
}

const patientHasAutomationRole = (patient: Patient, tagsById: Map<number, TagDefinition>, role: TagAutomationRole): boolean =>
  (patient.tagIds ?? []).some((tagId) => tagsById.get(tagId)?.automationRole === role)

const resolveBlockVariable = (
  variableId: BlockVariableId,
  config: BlockVariableConfig,
  patient: Patient,
  ctx: TemplateRenderContext,
): string => {
  const admitDateEffective = getEffectiveAdmitDate(patient.admitDate, patient.createdAt)
  const patientId = patient.id ?? -1
  switch (variableId) {
    case 'vitals': return resolveVitalsBlock(config, ctx.vitalsByPatient.get(patientId) ?? [], admitDateEffective, ctx)
    case 'labs': return resolveLabsBlock(config, ctx.labsByPatient.get(patientId) ?? [], admitDateEffective, ctx)
    case 'orders': return resolveOrdersBlock(config, ctx.ordersByPatient.get(patientId) ?? [], admitDateEffective, ctx)
    case 'problems': return resolveProblemsBlock(config, ctx.dailyUpdatesByPatient.get(patientId) ?? [], admitDateEffective, ctx)
    case 'checklist': return resolveChecklistBlock(config, ctx.dailyUpdatesByPatient.get(patientId) ?? [], admitDateEffective, ctx)
    case 'medications': return resolveMedicationsBlock(config, patient, ctx.medicationsByPatient.get(patientId) ?? [])
    default: return ''
  }
}

const resolveVariableInstance = (instance: TemplateVariableInstance, patient: Patient, ctx: TemplateRenderContext): string => {
  if (instance.kind === 'flat') return resolveFlatVariable(instance.variableId, instance.dateTimeFormatId, patient, ctx)
  if (instance.kind === 'block') return resolveBlockVariable(instance.variableId, instance.config, patient, ctx)
  return resolveTagsVariable(instance.config, patient, ctx)
}

const resolvePatternPart = (
  part: PatternPart,
  variables: Record<string, TemplateVariableInstance>,
  patient: Patient,
  ctx: TemplateRenderContext,
): ResolvedSegment => {
  if (part.type === 'text') return { kind: 'text', text: part.text }
  if (part.type === 'lineBreak') return { kind: 'lineBreak' }

  const instance = variables[part.id]
  // A stale/missing variable id (shouldn't normally happen — the editor is the only thing that
  // writes tokens) degrades to literal token text rather than silently vanishing.
  if (!instance) return { kind: 'text', text: buildVariableToken(part.id) }

  const text = resolveVariableInstance(instance, patient, ctx)
  return { kind: 'value', text, blank: text.trim() === '' }
}

/** Takes just the two fields it actually reads (rather than a full `ReportTemplate`) so it can
 * render a template's Header/Footer — a `patternText`/`variables` pair with no other
 * `ReportTemplate` fields behind them — without needing to fabricate a dummy template object. */
export const renderTemplateForPatient = (template: Pick<ReportTemplate, 'patternText' | 'variables'>, patient: Patient, ctx: TemplateRenderContext): string => {
  const parts = tokenizePatternText(template.patternText)
  const resolved = parts.map((part) => resolvePatternPart(part, template.variables, patient, ctx))
  return renderResolvedSegments(collapseBlanks(resolved))
}

/** Flat variables that read patient data — everything except the two non-patient special
 * variables (Current Date/Time), which don't make a template Per-Patient on their own. */
const PATIENT_DEPENDENT_FLAT_VARIABLES = new Set<FlatVariableId>([
  'roomNumber', 'ward', 'lastName', 'firstName', 'middleName', 'age', 'sex',
  'mainService', 'referralService', 'admissionDiagnosis', 'dischargeDiagnosis', 'clinicalSummary',
  'admitDate', 'admitTime', 'referralDate', 'referralTime', 'dischargeDate', 'dischargeTime', 'database',
])

export type TemplateRepeatMode = 'per-patient' | 'prints-once'

const isPatientDependentInstance = (instance: TemplateVariableInstance): boolean => {
  if (instance.kind === 'block') return true
  if (instance.kind === 'tags') return true
  return PATIENT_DEPENDENT_FLAT_VARIABLES.has(instance.variableId)
}

/**
 * Point 2 (Template Repeat Mode) of issue #82, simplified for this PR: Template variables (and
 * therefore their per-patient/multi-patient distinction) are deferred to a follow-up, so this
 * reduced rule only asks "does the Format Pattern contain any variable that depends on a specific
 * patient" — any patient-data Flat variable, any Block variable, or a Tags variable. A template
 * with only literal text and/or Current Date/Current Time is Prints Once. Re-evaluate this
 * whenever the Format Pattern changes; never set it manually. Tag Combo Grouping (issue #145)
 * always needs the report's own patient-filter step regardless of what the main Format Pattern
 * contains, so a grouping-enabled template is always Per-Patient. */
export const classifyTemplateRepeatMode = (template: Pick<ReportTemplate, 'patternText' | 'variables' | 'groupingEnabled'>): TemplateRepeatMode => {
  if (template.groupingEnabled) return 'per-patient'

  const usedIds = new Set<string>()
  for (const match of template.patternText.matchAll(VARIABLE_TOKEN_REGEX)) usedIds.add(match[1])

  const hasPatientDependentVariable = [...usedIds].some((id) => {
    const instance = template.variables[id]
    return instance !== undefined && isPatientDependentInstance(instance)
  })
  return hasPatientDependentVariable ? 'per-patient' : 'prints-once'
}

/** Human-readable label for a variable chip/summary — used by the editor and the variable picker. */
export const describeVariableInstance = (instance: TemplateVariableInstance): string => {
  if (instance.kind === 'flat') return FLAT_VARIABLE_LABELS[instance.variableId]
  if (instance.kind === 'block') {
    const detail = instance.variableId === 'medications' ? describeMedicationsConfig(instance.config) : describeBlockConfig(instance.config)
    return `${BLOCK_VARIABLE_LABELS[instance.variableId]} — ${detail}`
  }
  return describeTagsConfig(instance.config)
}

/** Human-readable label for a Group Format chip/summary — used by the Tag Combo Grouping editor. */
export const describeGroupVariableInstance = (instance: GroupVariableInstance): string => {
  if (instance.kind === 'flat') return instance.variableId === 'currentDate' ? 'Current Date' : 'Current Time'
  if (instance.kind === 'groupLabel') return 'Group Label'
  if (instance.kind === 'patientTally') return 'Patient Tally'
  if (instance.kind === 'patientInfo') return 'Patient Info'
  const fieldId = `${instance.status}${instance.field === 'tally' ? 'Tally' : 'List'}` as GroupFieldId
  return GROUP_FIELD_LABELS[fieldId]
}

/** Order-independent identity for an automatic-mode combo — the same set of tag ids always
 * produces the same key regardless of selection/Cartesian-product order, so
 * `AutomaticGroupLabelOverride` entries keep matching their combo across re-derivations. */
export const canonicalComboKey = (tagIds: number[]): string => [...tagIds].sort((a, b) => a - b).join(',')

/** Derives automatic mode's output combos straight from `groupTagIds`/`groupCombineMode`, with no
 * label overrides applied yet (see `mergeAutomaticGroupLabels`) — natural order, and a plain
 * ", "-joined `defaultLabel`. With no selected tags spanning more than one Tag Group (or only one
 * selected tag), each tag is simply its own combo; otherwise `groupCombineMode` decides — 'OR'
 * unions every selected tag into its own combo regardless of origin, 'AND' cross-combines instead,
 * producing one combo per combination of one tag from each represented Tag Group (a Cartesian
 * product). */
export const computeAutomaticGroupCombos = (
  template: Pick<ReportTemplate, 'groupTagIds' | 'groupCombineMode'>,
  tagsById: Map<number, TagDefinition>,
): { comboKey: string; tagIds: number[]; defaultLabel: string }[] => {
  const selectedTags = template.groupTagIds.map((id) => tagsById.get(id)).filter((tag): tag is TagDefinition => tag !== undefined)
  if (selectedTags.length === 0) return []

  const tagsByOriginGroup = new Map<number | 'ungrouped', TagDefinition[]>()
  selectedTags.forEach((tag) => {
    const key = tag.groupId ?? 'ungrouped'
    const existing = tagsByOriginGroup.get(key)
    if (existing) existing.push(tag)
    else tagsByOriginGroup.set(key, [tag])
  })
  const perOriginGroup = [...tagsByOriginGroup.values()]

  const combos = perOriginGroup.length <= 1 || template.groupCombineMode === 'OR'
    ? selectedTags.map((tag) => [tag])
    : perOriginGroup.reduce<TagDefinition[][]>(
      (combosSoFar, tagsInOneOriginGroup) => combosSoFar.flatMap((combo) => tagsInOneOriginGroup.map((tag) => [...combo, tag])),
      [[]],
    )

  return combos.map((combo) => {
    const tagIds = combo.map((tag) => tag.id).filter((id): id is number => id !== undefined)
    return { comboKey: canonicalComboKey(tagIds), tagIds, defaultLabel: combo.map((tag) => tag.name).join(', ') }
  })
}

/** Applies automatic mode's user-authored label/order overrides on top of the freshly-derived
 * combos: a combo with a matching `comboKey` in `overrides` uses that override's `label` and
 * `sortOrder` verbatim; every other combo falls back to its `defaultLabel` and sorts after every
 * overridden combo, in natural relative order. Shared by the grouping editor (to render the
 * automatic-mode group list) and `buildOutputGroups` (to render the actual report), so both always
 * agree on label and order. */
export const mergeAutomaticGroupLabels = (
  combos: { comboKey: string; tagIds: number[]; defaultLabel: string }[],
  overrides: AutomaticGroupLabelOverride[],
): { comboKey: string; tagIds: number[]; label: string; sortOrder: number }[] => {
  const overrideByKey = new Map(overrides.map((override) => [override.comboKey, override]))
  const maxOverrideOrder = overrides.reduce((max, override) => Math.max(max, override.sortOrder), -1)
  let nextFallbackOrder = maxOverrideOrder + 1

  const merged = combos.map((combo) => {
    const override = overrideByKey.get(combo.comboKey)
    if (override) return { comboKey: combo.comboKey, tagIds: combo.tagIds, label: override.label, sortOrder: override.sortOrder }
    return { comboKey: combo.comboKey, tagIds: combo.tagIds, label: combo.defaultLabel, sortOrder: nextFallbackOrder++ }
  })
  return merged.sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Buckets patients into Tag Combo Grouping's output groups. Automatic mode: see
 * `computeAutomaticGroupCombos`/`mergeAutomaticGroupLabels`. Manual mode just maps
 * `groupManualCombos` (sorted by `sortOrder`) straight across, using each combo's own hand-typed
 * label. */
const buildOutputGroups = (
  template: Pick<ReportTemplate, 'groupSelectionMode' | 'groupTagIds' | 'groupCombineMode' | 'groupAutomaticLabels' | 'groupManualCombos'>,
  tagsById: Map<number, TagDefinition>,
): { label: string; tagIds: number[] }[] => {
  // Defensive fallback: a template persisted by a build from before these fields existed (stale
  // local dev IndexedDB, mid-deploy client) would otherwise crash report generation entirely.
  if (template.groupSelectionMode === 'manual') {
    return [...(template.groupManualCombos ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((combo) => ({ label: combo.label, tagIds: combo.tagIds }))
  }

  const combos = computeAutomaticGroupCombos(template, tagsById)
  return mergeAutomaticGroupLabels(combos, template.groupAutomaticLabels ?? []).map((group) => ({ label: group.label, tagIds: group.tagIds }))
}

/** Renders a list of patients through the template's own per-patient Format Pattern (the same one
 * the ungrouped body uses), joined by `patientSeparator`/`customPatientSeparator` — backs both
 * `patientInfo` and each status's `list` field. "" when empty and `groupShowListBracketsWhenEmpty`
 * is off; otherwise `groupListOpenText` + the joined rows + `groupListCloseText` (so an
 * empty-but-shown list renders as e.g. "()"). */
const renderGroupPatientList = (
  patients: Patient[],
  template: Pick<ReportTemplate, 'patternText' | 'variables' | 'patientSeparator' | 'customPatientSeparator' | 'groupListOpenText' | 'groupListCloseText' | 'groupShowListBracketsWhenEmpty'>,
  ctx: TemplateRenderContext,
): string => {
  if (patients.length === 0 && !template.groupShowListBracketsWhenEmpty) return ''
  const rows = patients
    .map((patient) => renderTemplateForPatient(template, patient, ctx))
    .join(resolveJoinString(template.patientSeparator, template.customPatientSeparator))
  return `${template.groupListOpenText}${rows}${template.groupListCloseText}`
}

/** Every `ReportTemplate` field Tag Combo Grouping's renderer touches — a `Pick` rather than the
 * full type so both a saved `ReportTemplate` (App.tsx) and the editor's in-progress form draft
 * (`TemplateFormState`, which carries the same field names minus `id`/`sortOrder`/`createdAt`) can
 * call it directly. */
export type GroupRenderTemplate = Pick<
  ReportTemplate,
  | 'patternText' | 'variables' | 'patientSeparator' | 'customPatientSeparator'
  | 'groupSelectionMode' | 'groupTagIds' | 'groupCombineMode' | 'groupAutomaticLabels' | 'groupManualCombos'
  | 'groupLookbackHours' | 'groupListOpenText' | 'groupListCloseText' | 'groupShowListBracketsWhenEmpty'
  | 'groupPatternText' | 'groupVariables' | 'groupSeparator' | 'customGroupSeparator'
>

type GroupRenderCtx = {
  label: string
  patientsInGroup: Patient[]
  admitted: Patient[]
  referred: Patient[]
  discharged: Patient[]
  signedOut: Patient[]
  expired: Patient[]
}

const resolveGroupVariableInstance = (
  instance: GroupVariableInstance,
  groupCtx: GroupRenderCtx,
  template: GroupRenderTemplate,
  ctx: TemplateRenderContext,
): string => {
  if (instance.kind === 'flat') return resolveFlatVariable(instance.variableId, instance.dateTimeFormatId, PLACEHOLDER_PATIENT_FOR_PRINTS_ONCE, ctx)
  if (instance.kind === 'groupLabel') return groupCtx.label
  if (instance.kind === 'patientTally') return String(groupCtx.patientsInGroup.length)
  if (instance.kind === 'patientInfo') return renderGroupPatientList(groupCtx.patientsInGroup, template, ctx)
  const subset = groupCtx[instance.status]
  return instance.field === 'tally' ? String(subset.length) : renderGroupPatientList(subset, template, ctx)
}

const resolveGroupPatternPart = (
  part: PatternPart,
  variables: Record<string, GroupVariableInstance>,
  groupCtx: GroupRenderCtx,
  template: GroupRenderTemplate,
  ctx: TemplateRenderContext,
): ResolvedSegment => {
  if (part.type === 'text') return { kind: 'text', text: part.text }
  if (part.type === 'lineBreak') return { kind: 'lineBreak' }
  const instance = variables[part.id]
  if (!instance) return { kind: 'text', text: buildVariableToken(part.id) }
  const text = resolveGroupVariableInstance(instance, groupCtx, template, ctx)
  return { kind: 'value', text, blank: text.trim() === '' }
}

/** Same tokenize/resolve/collapse pipeline as `renderTemplateForPatient`, scoped to one output
 * group instead of one patient. */
const renderGroupPattern = (template: GroupRenderTemplate, groupCtx: GroupRenderCtx, ctx: TemplateRenderContext): string => {
  const parts = tokenizePatternText(template.groupPatternText)
  const resolved = parts.map((part) => resolveGroupPatternPart(part, template.groupVariables, groupCtx, template, ctx))
  return renderResolvedSegments(collapseBlanks(resolved))
}

/**
 * Renders Tag Combo Grouping's body: one evaluation of `groupPatternText` per output group (see
 * `buildOutputGroups`), scoped to `patientsForBody` — whichever patients the report was actually
 * run against, not every patient in the database. Each status subset requires the window check
 * plus a specific Automation Role, same detection Census Summary always used: New Admissions
 * requires "Relationship: Main" (Referred already requires "Relationship: Referral" internally, via
 * `matchesPatientPool` itself); Discharged/Signed Out/Expired share the same discharge-date-window
 * check but are told apart by which specific "Status: …" role the patient's terminal tag carries —
 * narrower than `matchesPatientPool`'s own "any terminal tag" check, which is deliberately kept
 * broad for its other callers (Patient Filter, Master Checklist). All five roles are load-bearing
 * — see `LOAD_BEARING_AUTOMATION_ROLES` — so Manage Tags blocks deleting whichever tag currently
 * fulfills one. Every group always renders, even one where every count comes up 0 — a tally field
 * is never blank so it reports 0 plainly; only the corresponding list field (and, if it sits alone
 * on its own line, that line — see `collapseBlanks`) disappears. A patient matching none of the
 * defined tag combos doesn't appear anywhere in the output (no "ungrouped" bucket).
 */
export const renderGroupedBody = (template: GroupRenderTemplate, patientsForBody: Patient[], ctx: TemplateRenderContext): string => {
  const groups = buildOutputGroups(template, ctx.tagsById)
  if (groups.length === 0) return ''

  const lines = groups.map((group) => {
    const patientsInGroup = patientsForBody.filter((patient) =>
      group.tagIds.every((tagId) => (patient.tagIds ?? []).includes(tagId)),
    )
    // Defensive fallback: a template persisted before this field existed (stale local dev
    // IndexedDB) would otherwise carry `undefined` here, producing an Invalid Date below and
    // crashing report generation entirely.
    const hours = Number.isFinite(template.groupLookbackHours) ? Math.max(0, template.groupLookbackHours) : 12
    const windowStart = new Date(ctx.nowDate.getTime() - hours * 3_600_000)
    const window: DateTimeWindow = {
      dateFrom: toLocalISODate(windowStart),
      timeFrom: toLocalTime(windowStart),
      dateTo: toLocalISODate(ctx.nowDate),
      timeTo: toLocalTime(ctx.nowDate),
    }
    const dischargedInWindow = patientsInGroup.filter((patient) => matchesPatientPool(patient, ['discharged'], window, ctx.poolContext))
    const groupCtx: GroupRenderCtx = {
      label: group.label,
      patientsInGroup,
      admitted: patientsInGroup.filter((patient) =>
        matchesPatientPool(patient, ['admitted'], window, ctx.poolContext) && patientHasAutomationRole(patient, ctx.tagsById, 'relationship-main'),
      ),
      referred: patientsInGroup.filter((patient) => matchesPatientPool(patient, ['referred'], window, ctx.poolContext)),
      discharged: dischargedInWindow.filter((patient) => patientHasAutomationRole(patient, ctx.tagsById, 'status-discharged')),
      signedOut: dischargedInWindow.filter((patient) => patientHasAutomationRole(patient, ctx.tagsById, 'status-signed-out')),
      expired: dischargedInWindow.filter((patient) => patientHasAutomationRole(patient, ctx.tagsById, 'status-expired')),
    }
    return renderGroupPattern(template, groupCtx, ctx)
  })
  return lines.join(resolveJoinString(template.groupSeparator, template.customGroupSeparator))
}

/** Medications ignores rangeMode/entryCount entirely (MedicationEntry has no date to filter by),
 * so its chip summary describes the status filter instead of the range-mode text every other
 * Block variable shows. */
const describeMedicationsConfig = (config: BlockVariableConfig): string => {
  const statuses = [
    config.includeActiveMedications && 'Active',
    config.includeDiscontinuedMedications && 'Discontinued',
    config.includeCompletedMedications && 'Completed',
  ].filter((label): label is string => Boolean(label))
  return statuses.length > 0 ? statuses.join(', ') : 'None selected'
}

export const describeBlockConfig = (config: BlockVariableConfig): string => {
  if (config.rangeMode === 'numberOfEntries') return `Last ${config.entryCount} entries`
  if (config.relativeMode === 'sinceAdmission') return 'Since Admission Date'
  if (config.relativeMode === 'lastNDays') return `Last ${config.lastNDays} days`
  const from = [config.fixedDateFrom, config.fixedTimeFrom].filter(Boolean).join(' ') || '…'
  const to = [config.fixedDateTo, config.fixedTimeTo].filter(Boolean).join(' ') || '…'
  return `${from} to ${to}`
}

export const describeTagsConfig = (config: TagsVariableConfig): string =>
  config.includeAll ? 'Tags (all)' : `Tags (${config.tagIds.length + config.groupIds.length} selected)`

export const FLAT_VARIABLE_LABELS: Record<FlatVariableId, string> = {
  roomNumber: 'Room Number',
  ward: 'Ward/Location',
  lastName: 'Surname',
  firstName: 'First Name',
  middleName: 'Middle Name',
  age: 'Age',
  sex: 'Sex',
  mainService: 'Main Service',
  referralService: 'Referral Service',
  admissionDiagnosis: 'Admission Diagnosis',
  dischargeDiagnosis: 'Discharge Diagnosis',
  clinicalSummary: 'Clinical Summary',
  admitDate: 'Admission Date',
  admitTime: 'Admission Time',
  referralDate: 'Referral Date',
  referralTime: 'Referral Time',
  dischargeDate: 'Date of Discharge',
  dischargeTime: 'Time of Discharge',
  database: 'Database',
  currentDate: 'Current Date',
  currentTime: 'Current Time',
}

export const BLOCK_VARIABLE_LABELS: Record<BlockVariableId, string> = {
  vitals: 'Vitals',
  labs: 'Labs',
  problems: 'Problems',
  checklist: 'Checklist',
  orders: 'Orders',
  medications: 'Medications',
}
