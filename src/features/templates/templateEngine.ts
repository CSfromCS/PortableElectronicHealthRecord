import { composeDiagnosisText } from '@/features/patients/serviceDiagnosis'
import { buildLabReportBlocks, formatOrderEntry, formatStructuredMedication } from '@/features/reporting/reportBuilders'
import { resolveServiceTagNames } from '@/features/tags/serviceTagUtils'
import { getAppliedPatientTags, orderTagsCanonically, renderTagDisplayText } from '@/features/tags/tagUtils'
import { formatClockCompact, formatDateMMDD, formatDateMMDDYYYY, getEffectiveAdmitDate, toLocalISODate } from '@/lib/dateTime'
import type {
  BlockVariableConfig,
  BlockVariableId,
  DailyUpdate,
  FlatVariableId,
  LabEntry,
  MedicationEntry,
  OrderEntry,
  Patient,
  ReportTemplate,
  TagDefinition,
  TagGroupDefinition,
  TagsVariableConfig,
  TemplateVariableInstance,
  VitalEntry,
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
 * (see photoMentions.tsx), just with its own delimiter so it can't collide with literal `@text`. */
const VARIABLE_TOKEN_REGEX = /\{\{var:([a-zA-Z0-9_-]+)\}\}/g

export const buildVariableToken = (id: string): string => `{{var:${id}}}`

export type PatternPart =
  | { type: 'text'; text: string }
  | { type: 'lineBreak' }
  | { type: 'variableRef'; id: string }

/** Splits raw `patternText` into an ordered list of literal-text runs, line breaks (each `\n`),
 * and variable references (by id, not yet resolved to a value or a display label) — the one parser
 * shared by both the render engine (id -> resolved value) and the editor (id -> chip label). */
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

export const DEFAULT_BLOCK_VARIABLE_CONFIG: BlockVariableConfig = {
  rangeMode: 'latest',
  entryCount: 3,
  relativeMode: 'lastNDays',
  fixedDateFrom: '',
  fixedDateTo: '',
  lastNDays: 7,
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
}

/** Current Date/Time are captured once at the start of report generation — every patient's line
 * in the same generated report shows the identical value, even across a multi-second generation. */
export const buildCurrentDateTimeText = (now = new Date()): { currentDateText: string; currentTimeText: string } => ({
  currentDateText: new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(now),
  currentTimeText: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now),
})

const resolveMedicationsText = (patient: Patient, entries: MedicationEntry[]): string => {
  const activeStructured = entries.filter((entry) => entry.status === 'active').map(formatStructuredMedication).filter(Boolean)
  return [patient.medications.trim(), ...activeStructured].filter(Boolean).join('\n')
}

const resolveFlatVariable = (variableId: FlatVariableId, patient: Patient, ctx: TemplateRenderContext): string => {
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
    case 'admitDate': return getEffectiveAdmitDate(patient.admitDate, patient.createdAt)
    case 'referralDate': return patient.referralDate
    case 'dischargeDate': return patient.dischargeDate ?? ''
    case 'medications': return resolveMedicationsText(patient, ctx.medicationsByPatient.get(patient.id ?? -1) ?? [])
    case 'database': return patient.database
    case 'currentDate': return ctx.currentDateText
    case 'currentTime': return ctx.currentTimeText
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
  return [...scoped]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)))
    .map((entry) => {
      const base = `${formatDateMMDD(entry.date)} ${formatClockCompact(entry.time)} ${entry.bp.trim()} ${entry.hr.trim()} ${entry.rr.trim()} ${entry.temp.trim()} ${entry.spo2.trim()}`
      return entry.note.trim() ? `${base} ${entry.note.trim()}` : base
    })
    .join('\n')
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
  return [...scoped]
    .sort((a, b) => (a.orderDate !== b.orderDate ? a.orderDate.localeCompare(b.orderDate) : a.orderTime.localeCompare(b.orderTime)))
    .map(formatOrderEntry)
    .join('\n')
}

/** Problems/Checklist have no per-entry time, only a per-date DailyUpdate row — each qualifying
 * row becomes its own dated block. "Latest" naturally captures the most recent SAVED row, which
 * (thanks to the app's existing carry-forward-on-load behavior) already reflects the current
 * unresolved state as of that date. */
const resolveProblemsBlock = (config: BlockVariableConfig, updates: DailyUpdate[], admitDateEffective: string): string => {
  const scoped = filterByRangeMode(updates, config, admitDateEffective, (e) => e.date, () => '', (e) => e.lastUpdated)
  return [...scoped]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((update) => {
      const problems = (update.problems ?? []).filter((problem) => problem.title.trim() || problem.notes.trim())
      if (problems.length === 0) return ''
      const lines = problems.flatMap((problem, index) => [
        `${index + 1}. ${problem.title.trim() || 'Untitled problem'}${problem.completed ? ' (resolved)' : ''}`,
        problem.notes.trim(),
      ].filter(Boolean))
      return [formatDateMMDDYYYY(update.date), ...lines].join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

const resolveChecklistBlock = (config: BlockVariableConfig, updates: DailyUpdate[], admitDateEffective: string): string => {
  const scoped = filterByRangeMode(updates, config, admitDateEffective, (e) => e.date, () => '', (e) => e.lastUpdated)
  return [...scoped]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((update) => {
      const items = (update.checklist ?? []).filter((item) => item.text.trim())
      if (items.length === 0) return ''
      const lines = items.map((item) => `- [${item.completed ? 'x' : ' '}] ${item.text.trim()}`)
      return [formatDateMMDDYYYY(update.date), ...lines].join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
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
    case 'problems': return resolveProblemsBlock(config, ctx.dailyUpdatesByPatient.get(patientId) ?? [], admitDateEffective)
    case 'checklist': return resolveChecklistBlock(config, ctx.dailyUpdatesByPatient.get(patientId) ?? [], admitDateEffective)
    default: return ''
  }
}

type ResolvedSegment =
  | { kind: 'text'; text: string }
  | { kind: 'lineBreak' }
  | { kind: 'value'; text: string; blank: boolean }

const resolveVariableInstance = (instance: TemplateVariableInstance, patient: Patient, ctx: TemplateRenderContext): string => {
  if (instance.kind === 'flat') return resolveFlatVariable(instance.variableId, patient, ctx)
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
