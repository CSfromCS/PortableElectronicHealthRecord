import { composeDiagnosisText } from '@/features/patients/serviceDiagnosis'
import { buildLabReportBlocks, formatOrderStatus, formatStructuredMedication } from '@/features/reporting/reportBuilders'
import { resolveServiceTagNames } from '@/features/tags/serviceTagUtils'
import { getAppliedPatientTags, orderTagsCanonically, renderTagDisplayText } from '@/features/tags/tagUtils'
import { formatClockCompact, formatDateMMDD, formatDateMMDDYYYY, getEffectiveAdmitDate, toLocalISODate } from '@/lib/dateTime'
import type {
  BlockJoinMode,
  BlockVariableConfig,
  BlockVariableId,
  ChecklistEntryFieldId,
  DailyUpdate,
  DateTimeComponentId,
  DateTimeFormatDefinition,
  FlatVariableId,
  LabEntry,
  MedicationEntry,
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

export const ENTRY_FIELD_ORDER_BY_BLOCK: Record<BlockVariableId, string[]> = {
  vitals: VITALS_ENTRY_FIELD_ORDER,
  orders: ORDERS_ENTRY_FIELD_ORDER,
  problems: PROBLEMS_ENTRY_FIELD_ORDER,
  checklist: CHECKLIST_ENTRY_FIELD_ORDER,
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
  labs: {},
}

const resolveVitalsEntryField = (fieldId: string, entry: VitalEntry): string => {
  switch (fieldId as VitalsEntryFieldId) {
    case 'entryDate': return formatDateMMDD(entry.date)
    case 'entryTime': return formatClockCompact(entry.time)
    case 'bp': return entry.bp.trim()
    case 'hr': return entry.hr.trim()
    case 'rr': return entry.rr.trim()
    case 'temp': return entry.temp.trim()
    case 'spo2': return entry.spo2.trim()
    case 'note': return entry.note.trim()
    default: return ''
  }
}

const resolveOrdersEntryField = (fieldId: string, entry: OrderEntry): string => {
  switch (fieldId as OrdersEntryFieldId) {
    case 'entryDate': return entry.orderDate ?? ''
    case 'entryTime': return entry.orderTime ?? ''
    case 'service': return (entry.service ?? '').trim()
    case 'orderText': return entry.orderText
    case 'status': return formatOrderStatus(entry.status)
    case 'note': return entry.note ?? ''
    default: return ''
  }
}

const resolveProblemsEntryField = (fieldId: string, problem: ProblemBlock, index: number): string => {
  switch (fieldId as ProblemsEntryFieldId) {
    case 'problemIndex': return String(index + 1)
    case 'problemTitle': return problem.title.trim() || 'Untitled problem'
    case 'problemNotes': return problem.notes.trim()
    case 'resolvedMarker': return problem.completed ? ' (resolved)' : ''
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

/** Renders one entry (or Checklist/Problems item) through its Block variable's own
 * `entryPatternText`, reusing the exact same tokenize/resolve/collapse pipeline as the top-level
 * Format Pattern — just against `resolveField` instead of a `TemplateVariableInstance` map. Trims
 * trailing blank lines so an entry whose last field resolves blank (e.g. a Problem with no notes)
 * doesn't leave a dangling empty line before the next entry's separator. */
const renderEntryPattern = (
  patternText: string,
  entryFieldIds: Record<string, string>,
  resolveField: (fieldId: string) => string,
): string => {
  const parts = tokenizePatternText(patternText)
  const resolved: ResolvedSegment[] = parts.map((part) => {
    if (part.type === 'text') return { kind: 'text', text: part.text }
    if (part.type === 'lineBreak') return { kind: 'lineBreak' }
    const fieldId = entryFieldIds[part.id]
    if (!fieldId) return { kind: 'text', text: buildVariableToken(part.id) }
    const text = resolveField(fieldId)
    return { kind: 'value', text, blank: text.trim() === '' }
  })
  return renderResolvedSegments(collapseBlanks(resolved)).replace(/\n+$/, '')
}

const renderGroupHeader = (dateISO: string, config: BlockVariableConfig, ctx: TemplateRenderContext): string =>
  renderSavedFormatOr(config.groupHeaderDateFormatId, ctx, dateISO, undefined, () => formatDateMMDDYYYY(dateISO))

/** Default range-mode settings for a freshly-inserted Block variable, independent of which record
 * type it is — entry-pattern defaults (which DO depend on the record type) live in
 * `buildDefaultBlockVariableConfig` below. */
export const DEFAULT_BLOCK_VARIABLE_CONFIG: Pick<
  BlockVariableConfig, 'rangeMode' | 'entryCount' | 'relativeMode' | 'fixedDateFrom' | 'fixedDateTo' | 'lastNDays'
> = {
  rangeMode: 'latest',
  entryCount: 3,
  relativeMode: 'lastNDays',
  fixedDateFrom: '',
  fixedDateTo: '',
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
    default:
      return { entryFieldIds: {}, entryPatternText: '' }
  }
}

export const buildDefaultBlockVariableConfig = (variableId: BlockVariableId): BlockVariableConfig => ({
  ...DEFAULT_BLOCK_VARIABLE_CONFIG,
  ...buildDefaultEntryPattern(variableId),
  entrySeparator: 'lineBreak',
  customEntrySeparator: '',
  showGroupHeader: true,
  groupHeaderDateFormatId: undefined,
  groupSeparator: 'blankLine',
  customGroupSeparator: '',
  checkedGlyph: 'x',
  uncheckedGlyph: ' ',
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
}

/** Current Date/Time are captured once at the start of report generation — every patient's line
 * in the same generated report shows the identical value, even across a multi-second generation. */
export const buildCurrentDateTimeText = (now = new Date()): { currentDateText: string; currentTimeText: string; nowDate: Date } => ({
  currentDateText: new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(now),
  currentTimeText: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now),
  nowDate: now,
})

const resolveMedicationsText = (patient: Patient, entries: MedicationEntry[]): string => {
  const activeStructured = entries.filter((entry) => entry.status === 'active').map(formatStructuredMedication).filter(Boolean)
  return [patient.medications.trim(), ...activeStructured].filter(Boolean).join('\n')
}

/** Flat variable ids for which a `dateTimeFormatId` on the instance is meaningful. */
export const DATE_TIME_CAPABLE_FLAT_VARIABLE_IDS = new Set<FlatVariableId>([
  'admitDate', 'referralDate', 'dischargeDate', 'currentDate', 'currentTime',
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
    case 'admissionDiagnosis': return composeDiagnosisText(patient, patient.admissionDiagnosisUnassigned, patient.admissionDiagnosisByService, ctx.tagsById)
    case 'dischargeDiagnosis': return composeDiagnosisText(patient, patient.dischargeDiagnosisUnassigned, patient.dischargeDiagnosisByService, ctx.tagsById)
    case 'clinicalSummary': return patient.clinicalSummary
    case 'admitDate': {
      const iso = getEffectiveAdmitDate(patient.admitDate, patient.createdAt)
      return iso ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, undefined, () => formatDateMMDDYYYY(iso)) : ''
    }
    case 'referralDate': {
      const iso = patient.referralDate
      return iso ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, undefined, () => formatDateMMDDYYYY(iso)) : ''
    }
    case 'dischargeDate': {
      const iso = patient.dischargeDate
      return iso ? renderSavedFormatOr(dateTimeFormatId, ctx, iso, undefined, () => formatDateMMDDYYYY(iso)) : ''
    }
    case 'medications': return resolveMedicationsText(patient, ctx.medicationsByPatient.get(patient.id ?? -1) ?? [])
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

const resolveDateRangeBounds = (config: BlockVariableConfig, admitDateEffective: string): { dateFrom: string; dateTo: string } => {
  const today = toLocalISODate()
  if (config.relativeMode === 'fixed') return { dateFrom: config.fixedDateFrom || today, dateTo: config.fixedDateTo || today }
  if (config.relativeMode === 'sinceAdmission') return { dateFrom: admitDateEffective, dateTo: today }
  const from = new Date()
  from.setDate(from.getDate() - Math.max(0, config.lastNDays))
  return { dateFrom: toLocalISODate(from), dateTo: today }
}

/** Selects which raw entries a Block variable placeholder includes, per its saved rangeMode —
 * accessor-based so callers with differently-named date/time fields (OrderEntry's
 * orderDate/orderTime, DailyUpdate's date-only) don't need to reshape their data first. */
const filterByRangeMode = <T,>(
  entries: T[],
  config: BlockVariableConfig,
  admitDateEffective: string,
  getDate: (entry: T) => string,
  getTime: (entry: T) => string,
  getCreatedAt: (entry: T) => string,
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

  if (config.rangeMode === 'latest') return sorted.slice(0, 1)
  if (config.rangeMode === 'numberOfEntries') return sorted.slice(0, Math.max(1, config.entryCount))

  const { dateFrom, dateTo } = resolveDateRangeBounds(config, admitDateEffective)
  return sorted.filter((entry) => {
    const date = getDate(entry)
    return date >= dateFrom && date <= dateTo
  })
}

const resolveVitalsBlock = (config: BlockVariableConfig, entries: VitalEntry[], admitDateEffective: string): string => {
  const scoped = filterByRangeMode(entries, config, admitDateEffective, (e) => e.date, (e) => e.time, (e) => e.createdAt)
  const lines = [...scoped]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)))
    .map((entry) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, (fieldId) => resolveVitalsEntryField(fieldId, entry)))
  return lines.join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
}

