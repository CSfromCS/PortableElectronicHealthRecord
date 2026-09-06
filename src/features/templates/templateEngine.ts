import { type DateTimeWindow, type PatientPoolContext, matchesPatientPool } from '@/features/filters/patientFilterUtils'
import { composeDiagnosisText } from '@/features/patients/serviceDiagnosis'
import { buildLabReportBlockPieces, formatOrderStatus } from '@/features/reporting/reportBuilders'
import { resolveServiceTagNames } from '@/features/tags/serviceTagUtils'
import { bucketTagsByGroup, getAppliedPatientTags, orderTagsCanonically, renderTagDisplayText } from '@/features/tags/tagUtils'
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
  BlockJoinMode,
  BlockVariableConfig,
  BlockVariableId,
  CensusSummaryConfig,
  ChecklistEntryFieldId,
  DailyUpdate,
  DateTimeComponentId,
  DateTimeFormatDefinition,
  FlatVariableId,
  LabEntry,
  MedicationEntry,
  MedicationsEntryFieldId,
  OrderEntry,
  OrdersEntryFieldId,
  Patient,
  ProblemBlock,
  ProblemsEntryFieldId,
  ReportTemplate,
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
 * around that one blank variable collapses; the rest of the line is unaffected. */
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
export const CHECKLIST_ENTRY_FIELD_ORDER: ChecklistEntryFieldId[] = ['checkbox', 'itemText']
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
    checkbox: 'Checkbox', itemText: 'Item Text',
  },
  medications: {
    medication: 'Medication', dose: 'Dose', route: 'Route', frequency: 'Frequency', note: 'Note', statusMarker: 'Status Marker',
  },
  labs: {},
}

/** Census Summary's own entry-level fields — one line per tag in the chosen Tag Group, used only
 * inside that variable's own `entryPatternText`/`entryFieldIds`. Each `*Phrase` field bakes its
 * count, pluralized unit word, and (when non-zero) a parenthetical name list all into one value —
 * e.g. "0 new admissions" or "1 new admission (MARIA)" — rather than splitting count and names
 * into separate chips. That's deliberate: the blank-collapse rule every other pattern uses to drop
 * an empty parenthetical would, here, also eat the fixed ", " separators between phrases whenever
 * one phrase's name list happened to be blank — collapsing "0 new admissions, 2 new referrals" down
 * to "0 new admissions2 new referrals". Keeping the whole phrase as a single, never-blank value
 * sidesteps that entirely. */
export type CensusSummaryEntryFieldId = 'groupLabel' | 'admittedPhrase' | 'referredPhrase' | 'dischargedPhrase'

export const CENSUS_SUMMARY_ENTRY_FIELD_ORDER: CensusSummaryEntryFieldId[] = [
  'groupLabel', 'admittedPhrase', 'referredPhrase', 'dischargedPhrase',
]

export const CENSUS_SUMMARY_ENTRY_FIELD_LABELS: Record<CensusSummaryEntryFieldId, string> = {
  groupLabel: 'Group Label',
  admittedPhrase: 'New Admissions',
  referredPhrase: 'New Referrals',
  dischargedPhrase: 'Discharged',
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
  item: { text: string; completed: boolean },
  config: BlockVariableConfig,
): string => {
  switch (fieldId as ChecklistEntryFieldId) {
    case 'checkbox': return item.completed ? config.checkedGlyph : config.uncheckedGlyph
    case 'itemText': return item.text.trim()
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
  includeActiveMedications: true,
  includeDiscontinuedMedications: false,
  includeCompletedMedications: false,
  includeMedicationNotes: true,
  medicationNotesPosition: 'before',
  labsDateDisplayMode: 'perEntry',
})

/** Defaults to the "Category" Tag Group when one exists (matching this app's own default CD/PD
 * tags), else the first available group — the user can always change it. 12-hour lookback matches
 * the Patient Filter's own default window for the same Admitted/Referred/Discharged criteria. */
export const buildDefaultCensusSummaryConfig = (groups: TagGroupDefinition[]): CensusSummaryConfig => {
  const defaultGroup = groups.find((group) => group.name.trim().toLowerCase() === 'category') ?? groups[0]
  const entryFieldIds: Record<string, string> = {}
  const token = (fieldId: CensusSummaryEntryFieldId): string => {
    const id = createVariableId()
    entryFieldIds[id] = fieldId
    return buildVariableToken(id)
  }
  const entryPatternText = `${token('groupLabel')}: ${token('admittedPhrase')}, ${token('referredPhrase')}, ${token('dischargedPhrase')}`
  return {
    tagGroupId: defaultGroup?.id ?? null,
    lookbackHours: 12,
    entryPatternText,
    entryFieldIds,
    entrySeparator: 'blankLine',
    customEntrySeparator: '',
  }
}

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
      if (problems.length === 0) return ''
      const body = problems
        .map((problem, index) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, config.entryFieldDateTimeFormats, (fieldId) => resolveProblemsEntryField(fieldId, problem, index, config)))
        .join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
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

const pluralize = (count: number, singular: string, plural: string): string => (count === 1 ? singular : plural)

/** "0 new admissions" / "1 new admission (MARIA)" / "2 new admissions (SANTOS, MARIMAR)" — count,
 * pluralized unit, and (only when non-zero) a parenthetical name list, all as one value. */
