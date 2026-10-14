import { buildMasterChecklistItems, buildMasterChecklistItemsForSource } from '@/features/checklist/masterChecklist'
import {
  type DateTimeWindow,
  type PatientPoolCriterion,
  type TagWardFilterState,
  computeDefaultWindowLookback,
  matchesPatientPool,
  matchesTagWardFilter,
  patientPoolCriteriaNeedWindow,
} from '@/features/filters/patientFilterUtils'
import { DEFAULT_PATIENT_SORT_CONFIG, type PatientSortConfig, sortPatientsByConfig } from '@/features/patients/patientSort'
import { buildTemplateRenderContext, generateTemplateOutput } from '@/features/reporting/templateReport'
import { WARD_TAG_GROUP_NAME } from '@/features/tags/tagConstants'
import { isPatientActive } from '@/features/tags/tagUtils'
import { buildSamplePreviewContext, buildSamplePreviewPatient } from '@/features/templates/samplePreviewData'
import {
  classifyTemplateRepeatMode,
  describeGroupVariableInstance,
  describeVariableInstance,
  tokenizePatternText,
} from '@/features/templates/templateEngine'
import { toLocalISODate, toLocalTime } from '@/lib/dateTime'
import { formatFullName, joinNonBlank } from '@/lib/patientIdentity'
import type { CustomView, Patient, ReportTemplate, TagDefinition } from '@/types'
import type { World } from './world'

/** A problem with the request that the caller can fix — shown to Medmin as the tool's answer, so
 * the message says exactly what to ask the user. */
export class ToolError extends Error {}

const lower = (value: string): string => value.trim().toLowerCase()
const withoutSyncFields = <T extends object>(record: T): Omit<T, 'uid' | 'updatedAt'> => {
  const { uid: _uid, updatedAt: _updatedAt, ...rest } = record as T & { uid?: unknown; updatedAt?: unknown }
  void _uid
  void _updatedAt
  return rest
}

// --- Tags ----------------------------------------------------------------------------------------

const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

const initialsOf = (value: string): string =>
  value.split(/[^a-z0-9]+/i).filter(Boolean).map((word) => word[0]).join('').toLowerCase()

/** Existing tags that plausibly mean `name`: one contains the other, one is the other's initials
 * (MICU / Medical ICU), or they're a typo apart. Used to offer choices, never to pick silently. */
export const suggestTags = (name: string, tags: TagDefinition[]): TagDefinition[] => {
  const wanted = lower(name)
  return tags.filter((tag) => {
    const candidate = lower(tag.name)
    return candidate.includes(wanted)
      || wanted.includes(candidate)
      || initialsOf(tag.name) === wanted.replace(/[^a-z0-9]/g, '')
      || initialsOf(name) === candidate.replace(/[^a-z0-9]/g, '')
      || editDistance(candidate, wanted) <= Math.max(1, Math.floor(wanted.length / 4))
  })
}

const tagLabel = (tag: TagDefinition, world: World): string => {
  const group = world.tagGroups.find((candidate) => candidate.id === tag.groupId)
  return group ? `${tag.name} (${group.name})` : tag.name
}

/** Resolves a tag by its exact name, ignoring case. Anything less exact is an error that lists the
 * closest existing tags, so the user decides which one is meant (or whether to make a new one). */
export const resolveTag = (name: string, world: World, groupName?: string): TagDefinition => {
  const pool = [...world.tagsById.values()].filter((tag) => {
    if (!groupName) return true
    return world.tagGroups.find((group) => group.id === tag.groupId)?.name === groupName
  })
  const exact = pool.filter((tag) => lower(tag.name) === lower(name))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    throw new ToolError(`More than one tag is named "${name}": ${exact.map((tag) => tagLabel(tag, world)).join('; ')}. Ask which one is meant.`)
  }
  const close = suggestTags(name, pool)
  const kind = groupName ? `${groupName.toLowerCase()} tag` : 'tag'
  throw new ToolError(close.length > 0
    ? `No ${kind} is named exactly "${name}". Closest existing: ${close.map((tag) => tagLabel(tag, world)).join('; ')}. Ask the user which one they mean.`
    : `No ${kind} named "${name}" exists. Existing ${kind}s: ${pool.map((tag) => tag.name).join(', ') || '(none)'}. Ask the user which one they mean.`)
}