const resolveLabsBlock = (config: BlockVariableConfig, entries: LabEntry[], admitDateEffective: string): string => {
  // Number of Entries / Date Range apply PER lab template independently, so "2" reliably lands 2
  // entries of the SAME template — which is what buildLabReportBlocks' comparison mode needs —
  // rather than the 2 most recent entries overall regardless of test type.
  const byTemplate = new Map<string, LabEntry[]>()
  entries.forEach((entry) => {
    const list = byTemplate.get(entry.templateId) ?? []
    list.push(entry)
    byTemplate.set(entry.templateId, list)
  })
  const scoped: LabEntry[] = []
  byTemplate.forEach((group) => {
    scoped.push(...filterByRangeMode(group, config, admitDateEffective, (e) => e.date, (e) => e.time ?? '', (e) => e.createdAt))
  })
  return buildLabReportBlocks(scoped).join('\n\n')
}

const resolveOrdersBlock = (config: BlockVariableConfig, entries: OrderEntry[], admitDateEffective: string): string => {
  const scoped = filterByRangeMode(entries, config, admitDateEffective, (e) => e.orderDate, (e) => e.orderTime ?? '', (e) => e.createdAt)
  const lines = [...scoped]
    .sort((a, b) => (a.orderDate !== b.orderDate ? a.orderDate.localeCompare(b.orderDate) : a.orderTime.localeCompare(b.orderTime)))
    .map((entry) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, (fieldId) => resolveOrdersEntryField(fieldId, entry)))
  return lines.join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
}