const buildCensusPhrase = (count: number, singular: string, plural: string, patients: Patient[]): string => {
  const summary = `${count} ${pluralize(count, singular, plural)}`
  const names = patients.map((patient) => patient.lastName).filter(Boolean).join(', ')
  return names ? `${summary} (${names})` : summary
}

const resolveCensusSummaryEntryField = (
  fieldId: string,
  group: { label: string; admitted: Patient[]; referred: Patient[]; discharged: Patient[] },
): string => {
  switch (fieldId as CensusSummaryEntryFieldId) {
    case 'groupLabel': return group.label
    case 'admittedPhrase': return buildCensusPhrase(group.admitted.length, 'new admission', 'new admissions', group.admitted)
    case 'referredPhrase': return buildCensusPhrase(group.referred.length, 'new referral', 'new referrals', group.referred)
    case 'dischargedPhrase': return buildCensusPhrase(group.discharged.length, 'discharged', 'discharged', group.discharged)
    default: return ''
  }
}

/** One line per tag in the configured Tag Group — each line covers every patient currently
 * carrying that tag, classified by whether they were newly admitted/referred/discharged within
 * the lookback window (reusing the exact same detection as the Patient Filter's Special/Timebound
 * facet, via `matchesPatientPool`). Not a per-patient value — scans `ctx.allPatients` directly. */
const resolveCensusSummary = (config: CensusSummaryConfig, ctx: TemplateRenderContext): string => {
  if (config.tagGroupId === null) return ''
  const bucket = bucketTagsByGroup([...ctx.tagsById.values()], ctx.tagGroups).find((candidate) => candidate.groupId === config.tagGroupId)
  if (!bucket) return ''

  const windowStart = new Date(ctx.nowDate.getTime() - Math.max(0, config.lookbackHours) * 3_600_000)
  const window: DateTimeWindow = {
    dateFrom: toLocalISODate(windowStart),
    timeFrom: toLocalTime(windowStart),
    dateTo: toLocalISODate(ctx.nowDate),
    timeTo: toLocalTime(ctx.nowDate),
  }

  const lines = bucket.tags.map((tag) => {
    if (tag.id === undefined) return ''
    const tagId = tag.id
    const patientsWithTag = ctx.allPatients.filter((patient) => (patient.tagIds ?? []).includes(tagId))
    const group = {
      label: tag.name,
      admitted: patientsWithTag.filter((patient) => matchesPatientPool(patient, ['admitted'], window, ctx.poolContext)),
      referred: patientsWithTag.filter((patient) => matchesPatientPool(patient, ['referred'], window, ctx.poolContext)),
      discharged: patientsWithTag.filter((patient) => matchesPatientPool(patient, ['discharged'], window, ctx.poolContext)),
    }
    return renderEntryPattern(config.entryPatternText, config.entryFieldIds, {}, (fieldId) => resolveCensusSummaryEntryField(fieldId, group))
  })
  return lines.join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
}

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
  if (instance.kind === 'censusSummary') return resolveCensusSummary(instance.config, ctx)
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
  // Census Summary is a whole-run aggregate (scans every patient, not "the" patient), same as
  // Current Date/Time — it never makes a template Per-Patient on its own.
  if (instance.kind === 'censusSummary') return false
  return PATIENT_DEPENDENT_FLAT_VARIABLES.has(instance.variableId)
}

/**
 * Point 2 (Template Repeat Mode) of issue #82, simplified for this PR: Template variables (and
 * therefore their per-patient/multi-patient distinction) are deferred to a follow-up, so this
 * reduced rule only asks "does the Format Pattern contain any variable that depends on a specific
 * patient" — any patient-data Flat variable, any Block variable, or a Tags variable. A template
 * with only literal text and/or Current Date/Current Time is Prints Once. Re-evaluate this
 * whenever the Format Pattern changes; never set it manually.
 */
export const classifyTemplateRepeatMode = (template: Pick<ReportTemplate, 'patternText' | 'variables'>): TemplateRepeatMode => {
  const usedIds = new Set<string>()
  for (const match of template.patternText.matchAll(VARIABLE_TOKEN_REGEX)) usedIds.add(match[1])

  const hasPatientDependentVariable = [...usedIds].some((id) => {
    const instance = template.variables[id]
    return instance !== undefined && isPatientDependentInstance(instance)
  })
  return hasPatientDependentVariable ? 'per-patient' : 'prints-once'
}

/** Human-readable label for a variable chip/summary — used by the editor and the variable picker. */
export const describeVariableInstance = (instance: TemplateVariableInstance, groups: TagGroupDefinition[] = []): string => {
  if (instance.kind === 'flat') return FLAT_VARIABLE_LABELS[instance.variableId]
  if (instance.kind === 'block') {
    const detail = instance.variableId === 'medications' ? describeMedicationsConfig(instance.config) : describeBlockConfig(instance.config)
    return `${BLOCK_VARIABLE_LABELS[instance.variableId]} — ${detail}`
  }
  if (instance.kind === 'censusSummary') {
    const groupName = groups.find((group) => group.id === instance.config.tagGroupId)?.name ?? '…'
    return `Census Summary — ${groupName}, last ${instance.config.lookbackHours}h`
  }
  return describeTagsConfig(instance.config)
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