const tagNames = (ids: number[] | undefined, world: World): string[] =>
  (ids ?? []).map((id) => world.tagsById.get(id)?.name ?? `#${id}`)

export const listTags = (world: World) => world.tagGroups
  .slice()
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((group) => ({
    group: group.name,
    enabled: !group.disabled,
    tags: [...world.tagsById.values()]
      .filter((tag) => tag.groupId === group.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        terminal: Boolean(tag.terminal),
        patientsWithTag: world.patients.filter((patient) => (patient.tagIds ?? []).includes(tag.id as number)
          || (patient.mainServiceTagIds ?? []).includes(tag.id as number)
          || (patient.referralServiceTagIds ?? []).includes(tag.id as number)
          || patient.wardTagId === tag.id).length,
      })),
  }))

// --- Patients ------------------------------------------------------------------------------------

export const patientIdentifier = (patient: Patient): string =>
  joinNonBlank([patient.roomNumber, formatFullName(patient).toUpperCase()], ' — ')

const wardNameOf = (patient: Patient, world: World): string =>
  (patient.wardTagId !== undefined ? world.tagsById.get(patient.wardTagId)?.name : undefined) ?? ''

export const summarizePatient = (patient: Patient, world: World) => {
  const terminalTags = [...(patient.tagIds ?? [])].map((id) => world.tagsById.get(id)).filter((tag): tag is TagDefinition => tag?.terminal === true)
  return {
    patientId: patient.id,
    identifier: patientIdentifier(patient),
    room: patient.roomNumber,
    ward: wardNameOf(patient, world),
    name: formatFullName(patient),
    age: patient.age ?? null,
    sex: patient.sex,
    status: isPatientActive(patient, world.tagsById) ? 'active' : terminalTags.map((tag) => tag.name).join(', '),
    mainServices: tagNames(patient.mainServiceTagIds, world),
    referralServices: tagNames(patient.referralServiceTagIds, world),
    tags: tagNames(patient.tagIds, world),
  }
}

/** Finds a patient the way a person would say it. A match on more than one patient is an error
 * that lists them, so a caller can never act on "the wrong Cruz". */
export const resolvePatient = (world: World, ref: { patientId?: number; room?: string; lastName?: string; query?: string }): Patient => {
  if (ref.patientId !== undefined) {
    const found = world.patientsById.get(ref.patientId)
    if (!found) throw new ToolError(`No patient has id ${ref.patientId}.`)
    return found
  }

  const room = ref.room ? lower(ref.room) : ''
  const lastName = ref.lastName ? lower(ref.lastName) : ''
  const query = ref.query ? lower(ref.query) : ''
  if (!room && !lastName && !query) throw new ToolError('Say which patient: a patientId, or room and last name.')

  const matches = world.patients.filter((patient) => {
    const haystack = lower(`${patient.roomNumber} ${patient.lastName} ${patient.firstName} ${patient.middleName ?? ''} ${wardNameOf(patient, world)}`)
    if (query) return query.split(/\s+/).every((word) => haystack.includes(word))
    return (!room || lower(patient.roomNumber) === room) && (!lastName || lower(patient.lastName) === lastName)
  })
  const candidates = matches.some((patient) => isPatientActive(patient, world.tagsById))
    ? matches.filter((patient) => isPatientActive(patient, world.tagsById))
    : matches

  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) {
    throw new ToolError(`No patient matches ${[room && `room ${ref.room}`, lastName && `last name ${ref.lastName}`, query && `"${ref.query}"`].filter(Boolean).join(', ')}.`)
  }
  throw new ToolError(`More than one patient matches: ${candidates.map((patient) => `${patientIdentifier(patient)} (id ${patient.id})`).join('; ')}. Ask which one is meant.`)
}

export const findPatients = (world: World, query: string) => {
  const words = lower(query).split(/\s+/).filter(Boolean)
  return world.patients
    .filter((patient) => {
      const haystack = lower(`${patient.roomNumber} ${patient.lastName} ${patient.firstName} ${patient.middleName ?? ''} ${wardNameOf(patient, world)}`)
      return words.every((word) => haystack.includes(word))
    })
    .map((patient) => summarizePatient(patient, world))
}

// --- Selecting patients (the Patients list / Reports filter, sort and saved views) ----------------