/** Problems/Checklist have no per-entry time, only a per-date DailyUpdate row — each qualifying
 * row becomes its own dated group. "Latest" naturally captures the most recent SAVED row, which
 * (thanks to the app's existing carry-forward-on-load behavior) already reflects the current
 * unresolved state as of that date. */
const resolveProblemsBlock = (config: BlockVariableConfig, updates: DailyUpdate[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  const scoped = filterByRangeMode(updates, config, admitDateEffective, (e) => e.date, () => '', (e) => e.lastUpdated)
  const groupTexts = [...scoped]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((update) => {
      const problems = (update.problems ?? []).filter((problem) => problem.title.trim() || problem.notes.trim())
      if (problems.length === 0) return ''
      const body = problems
        .map((problem, index) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, (fieldId) => resolveProblemsEntryField(fieldId, problem, index)))
        .join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
      if (!config.showGroupHeader) return body
      return [renderGroupHeader(update.date, config, ctx), body].join('\n')
    })
    .filter(Boolean)
  return groupTexts.join(resolveJoinString(config.groupSeparator, config.customGroupSeparator))
}

const resolveChecklistBlock = (config: BlockVariableConfig, updates: DailyUpdate[], admitDateEffective: string, ctx: TemplateRenderContext): string => {
  const scoped = filterByRangeMode(updates, config, admitDateEffective, (e) => e.date, () => '', (e) => e.lastUpdated)
  const groupTexts = [...scoped]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((update) => {
      const items = (update.checklist ?? []).filter((item) => item.text.trim())
      if (items.length === 0) return ''
      const body = items
        .map((item) => renderEntryPattern(config.entryPatternText, config.entryFieldIds, (fieldId) => resolveChecklistEntryField(fieldId, item, config)))
        .join(resolveJoinString(config.entrySeparator, config.customEntrySeparator))
      if (!config.showGroupHeader) return body
      return [renderGroupHeader(update.date, config, ctx), body].join('\n')
    })
    .filter(Boolean)
  return groupTexts.join(resolveJoinString(config.groupSeparator, config.customGroupSeparator))
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
    case 'vitals': return resolveVitalsBlock(config, ctx.vitalsByPatient.get(patientId) ?? [], admitDateEffective)
    case 'labs': return resolveLabsBlock(config, ctx.labsByPatient.get(patientId) ?? [], admitDateEffective)
    case 'orders': return resolveOrdersBlock(config, ctx.ordersByPatient.get(patientId) ?? [], admitDateEffective)
    case 'problems': return resolveProblemsBlock(config, ctx.dailyUpdatesByPatient.get(patientId) ?? [], admitDateEffective, ctx)
    case 'checklist': return resolveChecklistBlock(config, ctx.dailyUpdatesByPatient.get(patientId) ?? [], admitDateEffective, ctx)
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

export const renderTemplateForPatient = (template: ReportTemplate, patient: Patient, ctx: TemplateRenderContext): string => {
  const parts = tokenizePatternText(template.patternText)
  const resolved = parts.map((part) => resolvePatternPart(part, template.variables, patient, ctx))
  return renderResolvedSegments(collapseBlanks(resolved))
}

/** Flat variables that read patient data — everything except the two non-patient special
 * variables (Current Date/Time), which don't make a template Per-Patient on their own. */
const PATIENT_DEPENDENT_FLAT_VARIABLES = new Set<FlatVariableId>([
  'roomNumber', 'ward', 'lastName', 'firstName', 'middleName', 'age', 'sex',
  'mainService', 'admissionDiagnosis', 'dischargeDiagnosis', 'clinicalSummary',
  'admitDate', 'referralDate', 'dischargeDate', 'medications', 'database',
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
 * whenever the Format Pattern changes; never set it manually.
 */
export const classifyTemplateRepeatMode = (template: ReportTemplate): TemplateRepeatMode => {
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
  if (instance.kind === 'block') return `${BLOCK_VARIABLE_LABELS[instance.variableId]} — ${describeBlockConfig(instance.config)}`
  return describeTagsConfig(instance.config)
}

export const describeBlockConfig = (config: BlockVariableConfig): string => {
  if (config.rangeMode === 'latest') return 'Latest'
  if (config.rangeMode === 'numberOfEntries') return `Last ${config.entryCount} entries`
  if (config.relativeMode === 'sinceAdmission') return 'Since Admission Date'
  if (config.relativeMode === 'lastNDays') return `Last ${config.lastNDays} days`
  return `${config.fixedDateFrom || '…'} to ${config.fixedDateTo || '…'}`
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
  admissionDiagnosis: 'Admission Diagnosis',
  dischargeDiagnosis: 'Discharge Diagnosis',
  clinicalSummary: 'Clinical Summary',
  admitDate: 'Admission Date',
  referralDate: 'Referral Date',
  dischargeDate: 'Date of Discharge',
  medications: 'Medications',
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
}