export type PatientSelection = {
  /** An explicit list, in the order given — like ticking patients by hand in Reports. */
  patientIds?: number[]
  pool?: Array<PatientPoolCriterion | 'all'>
  /** Hours looked back for the admitted / discharged / referred pools. */
  windowHours?: number
  tags?: string[]
  tagMode?: 'AND' | 'OR'
  wards?: string[]
  view?: string
  sort?: Array<{ field: 'ward' | 'room' | 'name' | 'admitDate' | 'tagOrder'; direction?: 'asc' | 'desc'; tags?: string[] }>
}

const resolveView = (name: string, world: World): CustomView => {
  const exact = world.views.filter((view) => lower(view.name) === lower(name))
  if (exact.length >= 1) return exact[0]
  const close = world.views.filter((view) => lower(view.name).includes(lower(name)) || lower(name).includes(lower(view.name)))
  throw new ToolError(close.length > 0
    ? `No saved view is named exactly "${name}". Closest: ${close.map((view) => view.name).join('; ')}.`
    : `No saved view named "${name}". Saved views: ${world.views.map((view) => view.name).join(', ') || '(none)'}.`)
}

const resolveSort = (selection: PatientSelection, view: CustomView | null, world: World): PatientSortConfig => {
  if (selection.sort && selection.sort.length > 0) {
    return {
      levels: selection.sort.map((level, index) => {
        const direction = level.direction ?? 'asc'
        const id = `mcp-sort-${index}`
        if (level.field === 'tagOrder') {
          return { id, field: 'tagOrder' as const, direction, tagIds: (level.tags ?? []).map((name) => resolveTag(name, world).id as number) }
        }
        return { id, field: level.field, direction }
      }),
    }
  }
  return view?.sortConfig ?? DEFAULT_PATIENT_SORT_CONFIG
}

export const selectPatients = (world: World, selection: PatientSelection = {}): { patients: Patient[]; sort: PatientSortConfig } => {
  if (selection.patientIds && selection.patientIds.length > 0) {
    return {
      patients: selection.patientIds.map((id) => {
        const found = world.patientsById.get(id)
        if (!found) throw new ToolError(`No patient has id ${id}.`)
        return found
      }),
      sort: DEFAULT_PATIENT_SORT_CONFIG,
    }
  }

  if (selection.view && (selection.tags?.length || selection.wards?.length)) {
    throw new ToolError('Use either a saved view or tags/wards, not both.')
  }
  const view = selection.view ? resolveView(selection.view, world) : null
  const filter: TagWardFilterState = view
    ? { tagIds: view.tagIds, tagMode: view.tagMode, wardTagIds: view.wardTagIds }
    : {
      tagIds: (selection.tags ?? []).map((name) => resolveTag(name, world).id as number),
      tagMode: selection.tagMode ?? 'OR',
      wardTagIds: (selection.wards ?? []).map((name) => resolveTag(name, world, WARD_TAG_GROUP_NAME).id as number),
    }

  const requested = selection.pool && selection.pool.length > 0 ? selection.pool : ['active' as const]
  const criteria: PatientPoolCriterion[] = requested.includes('all') ? [] : requested.filter((criterion): criterion is PatientPoolCriterion => criterion !== 'all')
  let window: DateTimeWindow | null = null
  if (patientPoolCriteriaNeedWindow(criteria)) {
    const now = new Date()
    window = selection.windowHours !== undefined
      ? (() => {
        const from = new Date(now.getTime() - selection.windowHours * 3_600_000)
        return { dateFrom: toLocalISODate(from), timeFrom: toLocalTime(from), dateTo: toLocalISODate(now), timeTo: toLocalTime(now) }
      })()
      : computeDefaultWindowLookback(now)
  }

  const sort = resolveSort(selection, view, world)
  const filtered = world.patients
    .filter((patient) => matchesTagWardFilter(patient, filter))
    .filter((patient) => matchesPatientPool(patient, criteria, window, world.renderData.poolContext))
  return { patients: sortPatientsByConfig(filtered, sort, world.tagsById), sort }
}

// --- One patient, in full ---------------------------------------------------------------------------

export const describePatient = (world: World, patient: Patient, options: { date?: string; recentEntries?: number } = {}) => {
  const patientId = patient.id as number
  const recent = options.recentEntries ?? 10
  const date = options.date ?? toLocalISODate()
  const updates = world.dailyUpdatesSorted.get(patientId) ?? []
  const noteUpdate = updates.filter((update) => update.date <= date).at(-1) ?? null
  const problems = world.masterProblems
    .filter((problem) => problem.patientId === patientId)
    .sort((a, b) => (a.parentId ?? a.id ?? 0) - (b.parentId ?? b.id ?? 0) || a.sortOrder - b.sortOrder)

  const diagnosisFor = (unassigned: string, byService: Record<number, string>) => [
    ...(unassigned.trim() ? [{ service: null, text: unassigned }] : []),
    ...Object.entries(byService).filter(([, text]) => text.trim()).map(([tagId, text]) => ({ service: world.tagsById.get(Number(tagId))?.name ?? `#${tagId}`, text })),
  ]

  return {
    ...summarizePatient(patient, world),
    attendingPhysician: patient.attendingPhysician,
    admitDate: patient.admitDate || patient.createdAt.slice(0, 10),
    admissionDiagnosis: diagnosisFor(patient.admissionDiagnosisUnassigned, patient.admissionDiagnosisByService),
    dischargeDiagnosis: diagnosisFor(patient.dischargeDiagnosisUnassigned, patient.dischargeDiagnosisByService),
    clinicalSummary: patient.clinicalSummary,
    database: patient.database,
    plans: patient.plans,
    medicationsNote: patient.medications,
    labsNote: patient.labs,
    pendings: patient.pendings,
    problems: problems.map((problem) => ({
      problemId: problem.id,
      title: problem.currentTitle,
      status: problem.status,
      isSubProblem: problem.parentId !== null,
      dateIdentified: problem.dateIdentified,
      resolutionNotes: problem.resolutionNotes,
      noteForDate: noteUpdate?.problems.find((note) => note.masterProblemId === problem.id)?.notes ?? '',
    })),
    dailyNote: noteUpdate && {
      date: noteUpdate.date,
      isForRequestedDate: noteUpdate.date === date,
      subjective: noteUpdate.subjective,
      objective: noteUpdate.objective,
      assessment: noteUpdate.assessment,
      plans: noteUpdate.plans,
    },
    checklist: buildMasterChecklistItemsForSource(patientId, patientIdentifier(patient), updates, date).map((item) => ({
      text: item.text,
      completed: item.completed,
      notes: item.notes,
      addedOn: item.createdDate,
      completedOn: item.completedDate,
    })),
    vitals: (world.vitalsByPatient.get(patientId) ?? []).slice(-recent).map(withoutSyncFields),
    medications: (world.medicationsByPatient.get(patientId) ?? []).map(withoutSyncFields),
    orders: (world.ordersByPatient.get(patientId) ?? []).slice(0, Math.max(recent, 20)).map(withoutSyncFields),
    labs: (world.labsByPatient.get(patientId) ?? []).slice(0, recent).map(withoutSyncFields),
  }
}

// --- Checklist ---------------------------------------------------------------------------------------

export const describeChecklist = (world: World, date: string | undefined, selection: PatientSelection = {}) => {
  const viewDate = date ?? toLocalISODate()
  const restricted = Boolean(selection.patientIds?.length || selection.tags?.length || selection.wards?.length || selection.view)
  const allowed = restricted ? new Set(selectPatients(world, selection).patients.map((patient) => patient.id)) : null
  const sort = resolveSort(selection, selection.view ? resolveView(selection.view, world) : null, world)

  const items = buildMasterChecklistItems(world.patients, world.tagsById, sort, world.dailyUpdatesSorted, viewDate)
    .filter((item) => item.patientId < 0 || allowed === null || allowed.has(item.patientId))

  const byPatient = new Map<number, { patientId: number | null; identifier: string; items: unknown[] }>()
  for (const item of items) {
    const entry = byPatient.get(item.patientId) ?? { patientId: item.patientId < 0 ? null : item.patientId, identifier: item.patientIdentifier, items: [] }
    entry.items.push({
      index: item.index,
      text: item.text,
      completed: item.completed,
      notes: item.notes,
      addedOn: item.createdDate,
      completedOn: item.completedDate,
    })
    byPatient.set(item.patientId, entry)
  }
  return { date: viewDate, patients: [...byPatient.values()] }
}

// --- Templates and reports ---------------------------------------------------------------------------

/** The format spelled out: the template's own text with each variable replaced by what it prints. */
const spellOutPattern = (patternText: string, variables: ReportTemplate['variables'] | Record<string, never>): string =>
  tokenizePatternText(patternText).map((part) => {
    if (part.type === 'text') return part.text
    if (part.type === 'lineBreak') return '\n'
    const instance = (variables as ReportTemplate['variables'])[part.id]
    return instance ? `⟨${describeVariableInstance(instance)}⟩` : '⟨?⟩'
  }).join('')

const sampleOutputFor = (template: ReportTemplate, world: World): string => {
  const patient = buildSamplePreviewPatient(world.tagsById, world.tagGroups)
  const ctx = buildSamplePreviewContext(world.renderData.dateTimeFormatsById, world.tagsById, world.tagGroups, patient)
  return generateTemplateOutput(template, [patient], ctx)
}

export const describeTemplate = (template: ReportTemplate, world: World, withSample: boolean) => ({
  templateId: template.id,
  name: template.name,
  enabled: !template.disabled,
  repeats: classifyTemplateRepeatMode(template) === 'per-patient' ? 'once per patient' : 'prints once',
  patientSeparator: template.patientSeparator,
  header: template.headerPatternText ? spellOutPattern(template.headerPatternText, template.headerVariables) : '',
  format: spellOutPattern(template.patternText, template.variables),
  footer: template.footerPatternText ? spellOutPattern(template.footerPatternText, template.footerVariables) : '',
  grouping: template.groupingEnabled
    ? { groupFormat: spellOutGroup(template), mainTemplates: 1 + (template.extraMainTemplates?.length ?? 0) }
    : null,
  ...(withSample ? { sampleOutput: sampleOutputFor(template, world) } : {}),
})

const spellOutGroup = (template: ReportTemplate): string =>
  tokenizePatternText(template.groupPatternText).map((part) => {
    if (part.type === 'text') return part.text
    if (part.type === 'lineBreak') return '\n'
    const instance = template.groupVariables[part.id]
    return instance ? `⟨${describeGroupVariableInstance(instance)}⟩` : '⟨?⟩'
  }).join('')

export const resolveTemplate = (world: World, ref: { templateId?: number; name?: string }): ReportTemplate => {
  if (ref.templateId !== undefined) {
    const found = world.templates.find((template) => template.id === ref.templateId)
    if (!found) throw new ToolError(`No template has id ${ref.templateId}.`)
    return found
  }
  if (!ref.name) throw new ToolError('Say which template: a templateId or its exact name.')
  const exact = world.templates.filter((template) => lower(template.name) === lower(ref.name as string))
  if (exact.length === 1) return exact[0]
  const close = world.templates.filter((template) => lower(template.name).includes(lower(ref.name as string)) || lower(ref.name as string).includes(lower(template.name)))
  throw new ToolError(exact.length > 1
    ? `More than one template is named "${ref.name}" (ids ${exact.map((template) => template.id).join(', ')}).`
    : `No template is named exactly "${ref.name}". ${close.length > 0 ? `Closest: ${close.map((template) => template.name).join('; ')}.` : `Templates: ${world.templates.map((template) => template.name).join(', ')}.`}`)
}

export const previewTemplate = (world: World, template: ReportTemplate): string => sampleOutputFor(template, world)

/**
 * Generates a report exactly as the Reports tab would: the same template engine, the same ordering
 * of entries, the same header and footer. The text is final — a caller sends it as is.
 */
export const renderReport = (world: World, template: ReportTemplate, selection: PatientSelection = {}) => {
  if (template.disabled) throw new ToolError(`Template "${template.name}" is switched off in PUHRR.`)
  const repeatsPerPatient = classifyTemplateRepeatMode(template) === 'per-patient'
  const { patients } = repeatsPerPatient || template.groupingEnabled
    ? selectPatients(world, selection)
    : { patients: [] as Patient[] }
  if (repeatsPerPatient && patients.length === 0) {
    throw new ToolError('No patients match that selection, so there is nothing to report. Check the filter, or pass patientIds.')
  }
  const text = generateTemplateOutput(template, patients, buildTemplateRenderContext(world.renderData))
  return { text, patients: patients.map((patient) => patientIdentifier(patient)) }
}
