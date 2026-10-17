import { db } from '@/db'
import {
  appendChecklistItemsForPatientDate,
  insertNewChecklistItem,
  normalizeChecklistItemsKeepingBlanks,
  reorderChecklistItems,
  selectLatestDailyUpdate,
  setChecklistItemCompletion,
  toPendingChecklistItems,
} from '@/features/checklist/checklistUtils'
import { GENERAL_CHECKLIST_LABEL, GENERAL_CHECKLIST_PATIENT_ID } from '@/features/checklist/masterChecklist'
import { appendChecklistItemsToPatientDate, runAutomaticCustomActionsForTagAddition } from '@/features/customActions/automaticActions'
import {
  actionHasApplicableEffect,
  actionHasApplicableGeneralEffect,
  applyCustomActionEffects,
  applyGeneralCustomActionEffects,
  formatPatientLabelForNotice,
  resolveMatchingConditions,
  resolveMatchingGeneralConditions,
} from '@/features/customActions/customActionUtils'
import { LAB_TEMPLATES, OTHERS_LABEL_KEY, OTHERS_LAB_TEMPLATE_ID, OTHERS_RESULT_KEY, UST_ABG_TEMPLATE_ID, getNormalRangeFieldKey, getUlnFieldKey } from '@/features/labs/labTemplates'
import { withAbgDerivedValues } from '@/features/labs/labDerived'
import { buildCarriedForwardProblemFields, buildMasterProblemLabels } from '@/features/problems/problemUtils'
import { SERVICE_TAG_GROUP_NAME, WARD_TAG_GROUP_NAME } from '@/features/tags/tagConstants'
import { getOrCreateServiceTag } from '@/features/tags/serviceTagUtils'
import {
  addMainServiceTagToPatient,
  addReferralServiceTagToPatient,
  removeMainServiceTagFromPatient,
  removeReferralServiceTagFromPatient,
} from '@/features/tags/serviceTagUtils'
import { applyTagToPatient, isPatientActive, removeTagFromPatient } from '@/features/tags/tagUtils'
import { clearPatientWardTag, getOrCreateWardTag, setPatientWardTag } from '@/features/tags/wardTagUtils'
import { tokenizePatternText } from '@/features/templates/templateEngine'
import { toLocalISODate, toLocalTime } from '@/lib/dateTime'
import type { CustomAction, CustomView, DailyUpdate, LabEntry, MasterProblem, MedicationEntry, OrderEntry, Patient, ReportTemplate, SimpleProblemItem, TagDefinition, VitalEntry } from '@/types'
import {
  type PatientSelection,
  ToolError,
  renderReport,
  resolveTemplate,
  patientIdentifier,
  resolveSort,
  resolveTag,
  resolveView,
  suggestTags,
} from './queries'
import { type World, loadWorld } from './world'

const lower = (value: string): string => value.trim().toLowerCase()
const clean = (value: string | undefined): string => (value ?? '').trim()
const nowIso = (): string => new Date().toISOString()
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const requireDate = (value: string | undefined, fallback: string, label = 'date'): string => {
  if (value === undefined || value === '') return fallback
  if (!DATE_PATTERN.test(value)) throw new ToolError(`${label} must be YYYY-MM-DD, e.g. ${toLocalISODate()}.`)
  return value
}
const requireTime = (value: string | undefined, fallback: string, label = 'time'): string => {
  if (value === undefined || value === '') return fallback
  if (!TIME_PATTERN.test(value)) throw new ToolError(`${label} must be 24-hour HH:MM, e.g. ${toLocalTime()}.`)
  return value
}

/** `report` is text the caller must pass on to the user exactly as it is (a template a custom action ran). */
export type Done = { summary: string; patient?: Patient; report?: { template: string; patients: string[]; text: string } }

// --- Who is being changed ----------------------------------------------------------------------------

export type PatientRef = { room: string; lastName: string; patientId?: number }

/**
 * Identifies the patient a change is for. Room AND last name are both required — an id alone could
 * point at the wrong person after a misread — and the pair must name exactly one patient. The
 * result of every change repeats who was changed, so a slip is visible at once.
 */
export const resolvePatientForWrite = (world: World, ref: PatientRef): Patient => {
  const room = lower(ref.room ?? '')
  const lastName = lower(ref.lastName ?? '')
  if (!lastName) throw new ToolError('Give both the room and the last name of the patient.')

  const matches = world.patients.filter((patient) => lower(patient.roomNumber) === room && lower(patient.lastName) === lastName)
  const active = matches.filter((patient) => isPatientActive(patient, world.tagsById))
  const candidates = active.length > 0 ? active : matches

  if (candidates.length === 0) {
    const sameName = world.patients.filter((patient) => lower(patient.lastName) === lastName)
    throw new ToolError(sameName.length > 0
      ? `No patient named ${ref.lastName} is in room "${ref.room}". There ${sameName.length === 1 ? 'is' : 'are'}: ${sameName.map((patient) => patientIdentifier(patient)).join('; ')}. Ask the user which one they mean.`
      : `No patient named ${ref.lastName} was found. Check the spelling with the user.`)
  }
  if (candidates.length > 1) {
    throw new ToolError(`More than one patient matches room ${ref.room} and ${ref.lastName}: ${candidates.map((patient) => `${patientIdentifier(patient)} (id ${patient.id})`).join('; ')}. Ask which one, and pass patientId.`)
  }
  const patient = candidates[0]
  if (ref.patientId !== undefined && patient.id !== ref.patientId) {
    throw new ToolError(`Room ${ref.room} / ${ref.lastName} is ${patientIdentifier(patient)} (id ${patient.id}), not id ${ref.patientId}. Nothing was changed; check which patient is meant.`)
  }
  return patient
}

const touchPatient = async (patientId: number): Promise<void> => {
  await db.patients.update(patientId, { lastModified: nowIso() })
}

const freshPatient = async (patientId: number): Promise<Patient> => {
  const patient = await db.patients.get(patientId)
  if (!patient) throw new ToolError('That patient no longer exists.')
  return patient
}

const freshTags = async (): Promise<Map<number, TagDefinition>> =>
  new Map((await db.tagDefinitions.toArray()).map((tag) => [tag.id as number, tag]))

// --- Patients --------------------------------------------------------------------------------------------

export type NewPatient = {
  room: string
  lastName: string
  firstName?: string
  age?: number
  sex?: 'M' | 'F' | 'O'
  ward?: string
  mainServices?: string[]
  attendingPhysician?: string
}

export const addPatient = async (world: World, input: NewPatient): Promise<Done> => {
  const room = clean(input.room)
  const lastName = clean(input.lastName)
  if (!lastName) throw new ToolError('A patient needs at least a last name.')
  const existing = world.patients.find((patient) => lower(patient.roomNumber) === lower(room) && lower(patient.lastName) === lower(lastName) && isPatientActive(patient, world.tagsById))
  if (existing) throw new ToolError(`${patientIdentifier(existing)} is already in PUHRR (id ${existing.id}). Nothing was added.`)

  const ward = input.ward ? resolveTag(input.ward, world, WARD_TAG_GROUP_NAME) : undefined
  const services = (input.mainServices ?? []).map((name) => resolveTag(name, world, SERVICE_TAG_GROUP_NAME))

  const now = nowIso()
  const id = await db.patients.add({
    lastModified: now,
    createdAt: now,
    roomNumber: room,
    ...(ward ? { wardTagId: ward.id } : {}),
    firstName: clean(input.firstName),
    lastName,
    ...(input.age !== undefined ? { age: input.age } : {}),
    sex: input.sex ?? 'M',
    admissionDiagnosisUnassigned: '',
    admissionDiagnosisByService: {},
    dischargeDiagnosisUnassigned: '',
    dischargeDiagnosisByService: {},
    admitDate: '',
    admitTime: '',
    referralDate: '',
    referralTime: '',
    mainServiceTagIds: services.map((tag) => tag.id as number),
    referralServiceTagIds: [],
    attendingPhysician: clean(input.attendingPhysician),
    clinicalSummary: '',
    database: '',
    plans: '',
    medications: '',
    labs: '',
    pendings: '',
    tagIds: [],
  }) as number
  const patient = await freshPatient(id)
  return { summary: `Added patient ${patientIdentifier(patient)}.`, patient }
}

export type PatientFields = {
  room?: string
  lastName?: string
  firstName?: string
  middleName?: string
  age?: number
  sex?: 'M' | 'F' | 'O'
  attendingPhysician?: string
  admitDate?: string
  admitTime?: string
  referralDate?: string
  referralTime?: string
  dischargeDate?: string
  dischargeTime?: string
  clinicalSummary?: string
  database?: string
  plans?: string
  medications?: string
  labs?: string
  pendings?: string
}

const LONG_TEXT_FIELDS = ['clinicalSummary', 'database', 'plans', 'medications', 'labs', 'pendings'] as const

export const updatePatient = async (world: World, patient: Patient, fields: PatientFields, appendText: boolean): Promise<Done> => {
  const update: Record<string, unknown> = {}
  const changes: string[] = []
  const set = (key: keyof Patient, value: unknown, label: string) => {
    if ((patient[key] ?? '') === value) return
    update[key] = value
    changes.push(`${label}: ${String(patient[key] ?? '') || '(blank)'} → ${String(value) || '(blank)'}`)
  }

  if (fields.room !== undefined) set('roomNumber', clean(fields.room), 'room')
  if (fields.lastName !== undefined) {
    if (!clean(fields.lastName)) throw new ToolError('Last name cannot be blank.')
    set('lastName', clean(fields.lastName), 'last name')
  }
  if (fields.firstName !== undefined) set('firstName', clean(fields.firstName), 'first name')
  if (fields.middleName !== undefined) set('middleName', clean(fields.middleName), 'middle name')
  if (fields.age !== undefined) set('age', fields.age, 'age')
  if (fields.sex !== undefined) set('sex', fields.sex, 'sex')
  if (fields.attendingPhysician !== undefined) set('attendingPhysician', clean(fields.attendingPhysician), 'attending')
  for (const key of ['admitDate', 'referralDate', 'dischargeDate'] as const) {
    if (fields[key] !== undefined) set(key, fields[key] === '' ? '' : requireDate(fields[key], '', key), key)
  }
  for (const key of ['admitTime', 'referralTime', 'dischargeTime'] as const) {
    if (fields[key] !== undefined) set(key, fields[key] === '' ? '' : requireTime(fields[key], '', key), key)
  }
  for (const key of LONG_TEXT_FIELDS) {
    const incoming = fields[key]
    if (incoming === undefined) continue
    const next = appendText && patient[key].trim() ? `${patient[key].replace(/\s+$/, '')}\n${incoming}` : incoming
    if (next === patient[key]) continue
    update[key] = next
    changes.push(appendText ? `${key}: added text` : `${key}: replaced`)
  }

  if (changes.length === 0) return { summary: `No change to ${patientIdentifier(patient)}: everything was already as asked.`, patient }
  const roomOrName = update.roomNumber ?? patient.roomNumber
  const surname = update.lastName ?? patient.lastName
  const clash = world.patients.find((other) => other.id !== patient.id && lower(other.roomNumber) === lower(String(roomOrName)) && lower(other.lastName) === lower(String(surname)) && isPatientActive(other, world.tagsById))
  if (clash) throw new ToolError(`That would make this patient identical in room and last name to ${patientIdentifier(clash)}. Nothing was changed.`)

  await db.patients.update(patient.id as number, { ...update, lastModified: nowIso() })
  const after = await freshPatient(patient.id as number)
  return { summary: `Updated ${patientIdentifier(after)}: ${changes.join('; ')}.`, patient: after }
}

export const setWard = async (world: World, patient: Patient, ward: string | null): Promise<Done> => {
  if (ward === null) {
    await clearPatientWardTag(patient)
    return { summary: `Cleared the ward of ${patientIdentifier(patient)}.`, patient }
  }
  const tag = resolveTag(ward, world, WARD_TAG_GROUP_NAME)
  await setPatientWardTag(patient, tag)
  return { summary: `Set the ward of ${patientIdentifier(patient)} to ${tag.name}.`, patient: await freshPatient(patient.id as number) }
}

export const setServices = async (
  world: World,
  patient: Patient,
  changes: { addMain?: string[]; removeMain?: string[]; addReferral?: string[]; removeReferral?: string[] },
): Promise<Done> => {
  const actions: Array<[string[] | undefined, (p: Patient, t: TagDefinition) => Promise<void>, string]> = [
    [changes.addMain, addMainServiceTagToPatient, 'main service added'],
    [changes.removeMain, removeMainServiceTagFromPatient, 'main service removed'],
    [changes.addReferral, addReferralServiceTagToPatient, 'referral added'],
    [changes.removeReferral, removeReferralServiceTagFromPatient, 'referral removed'],
  ]
  // Resolve every name first so a wrong one changes nothing.
  const resolved = actions.map(([names, apply, label]) => ({ tags: (names ?? []).map((name) => resolveTag(name, world, SERVICE_TAG_GROUP_NAME)), apply, label }))
  const done: string[] = []
  for (const step of resolved) {
    for (const tag of step.tags) {
      await step.apply(await freshPatient(patient.id as number), tag)
      done.push(`${step.label}: ${tag.name}`)
    }
  }
  if (done.length === 0) throw new ToolError('Say which services to add or remove.')
  const after = await freshPatient(patient.id as number)
  return { summary: `Services of ${patientIdentifier(after)}: ${done.join('; ')}.`, patient: after }
}

export const setDiagnosis = async (world: World, patient: Patient, input: { kind: 'admission' | 'discharge'; text: string; service?: string }): Promise<Done> => {
  const serviceIds = [...(patient.mainServiceTagIds ?? []), ...(patient.referralServiceTagIds ?? [])]
  const serviceTags = serviceIds.map((id) => world.tagsById.get(id)).filter((tag): tag is TagDefinition => tag !== undefined)

  let target: TagDefinition | null = null
  if (input.service) {
    target = serviceTags.find((tag) => lower(tag.name) === lower(input.service as string)) ?? null
    if (!target) throw new ToolError(`${patientIdentifier(patient)} has no service named "${input.service}". Their services: ${serviceTags.map((tag) => tag.name).join(', ') || '(none)'}.`)
  } else if (serviceTags.length === 1) {
    target = serviceTags[0]
  } else if (serviceTags.length > 1) {
    throw new ToolError(`${patientIdentifier(patient)} is under ${serviceTags.map((tag) => tag.name).join(' and ')}. Say which service this diagnosis is for.`)
  }

  const text = clean(input.text)
  const unassignedKey = input.kind === 'admission' ? 'admissionDiagnosisUnassigned' : 'dischargeDiagnosisUnassigned'
  const byServiceKey = input.kind === 'admission' ? 'admissionDiagnosisByService' : 'dischargeDiagnosisByService'
  const update: Partial<Patient> = target
    ? { [byServiceKey]: { ...patient[byServiceKey], [target.id as number]: text }, lastModified: nowIso() }
    : { [unassignedKey]: text, lastModified: nowIso() }
  await db.patients.update(patient.id as number, update)
  const after = await freshPatient(patient.id as number)
  return { summary: `Set the ${input.kind} diagnosis${target ? ` (${target.name})` : ''} of ${patientIdentifier(after)}.`, patient: after }
}

/** Existing tags only. Ward and service tags have their own tools; ending a patient's active status
 * (a terminal tag) goes through the confirmed discharge. */
export const setTags = async (world: World, patient: Patient, changes: { add?: string[]; remove?: string[] }): Promise<Done> => {
  const wardAndService = new Set<number>()
  world.tagGroups.filter((group) => group.name === WARD_TAG_GROUP_NAME || group.name === SERVICE_TAG_GROUP_NAME).forEach((group) => wardAndService.add(group.id as number))

  const toAdd = (changes.add ?? []).map((name) => resolveTag(name, world))
  const toRemove = (changes.remove ?? []).map((name) => resolveTag(name, world))
  for (const tag of [...toAdd, ...toRemove]) {
    if (tag.groupId !== undefined && wardAndService.has(tag.groupId)) throw new ToolError(`"${tag.name}" is a ward or service tag. Use set_ward or set_services for those.`)
  }
  const terminal = toAdd.find((tag) => tag.terminal)
  if (terminal) throw new ToolError(`"${terminal.name}" ends the patient's active status. Use request_discharge so the user confirms it first.`)
  if (toAdd.length === 0 && toRemove.length === 0) throw new ToolError('Say which tags to add or remove.')

  const tagsById = await freshTags()
  const summary: string[] = []
  const addedIds: number[] = []
  for (const tag of toAdd) {
    const current = await freshPatient(patient.id as number)
    if ((current.tagIds ?? []).includes(tag.id as number)) continue
    await applyTagToPatient(current, tag)
    addedIds.push(tag.id as number)
    summary.push(`added ${tag.name}`)
  }
  for (const tag of toRemove) {
    const current = await freshPatient(patient.id as number)
    if (!(current.tagIds ?? []).includes(tag.id as number)) continue
    await removeTagFromPatient(current, tag)
    summary.push(`removed ${tag.name}`)
  }

  const messages = await runTagAutomation(patient.id as number, addedIds, tagsById)
  const after = await freshPatient(patient.id as number)
  return {
    summary: `Tags of ${patientIdentifier(after)}: ${summary.join('; ') || 'already as asked'}.${messages.length ? ` ${messages.join(' ')}` : ''}`,
    patient: after,
  }
}

const runTagAutomation = async (patientId: number, addedTagIds: number[], tagsById: Map<number, TagDefinition>): Promise<string[]> =>
  runAutomaticCustomActionsForTagAddition({
    patientAfterAdd: await freshPatient(patientId),
    addedTagIds,
    customActions: await db.customActions.toArray(),
    tagsById,
    today: toLocalISODate(),
    appendChecklistItems: appendChecklistItemsToPatientDate,
  })

export const dischargePatient = async (world: World, patient: Patient, tagName?: string): Promise<Done> => {
  const tag = tagName
    ? resolveTag(tagName, world)
    : [...world.tagsById.values()].find((candidate) => candidate.automationRole === 'status-discharged')
  if (!tag) throw new ToolError('There is no Discharged tag in PUHRR. Say which tag to use.')
  if (!tag.terminal) throw new ToolError(`"${tag.name}" does not end a patient's active status, so it is not a discharge tag.`)
  const tagsById = await freshTags()
  const current = await freshPatient(patient.id as number)
  if ((current.tagIds ?? []).includes(tag.id as number)) return { summary: `${patientIdentifier(current)} already has the ${tag.name} tag.`, patient: current }
  await applyTagToPatient(current, tag)
  const messages = await runTagAutomation(patient.id as number, [tag.id as number], tagsById)
  const after = await freshPatient(patient.id as number)
  return { summary: `Tagged ${patientIdentifier(after)} as ${tag.name}.${messages.length ? ` ${messages.join(' ')}` : ''}`, patient: after }
}

export const createTag = async (world: World, input: { name: string; group: string; allowSimilar?: boolean }): Promise<Done> => {
  const name = clean(input.name)
  if (!name) throw new ToolError('A tag needs a name.')
  const group = world.tagGroups.find((candidate) => lower(candidate.name) === lower(input.group))
  if (!group) throw new ToolError(`No tag group is named "${input.group}". Groups: ${world.tagGroups.map((candidate) => candidate.name).join(', ')}.`)
  const inGroup = [...world.tagsById.values()].filter((tag) => tag.groupId === group.id)
  if (inGroup.some((tag) => lower(tag.name) === lower(name))) throw new ToolError(`A ${group.name} tag named "${name}" already exists. Use it instead.`)
  const similar = suggestTags(name, inGroup)
  if (similar.length > 0 && !input.allowSimilar) {
    throw new ToolError(`Similar ${group.name} tags already exist: ${similar.map((tag) => tag.name).join('; ')}. Ask the user whether one of those is meant; only if not, repeat with allowSimilar true.`)
  }

  if (group.name === WARD_TAG_GROUP_NAME) await getOrCreateWardTag(name, inGroup, group.id as number)
  else if (group.name === SERVICE_TAG_GROUP_NAME) await getOrCreateServiceTag(name, inGroup, group.id as number)
  else {
    await db.tagDefinitions.add({
      name,
      displayType: 'color',
      groupId: group.id,
      sortOrder: inGroup.length > 0 ? Math.max(...inGroup.map((tag) => tag.sortOrder)) + 1 : 0,
      visibleOnPatientCard: true,
      terminal: false,
      automationRole: 'none',
      createdAt: nowIso(),
    })
  }
  return { summary: `Created the ${group.name} tag "${name}".` }
}

// --- Vitals, medications, orders, labs ---------------------------------------------------------------------

const ownedBy = <T extends { patientId: number }>(record: T | undefined, patient: Patient, what: string, id: number): T => {
  if (!record) throw new ToolError(`No ${what} has id ${id}.`)
  if (record.patientId !== patient.id) throw new ToolError(`${what} ${id} belongs to a different patient than ${patientIdentifier(patient)}. Nothing was changed.`)
  return record
}

export type VitalInput = { date?: string; time?: string; bp?: string; hr?: string; rr?: string; temp?: string; spo2?: string; note?: string }

export const addVitals = async (patient: Patient, input: VitalInput): Promise<Done> => {
  const values = { bp: clean(input.bp), hr: clean(input.hr), rr: clean(input.rr), temp: clean(input.temp), spo2: clean(input.spo2), note: clean(input.note) }
  if (!Object.values(values).some(Boolean)) throw new ToolError('Give at least one vital sign or a note.')
  const date = requireDate(input.date, toLocalISODate())
  const time = requireTime(input.time, toLocalTime())
  await db.vitals.add({ patientId: patient.id as number, date, time, ...values, createdAt: nowIso() })
  await touchPatient(patient.id as number)
  const shown = [values.bp && `BP ${values.bp}`, values.hr && `HR ${values.hr}`, values.rr && `RR ${values.rr}`, values.temp && `T ${values.temp}`, values.spo2 && `SpO2 ${values.spo2}`].filter(Boolean).join(', ')
  return { summary: `Added vitals for ${patientIdentifier(patient)} (${date} ${time}): ${shown || values.note}.`, patient }
}

export const updateVitals = async (patient: Patient, vitalId: number, input: VitalInput): Promise<Done> => {
  const existing = ownedBy(await db.vitals.get(vitalId), patient, 'vitals entry', vitalId)
  const update: Partial<VitalEntry> = {}
  for (const key of ['bp', 'hr', 'rr', 'temp', 'spo2', 'note'] as const) if (input[key] !== undefined) update[key] = clean(input[key])
  if (input.date !== undefined) update.date = requireDate(input.date, existing.date)
  if (input.time !== undefined) update.time = requireTime(input.time, existing.time)
  await db.vitals.update(vitalId, update)
  await touchPatient(patient.id as number)
  return { summary: `Edited the vitals entry of ${existing.date} ${existing.time} for ${patientIdentifier(patient)}: ${Object.keys(update).join(', ') || 'nothing changed'}.`, patient }
}

export type MedicationInput = { medication?: string; dose?: string; route?: string; frequency?: string; note?: string; status?: MedicationEntry['status'] }

export const addMedication = async (patient: Patient, input: MedicationInput): Promise<Done> => {
  if (!clean(input.medication)) throw new ToolError('Say which medication.')
  const existing = await db.medications.where('patientId').equals(patient.id as number).toArray()
  const sortOrder = existing.reduce((max, entry, index) => Math.max(max, entry.sortOrder ?? index), -1) + 1
  await db.medications.add({
    patientId: patient.id as number,
    sortOrder,
    medication: clean(input.medication),
    dose: clean(input.dose),
    route: clean(input.route),
    frequency: clean(input.frequency),
    note: clean(input.note),
    status: input.status ?? 'active',
    createdAt: nowIso(),
  })
  await touchPatient(patient.id as number)
  return { summary: `Added ${clean(input.medication)} ${clean(input.dose)} ${clean(input.route)} ${clean(input.frequency)} for ${patientIdentifier(patient)}.`.replace(/\s+/g, ' '), patient }
}

export const updateMedication = async (patient: Patient, medicationId: number, input: MedicationInput): Promise<Done> => {
  const existing = ownedBy(await db.medications.get(medicationId), patient, 'medication', medicationId)
  const update: Partial<MedicationEntry> = {}
  for (const key of ['medication', 'dose', 'route', 'frequency', 'note'] as const) if (input[key] !== undefined) update[key] = clean(input[key])
  if (input.status !== undefined) update.status = input.status
  if (update.medication === '') throw new ToolError('The medication name cannot be blank.')
  await db.medications.update(medicationId, update)
  await touchPatient(patient.id as number)
  return { summary: `Edited ${existing.medication} for ${patientIdentifier(patient)}: ${Object.entries(update).map(([key, value]) => `${key} → ${String(value) || '(blank)'}`).join('; ') || 'nothing changed'}.`, patient }
}

export type OrderInput = { orderText?: string; service?: string; status?: OrderEntry['status']; date?: string; time?: string; note?: string }

export const addOrder = async (patient: Patient, input: OrderInput): Promise<Done> => {
  if (!clean(input.orderText)) throw new ToolError('Say what the order is.')
  await db.orders.add({
    patientId: patient.id as number,
    orderDate: requireDate(input.date, toLocalISODate()),
    orderTime: requireTime(input.time, toLocalTime()),
    service: clean(input.service),
    orderText: clean(input.orderText),
    status: input.status ?? 'active',
    note: clean(input.note),
    createdAt: nowIso(),
  })
  await touchPatient(patient.id as number)
  return { summary: `Added the order "${clean(input.orderText)}" for ${patientIdentifier(patient)}.`, patient }
}

export const updateOrder = async (patient: Patient, orderId: number, input: OrderInput): Promise<Done> => {
  const existing = ownedBy(await db.orders.get(orderId), patient, 'order', orderId)
  const update: Partial<OrderEntry> = {}
  if (input.orderText !== undefined) update.orderText = clean(input.orderText)
  if (input.service !== undefined) update.service = clean(input.service)
  if (input.note !== undefined) update.note = clean(input.note)
  if (input.status !== undefined) update.status = input.status
  if (input.date !== undefined) update.orderDate = requireDate(input.date, existing.orderDate)
  if (input.time !== undefined) update.orderTime = requireTime(input.time, existing.orderTime)
  if (update.orderText === '') throw new ToolError('The order text cannot be blank.')
  await db.orders.update(orderId, update)
  await touchPatient(patient.id as number)
  return { summary: `Edited the order "${existing.orderText}" for ${patientIdentifier(patient)}: ${Object.entries(update).map(([key, value]) => `${key} → ${String(value) || '(blank)'}`).join('; ') || 'nothing changed'}.`, patient }
}

const resolveLabTemplate = (ref: string) => {
  const found = LAB_TEMPLATES.find((template) => lower(template.id) === lower(ref) || lower(template.name) === lower(ref))
  if (!found) throw new ToolError(`No lab template is named "${ref}". Templates: ${LAB_TEMPLATES.map((template) => template.name).join(', ')}.`)
  return found
}

/** The names a person can type for each stored result key of a lab template. */
const labKeyLookup = (template: ReturnType<typeof resolveLabTemplate>): Map<string, string> => {
  const keys = new Map<string, string>()
  if (template.id === OTHERS_LAB_TEMPLATE_ID) {
    keys.set('label', OTHERS_LABEL_KEY)
    keys.set('result', OTHERS_RESULT_KEY)
    return keys
  }
  for (const test of template.tests) {
    keys.set(lower(test.key), test.key)
    if (test.requiresUln) keys.set(lower(`${test.key} uln`), getUlnFieldKey(test.key))
    if (test.requiresNormalRange) keys.set(lower(`${test.key} normal range`), getNormalRangeFieldKey(test.key))
  }
  return keys
}

const validLabNames = (template: ReturnType<typeof resolveLabTemplate>): string =>
  template.id === OTHERS_LAB_TEMPLATE_ID ? 'label, result' : template.tests.map((test) => test.key).join(', ')

/** Applies typed values to a lab entry's stored results (a blank value clears that field), checking
 * every name against the template and refreshing the calculated ABG fields. */
const applyLabValues = (template: ReturnType<typeof resolveLabTemplate>, base: Record<string, string>, typed: Record<string, string>): Record<string, string> => {
  const keys = labKeyLookup(template)
  const results = { ...base }
  for (const [name, value] of Object.entries(typed)) {
    const key = keys.get(lower(name))
    if (!key) throw new ToolError(`"${name}" is not a field of the ${template.name} template. Fields: ${validLabNames(template)}.`)
    if (clean(value)) results[key] = clean(value)
    else delete results[key]
  }
  if (template.id === OTHERS_LAB_TEMPLATE_ID) {
    if (!results[OTHERS_LABEL_KEY] || !results[OTHERS_RESULT_KEY]) throw new ToolError('The Others lab needs both a "label" and a "result".')
    return results
  }
  if (!template.tests.some((test) => results[test.key])) throw new ToolError('A lab entry needs at least one lab value.')
  return template.id === UST_ABG_TEMPLATE_ID ? withAbgDerivedValues(results) : results
}

export type LabInput = { template: string; results: Record<string, string>; date?: string; time?: string; note?: string }

export const addLab = async (patient: Patient, input: LabInput): Promise<Done> => {
  const template = resolveLabTemplate(input.template)
  const results = applyLabValues(template, {}, input.results)
  const date = requireDate(input.date, toLocalISODate())
  await db.labs.add({ patientId: patient.id as number, date, time: requireTime(input.time, toLocalTime()), templateId: template.id, results, note: clean(input.note), createdAt: nowIso() })
  await touchPatient(patient.id as number)
  return { summary: `Added ${template.name} results (${date}) for ${patientIdentifier(patient)}.`, patient }
}

export const updateLab = async (patient: Patient, labId: number, input: { results?: Record<string, string>; date?: string; time?: string; note?: string }): Promise<Done> => {
  const existing = ownedBy(await db.labs.get(labId), patient, 'lab entry', labId)
  const template = resolveLabTemplate(existing.templateId)
  const update: Partial<LabEntry> = {}
  if (input.results) update.results = applyLabValues(template, existing.results, input.results)
  if (input.note !== undefined) update.note = clean(input.note)
  if (input.date !== undefined) update.date = requireDate(input.date, existing.date)
  if (input.time !== undefined) update.time = requireTime(input.time, existing.time ?? toLocalTime())
  await db.labs.update(labId, update)
  await touchPatient(patient.id as number)
  return { summary: `Edited the ${template.name} entry of ${existing.date} for ${patientIdentifier(patient)}.`, patient }
}

// --- Checklist --------------------------------------------------------------------------------------------------

export type ChecklistTarget = { patient: Patient | null; date?: string }

const checklistLabel = (patient: Patient | null): string => (patient ? patientIdentifier(patient) : GENERAL_CHECKLIST_LABEL)

/** Reads and rewrites one day's checklist the way the Master Checklist does: today's entry if it
 * exists, otherwise a new one that carries forward the unfinished items of the latest earlier day. */
const editChecklist = async (target: ChecklistTarget, updater: (items: DailyUpdate['checklist']) => DailyUpdate['checklist']): Promise<void> => {
  const patientId = target.patient ? (target.patient.id as number) : GENERAL_CHECKLIST_PATIENT_ID
  const date = requireDate(target.date, toLocalISODate())
  const existing = await db.dailyUpdates.where('[patientId+date]').equals([patientId, date]).first()
  const latestPrior = selectLatestDailyUpdate((await db.dailyUpdates.where('patientId').equals(patientId).toArray()).filter((entry) => entry.date < date))
  const base = existing?.checklist ?? toPendingChecklistItems(latestPrior?.checklist)
  const next = normalizeChecklistItemsKeepingBlanks(updater(normalizeChecklistItemsKeepingBlanks(base)))

  if (existing) {
    await db.dailyUpdates.update(existing.id as number, { checklist: next, lastUpdated: nowIso() })
  } else {
    const masterProblems = await db.masterProblems.where('patientId').equals(patientId).toArray()
    await db.dailyUpdates.add({ patientId, date, ...buildCarriedForwardProblemFields(latestPrior, masterProblems, patientId), checklist: next, lastUpdated: nowIso() })
  }
  if (target.patient) await touchPatient(patientId)
}

const currentChecklist = async (target: ChecklistTarget): Promise<DailyUpdate['checklist']> => {
  const patientId = target.patient ? (target.patient.id as number) : GENERAL_CHECKLIST_PATIENT_ID
  const date = requireDate(target.date, toLocalISODate())
  const existing = await db.dailyUpdates.where('[patientId+date]').equals([patientId, date]).first()
  const latestPrior = selectLatestDailyUpdate((await db.dailyUpdates.where('patientId').equals(patientId).toArray()).filter((entry) => entry.date < date))
  return normalizeChecklistItemsKeepingBlanks(existing?.checklist ?? toPendingChecklistItems(latestPrior?.checklist))
}

export type ItemRef = { index?: number; text?: string }

const pickItem = (items: DailyUpdate['checklist'], ref: ItemRef, where: string): number => {
  if (ref.index !== undefined) {
    if (!items[ref.index]) throw new ToolError(`${where} has no item at index ${ref.index}. It has ${items.length}.`)
    return ref.index
  }
  const wanted = lower(ref.text ?? '')
  if (!wanted) throw new ToolError('Say which item: its exact text or its index.')
  const matches = items.map((item, index) => ({ item, index })).filter(({ item }) => lower(item.text) === wanted)
  if (matches.length === 1) return matches[0].index
  const listing = items.map((item, index) => `${index}: ${item.text}`).join(' | ')
  throw new ToolError(matches.length === 0
    ? `No item in ${where} reads "${ref.text}". Items: ${listing || '(none)'}.`
    : `More than one item reads "${ref.text}" (indexes ${matches.map(({ index }) => index).join(', ')}). Use the index.`)
}

export const addChecklistItem = async (target: ChecklistTarget, text: string, notes?: string): Promise<Done> => {
  const itemText = clean(text)
  if (!itemText) throw new ToolError('The item needs some text.')
  const items = await currentChecklist(target)
  if (items.some((item) => lower(item.text) === lower(itemText))) throw new ToolError(`"${itemText}" is already on ${checklistLabel(target.patient)}'s checklist for that day.`)
  await editChecklist(target, (previous) => insertNewChecklistItem(previous, { text: itemText, completed: false, ...(clean(notes) ? { notes: clean(notes) } : {}) }))
  return { summary: `Added "${itemText}" to the checklist of ${checklistLabel(target.patient)}.`, patient: target.patient ?? undefined }
}

export const editChecklistItem = async (target: ChecklistTarget, ref: ItemRef, changes: { text?: string; notes?: string }): Promise<Done> => {
  const items = await currentChecklist(target)
  const index = pickItem(items, ref, `${checklistLabel(target.patient)}'s checklist`)
  const before = items[index]
  if (changes.text !== undefined && !clean(changes.text)) throw new ToolError('Use delete_checklist_item to remove an item; its text cannot be blank.')
  await editChecklist(target, (previous) => previous.map((item, position) => {
    if (position !== index) return item
    const notes = changes.notes !== undefined ? clean(changes.notes) : item.notes
    const { notes: _notes, ...rest } = item
    void _notes
    return { ...rest, text: changes.text !== undefined ? clean(changes.text) : item.text, ...(notes ? { notes } : {}) }
  }))
  return { summary: `Edited the checklist item "${before.text}" of ${checklistLabel(target.patient)}.`, patient: target.patient ?? undefined }
}

export const setChecklistItemDone = async (target: ChecklistTarget, ref: ItemRef, completed: boolean): Promise<Done> => {
  const items = await currentChecklist(target)
  const index = pickItem(items, ref, `${checklistLabel(target.patient)}'s checklist`)
  const item = items[index]
  if (item.completed === completed) return { summary: `"${item.text}" was already ${completed ? 'done' : 'open'} on the checklist of ${checklistLabel(target.patient)}.`, patient: target.patient ?? undefined }
  await editChecklist(target, (previous) => setChecklistItemCompletion(previous, index, completed))
  return { summary: `${completed ? 'Checked off' : 'Reopened'} "${item.text}" on the checklist of ${checklistLabel(target.patient)}.`, patient: target.patient ?? undefined }
}

export const deleteChecklistItem = async (target: ChecklistTarget, ref: ItemRef): Promise<Done> => {
  const items = await currentChecklist(target)
  const index = pickItem(items, ref, `${checklistLabel(target.patient)}'s checklist`)
  const item = items[index]
  await editChecklist(target, (previous) => previous.filter((_, position) => position !== index))
  return { summary: `Removed "${item.text}" from the checklist of ${checklistLabel(target.patient)}.`, patient: target.patient ?? undefined }
}

export const moveChecklistItem = async (target: ChecklistTarget, ref: ItemRef, placement: { before?: ItemRef; after?: ItemRef }): Promise<Done> => {
  const items = await currentChecklist(target)
  const where = `${checklistLabel(target.patient)}'s checklist`
  const from = pickItem(items, ref, where)
  const anchor = placement.before ?? placement.after
  if (!anchor || (placement.before && placement.after)) throw new ToolError('Say either before or after, with the item to place it next to.')
  const to = pickItem(items, anchor, where)
  if (from === to) throw new ToolError('An item cannot be placed next to itself.')
  await editChecklist(target, (previous) => reorderChecklistItems(previous, from, to, placement.before ? 'before' : 'after'))
  return { summary: `Moved "${items[from].text}" ${placement.before ? 'before' : 'after'} "${items[to].text}" on the checklist of ${checklistLabel(target.patient)}.`, patient: target.patient ?? undefined }
}

// --- Problems and daily notes ---------------------------------------------------------------------------------------

const resolveProblem = (world: World, patient: Patient, ref: { problemId?: number; title?: string }): MasterProblem => {
  const problems = world.masterProblems.filter((problem) => problem.patientId === patient.id)
  if (ref.problemId !== undefined) {
    const found = problems.find((problem) => problem.id === ref.problemId)
    if (!found) throw new ToolError(`${patientIdentifier(patient)} has no problem with id ${ref.problemId}.`)
    return found
  }
  const wanted = lower(ref.title ?? '')
  if (!wanted) throw new ToolError('Say which problem: a problemId or its exact title.')
  const matches = problems.filter((problem) => lower(problem.currentTitle) === wanted)
  if (matches.length === 1) return matches[0]
  throw new ToolError(matches.length === 0
    ? `${patientIdentifier(patient)} has no problem titled "${ref.title}". Problems: ${problems.map((problem) => `${problem.currentTitle} (id ${problem.id})`).join('; ') || '(none)'}.`
    : `More than one problem is titled "${ref.title}". Use problemId: ${matches.map((problem) => problem.id).join(', ')}.`)
}

/** The day's note row, created the way the Problems tab creates it when the day is first opened. */
const ensureDailyUpdate = async (patientId: number, date: string): Promise<DailyUpdate> => {
  const existing = await db.dailyUpdates.where('[patientId+date]').equals([patientId, date]).first()
  if (existing) return existing
  const problems = await db.masterProblems.where('patientId').equals(patientId).toArray()
  const latestPrior = selectLatestDailyUpdate((await db.dailyUpdates.where('patientId').equals(patientId).toArray()).filter((entry) => entry.date < date))
  const id = await db.dailyUpdates.add({
    patientId,
    date,
    ...buildCarriedForwardProblemFields(latestPrior, problems, patientId),
    checklist: toPendingChecklistItems(latestPrior?.checklist),
    lastUpdated: nowIso(),
  }) as number
  return (await db.dailyUpdates.get(id)) as DailyUpdate
}

/** Adds one master problem at the end of its siblings, and, like the Problems tab, shows it on the day that's open. */
const insertMasterProblem = async (patient: Patient, parentId: number | null, title: string, dateIdentified: string): Promise<number> => {
  const siblings = (await db.masterProblems.where('patientId').equals(patient.id as number).toArray()).filter((problem) => problem.parentId === parentId)
  const id = await db.masterProblems.add({
    patientId: patient.id as number,
    parentId,
    sortOrder: siblings.length,
    currentTitle: title,
    nameHistory: [],
    dateIdentified,
    status: 'active',
    dateResolved: null,
    resolutionNotes: '',
    mergedIntoId: null,
    createdAt: nowIso(),
  }) as number
  const daily = await ensureDailyUpdate(patient.id as number, toLocalISODate())
  if (!daily.problems.some((note) => note.masterProblemId === id)) {
    await db.dailyUpdates.update(daily.id as number, { problems: [...daily.problems, { masterProblemId: id, notes: '' }], lastUpdated: nowIso() })
  }
  return id
}

export const addProblem = async (world: World, patient: Patient, input: { title: string; parent?: { problemId?: number; title?: string }; dateIdentified?: string }): Promise<Done> => {
  const title = clean(input.title)
  if (!title) throw new ToolError('A problem needs a title.')
  const parent = input.parent && (input.parent.problemId !== undefined || input.parent.title) ? resolveProblem(world, patient, input.parent) : null
  if (parent?.parentId !== null && parent !== null) throw new ToolError('A sub-problem cannot have its own sub-problems.')
  await insertMasterProblem(patient, parent?.id ?? null, title, clean(input.dateIdentified))
  await touchPatient(patient.id as number)
  return { summary: `Added the problem "${title}"${parent ? ` under "${parent.currentTitle}"` : ''} for ${patientIdentifier(patient)}.`, patient }
}

export const editProblem = async (world: World, patient: Patient, ref: { problemId?: number; title?: string }, changes: { title?: string; dateIdentified?: string; resolutionNotes?: string }): Promise<Done> => {
  const problem = resolveProblem(world, patient, ref)
  const update: Partial<MasterProblem> = {}
  if (changes.title !== undefined) {
    const title = clean(changes.title)
    if (!title) throw new ToolError('The title cannot be blank.')
    if (title !== problem.currentTitle) {
      update.currentTitle = title
      // A rename is remembered, the way the Problems tab remembers one.
      if (problem.currentTitle.trim()) update.nameHistory = [...problem.nameHistory, { name: problem.currentTitle, changedAt: toLocalISODate() }]
    }
  }
  if (changes.dateIdentified !== undefined) update.dateIdentified = clean(changes.dateIdentified)
  if (changes.resolutionNotes !== undefined) update.resolutionNotes = clean(changes.resolutionNotes)
  await db.masterProblems.update(problem.id as number, update)
  await touchPatient(patient.id as number)
  return { summary: `Edited the problem "${problem.currentTitle}" of ${patientIdentifier(patient)}${update.currentTitle ? ` (now "${update.currentTitle}")` : ''}.`, patient }
}

export const setProblemStatus = async (world: World, patient: Patient, ref: { problemId?: number; title?: string }, input: { status: 'active' | 'resolved'; date?: string; resolutionNotes?: string; resolvedInto?: { problemId?: number; title?: string } }): Promise<Done> => {
  const problem = resolveProblem(world, patient, ref)
  if (input.status === 'active') {
    await db.masterProblems.update(problem.id as number, { status: 'active', dateResolved: null, resolutionNotes: '', mergedIntoId: null })
  } else {
    const into = input.resolvedInto && (input.resolvedInto.problemId !== undefined || input.resolvedInto.title) ? resolveProblem(world, patient, input.resolvedInto) : null
    await db.masterProblems.update(problem.id as number, { status: 'resolved', dateResolved: requireDate(input.date, toLocalISODate()), resolutionNotes: clean(input.resolutionNotes), mergedIntoId: into?.id ?? null })
  }
  await touchPatient(patient.id as number)
  return { summary: `${input.status === 'resolved' ? 'Resolved' : 'Reopened'} the problem "${problem.currentTitle}" of ${patientIdentifier(patient)}.`, patient }
}

export const reorderProblems = async (world: World, patient: Patient, input: { parent?: { problemId?: number; title?: string }; order: number[] }): Promise<Done> => {
  const parent = input.parent && (input.parent.problemId !== undefined || input.parent.title) ? resolveProblem(world, patient, input.parent) : null
  const siblings = world.masterProblems.filter((problem) => problem.patientId === patient.id && problem.parentId === (parent?.id ?? null))
  const expected = new Set(siblings.map((problem) => problem.id as number))
  if (input.order.length !== expected.size || !input.order.every((id) => expected.has(id)) || new Set(input.order).size !== input.order.length) {
    throw new ToolError(`The order must list exactly these problem ids once each: ${siblings.map((problem) => `${problem.id} (${problem.currentTitle})`).join('; ')}.`)
  }
  for (const [index, id] of input.order.entries()) await db.masterProblems.update(id, { sortOrder: index })
  await touchPatient(patient.id as number)
  return { summary: `Reordered the ${parent ? `sub-problems of "${parent.currentTitle}"` : 'problems'} of ${patientIdentifier(patient)}.`, patient }
}

export type DailyNoteInput = {
  date?: string
  subjective?: string
  objective?: string
  assessment?: string
  plans?: string
  problemNotes?: Array<{ problemId?: number; title?: string; notes: string }>
}

export const setDailyNote = async (world: World, patient: Patient, input: DailyNoteInput, appendText: boolean): Promise<Done> => {
  const date = requireDate(input.date, toLocalISODate())
  const daily = await ensureDailyUpdate(patient.id as number, date)
  const update: Partial<DailyUpdate> = {}
  const touched: string[] = []
  for (const key of ['subjective', 'objective', 'assessment', 'plans'] as const) {
    const incoming = input[key]
    if (incoming === undefined) continue
    update[key] = appendText && daily[key].trim() ? `${daily[key].replace(/\s+$/, '')}\n${incoming}` : incoming
    touched.push(key)
  }
  if (input.problemNotes?.length) {
    const problems = [...daily.problems]
    for (const entry of input.problemNotes) {
      const problem = resolveProblem(world, patient, { problemId: entry.problemId, title: entry.title })
      const index = problems.findIndex((note) => note.masterProblemId === problem.id)
      const previous = index >= 0 ? problems[index].notes : ''
      const notes = appendText && previous.trim() ? `${previous.replace(/\s+$/, '')}\n${entry.notes}` : entry.notes
      if (index >= 0) problems[index] = { ...problems[index], notes }
      else problems.push({ masterProblemId: problem.id as number, notes })
      touched.push(`note for ${problem.currentTitle}`)
    }
    update.problems = problems
  }
  if (touched.length === 0) throw new ToolError('Give at least one of subjective, objective, assessment, plans or problemNotes.')
  await db.dailyUpdates.update(daily.id as number, { ...update, lastUpdated: nowIso() })
  await touchPatient(patient.id as number)
  return { summary: `Updated the ${date} note of ${patientIdentifier(patient)}: ${touched.join(', ')}${appendText ? ' (added to existing text)' : ''}.`, patient }
}

// --- Saved views --------------------------------------------------------------------------------------------------------

const viewFields = (world: World, selection: PatientSelection): Pick<CustomView, 'tagIds' | 'tagMode' | 'wardTagIds' | 'sortConfig'> => ({
  tagIds: (selection.tags ?? []).map((name) => resolveTag(name, world).id as number),
  tagMode: selection.tagMode ?? 'OR',
  wardTagIds: (selection.wards ?? []).map((name) => resolveTag(name, world, WARD_TAG_GROUP_NAME).id as number),
  ...(selection.sort && selection.sort.length > 0 ? { sortConfig: resolveSort(selection, null, world) } : {}),
})

export const createView = async (world: World, input: { name: string } & PatientSelection): Promise<Done> => {
  const name = clean(input.name)
  if (!name) throw new ToolError('A view needs a name.')
  if (world.views.some((view) => lower(view.name) === lower(name))) throw new ToolError(`A saved view named "${name}" already exists.`)
  await db.customViews.add({ name, ...viewFields(world, input), sortOrder: world.views.length > 0 ? Math.max(...world.views.map((view) => view.sortOrder)) + 1 : 0, createdAt: nowIso() })
  return { summary: `Created the saved view "${name}".` }
}

export const updateView = async (world: World, name: string, input: PatientSelection & { newName?: string; enabled?: boolean }): Promise<Done> => {
  const view = resolveView(name, world)
  const update: Partial<CustomView> = {}
  if (input.newName !== undefined) {
    const next = clean(input.newName)
    if (!next) throw new ToolError('The new name cannot be blank.')
    if (world.views.some((other) => other.id !== view.id && lower(other.name) === lower(next))) throw new ToolError(`A saved view named "${next}" already exists.`)
    update.name = next
  }
  if (input.tags !== undefined || input.tagMode !== undefined || input.wards !== undefined || input.sort !== undefined) {
    const fields = viewFields(world, {
      tags: input.tags ?? view.tagIds.map((id) => world.tagsById.get(id)?.name ?? ''),
      tagMode: input.tagMode ?? view.tagMode,
      wards: input.wards ?? view.wardTagIds.map((id) => world.tagsById.get(id)?.name ?? ''),
      sort: input.sort,
    })
    Object.assign(update, { tagIds: fields.tagIds, tagMode: fields.tagMode, wardTagIds: fields.wardTagIds })
    if (input.sort !== undefined) update.sortConfig = fields.sortConfig
  }
  if (input.enabled !== undefined) update.disabled = !input.enabled
  await db.customViews.update(view.id as number, update)
  return { summary: `Updated the saved view "${view.name}".` }
}

// --- Templates (safe edits only) ------------------------------------------------------------------------------------

const resolveTemplateForEdit = (world: World, name: string): ReportTemplate => {
  const found = world.templates.filter((template) => lower(template.name) === lower(name))
  if (found.length !== 1) {
    throw new ToolError(found.length === 0
      ? `No template is named "${name}". Templates: ${world.templates.map((template) => template.name).join(', ')}.`
      : `More than one template is named "${name}".`)
  }
  return found[0]
}

export const duplicateTemplate = async (world: World, name: string, newName: string): Promise<Done> => {
  const source = resolveTemplateForEdit(world, name)
  const target = clean(newName)
  if (!target) throw new ToolError('The copy needs a name.')
  if (world.templates.some((template) => lower(template.name) === lower(target))) throw new ToolError(`A template named "${target}" already exists.`)
  const { id: _id, uid: _uid, updatedAt: _updatedAt, ...rest } = structuredClone(source)
  void _id; void _uid; void _updatedAt
  await db.reportTemplates.add({ ...rest, name: target, locked: false, sortOrder: Math.max(...world.templates.map((template) => template.sortOrder), -1) + 1, createdAt: nowIso() })
  return { summary: `Copied the template "${source.name}" as "${target}".` }
}

export const updateTemplate = async (world: World, name: string, changes: { newName?: string; enabled?: boolean; patternText?: string; headerPatternText?: string; footerPatternText?: string }): Promise<Done> => {
  const template = resolveTemplateForEdit(world, name)
  if (template.locked && (changes.newName !== undefined || changes.patternText !== undefined || changes.headerPatternText !== undefined || changes.footerPatternText !== undefined)) {
    throw new ToolError(`"${template.name}" is a built-in template whose format cannot be edited; it can only be switched on or off.`)
  }
  const update: Partial<ReportTemplate> = {}
  const checkTokens = (text: string, variables: Record<string, unknown>, where: string) => {
    for (const part of tokenizePatternText(text)) {
      if (part.type === 'variableRef' && !(part.id in variables)) {
        throw new ToolError(`The ${where} uses a variable that this template does not define. The caller can reorder or reword the literal text and reuse the template's existing variables, but cannot create new ones; add those in PUHRR.`)
      }
    }
  }
  if (changes.patternText !== undefined) { checkTokens(changes.patternText, template.variables, 'format'); update.patternText = changes.patternText }
  if (changes.headerPatternText !== undefined) { checkTokens(changes.headerPatternText, template.headerVariables, 'header'); update.headerPatternText = changes.headerPatternText }
  if (changes.footerPatternText !== undefined) { checkTokens(changes.footerPatternText, template.footerVariables, 'footer'); update.footerPatternText = changes.footerPatternText }
  if (changes.newName !== undefined) {
    const next = clean(changes.newName)
    if (!next) throw new ToolError('The new name cannot be blank.')
    if (world.templates.some((other) => other.id !== template.id && lower(other.name) === lower(next))) throw new ToolError(`A template named "${next}" already exists.`)
    update.name = next
  }
  if (changes.enabled !== undefined) update.disabled = !changes.enabled
  if (Object.keys(update).length === 0) throw new ToolError('Say what to change.')
  await db.reportTemplates.update(template.id as number, update)
  return { summary: `Updated the template "${template.name}": ${Object.keys(update).join(', ')}.` }
}

// --- Deleting (always confirmed first; see writeTools) --------------------------------------------------------------------

export type DeleteKind = 'patient' | 'vital' | 'lab' | 'medication' | 'order' | 'problem' | 'view' | 'template'

const PATIENT_TABLES = ['dailyUpdates', 'vitals', 'medications', 'labs', 'orders', 'tagEvents', 'masterProblems', 'simpleProblemItems'] as const

/** What a delete would remove, in words, and how to do it. Nothing is changed here. */
export const planDelete = async (world: World, input: { kind: DeleteKind; patient?: Patient; recordId?: number; name?: string }): Promise<{ summary: string; patient?: Patient; run: () => Promise<Done> }> => {
  const { kind, patient } = input
  const needPatient = (): Patient => {
    if (!patient) throw new ToolError('Say which patient (room and last name).')
    return patient
  }

  if (kind === 'patient') {
    const target = needPatient()
    const id = target.id as number
    const counts = await Promise.all(PATIENT_TABLES.map(async (table) => [table, await db.table(table).where('patientId').equals(id).count()] as const))
    const described = counts.filter(([, count]) => count > 0).map(([table, count]) => `${count} ${table}`).join(', ')
    return {
      summary: `Delete the patient ${patientIdentifier(target)} and everything recorded for them${described ? ` (${described})` : ''}.`,
      patient: target,
      run: async () => {
        for (const table of PATIENT_TABLES) await db.table(table).where('patientId').equals(id).delete()
        await db.patients.delete(id)
        return { summary: `Deleted the patient ${patientIdentifier(target)} and their records.`, patient: target }
      },
    }
  }

  if (kind === 'vital' || kind === 'lab' || kind === 'medication' || kind === 'order') {
    const target = needPatient()
    const table = ({ vital: 'vitals', lab: 'labs', medication: 'medications', order: 'orders' } as const)[kind]
    const record = ownedBy(await db.table<{ patientId: number } & Record<string, unknown>>(table).get(input.recordId ?? -1), target, kind, input.recordId ?? -1)
    const what = kind === 'vital' ? `the vitals entry of ${record.date} ${record.time}` : kind === 'lab' ? `the lab entry of ${record.date} (${record.templateId})` : kind === 'medication' ? `the medication ${String(record.medication)}` : `the order "${String(record.orderText)}"`
    return {
      summary: `Delete ${what} for ${patientIdentifier(target)}.`,
      patient: target,
      run: async () => {
        await db.table(table).delete(input.recordId as number)
        await touchPatient(target.id as number)
        return { summary: `Deleted ${what} for ${patientIdentifier(target)}.`, patient: target }
      },
    }
  }

  if (kind === 'problem') {
    const target = needPatient()
    const problem = resolveProblem(world, target, { problemId: input.recordId })
    const family = world.masterProblems.filter((candidate) => candidate.patientId === target.id && (candidate.id === problem.id || candidate.parentId === problem.id))
    return {
      summary: `Delete the problem "${problem.currentTitle}"${family.length > 1 ? ` and its ${family.length - 1} sub-problem(s)` : ''} for ${patientIdentifier(target)}, and remove it from their daily notes.`,
      patient: target,
      run: async () => {
        const ids = new Set(family.map((candidate) => candidate.id as number))
        await db.masterProblems.bulkDelete([...ids])
        for (const update of await db.dailyUpdates.where('patientId').equals(target.id as number).toArray()) {
          const kept = update.problems.filter((note) => !ids.has(note.masterProblemId))
          if (kept.length !== update.problems.length) await db.dailyUpdates.update(update.id as number, { problems: kept, lastUpdated: nowIso() })
        }
        for (const item of await db.simpleProblemItems.where('patientId').equals(target.id as number).toArray()) {
          const kept = item.groupedMasterProblemIds.filter((id) => !ids.has(id))
          if (kept.length !== item.groupedMasterProblemIds.length) await db.simpleProblemItems.update(item.id as number, { groupedMasterProblemIds: kept })
        }
        await touchPatient(target.id as number)
        return { summary: `Deleted the problem "${problem.currentTitle}" for ${patientIdentifier(target)}.`, patient: target }
      },
    }
  }

  if (kind === 'view') {
    const view = resolveView(input.name ?? '', world)
    return { summary: `Delete the saved view "${view.name}".`, run: async () => { await db.customViews.delete(view.id as number); return { summary: `Deleted the saved view "${view.name}".` } } }
  }

  const template = resolveTemplateForEdit(world, input.name ?? '')
  if (template.locked) throw new ToolError(`"${template.name}" is a built-in template and cannot be deleted.`)
  return { summary: `Delete the report template "${template.name}".`, run: async () => { await db.reportTemplates.delete(template.id as number); return { summary: `Deleted the template "${template.name}".` } } }
}

// --- Custom actions ------------------------------------------------------------------------------------------------

const tagNames = (world: World, ids: number[]): string[] => ids.map((id) => world.tagsById.get(id)?.name ?? `#${id}`)

const missingTagsHint = (world: World, patient: Patient, action: CustomAction): string => {
  const options = action.conditions.map((condition) => {
    const missing = condition.requiredTagIds.filter((id) => !(patient.tagIds ?? []).includes(id) && !(patient.mainServiceTagIds ?? []).includes(id) && !(patient.referralServiceTagIds ?? []).includes(id))
    return missing.length > 0 ? `needs ${tagNames(world, missing).join(' + ')}` : 'is limited to certain days'
  })
  return options.length > 0 ? ` Its conditions: ${options.join('; ')}.` : ''
}

/**
 * Presses a manual custom action's button, the way PUHRR does: a patient action adds its checklist items (and
 * those of every matching condition) to that patient's checklist for the date and applies its tag effects; a
 * general action does the same on the General checklist and, if it has a template, renders it. Items already on
 * the list are skipped, so running it twice adds nothing twice. When no condition matches the patient nothing
 * happens: the answer says which tags are missing, and the user decides whether to add one.
 */
export const runCustomAction = async (world: World, input: { action: CustomAction; patient: Patient | null; date?: string }): Promise<Done> => {
  const { action } = input
  if (action.disabled) throw new ToolError(`"${action.name}" is switched off in PUHRR.`)
  if (action.triggerType === 'automatic') {
    throw new ToolError(`"${action.name}" runs by itself when the tag ${tagNames(world, action.triggerTagId !== undefined ? [action.triggerTagId] : []).join('') || '(unset)'} is added to a patient (use set_tags). It has no button to press.`)
  }
  const date = requireDate(input.date, toLocalISODate())

  if (action.scope === 'patient') {
    if (!input.patient) throw new ToolError(`"${action.name}" is for one patient: give the room and last name.`)
    const patient = await freshPatient(input.patient.id as number)
    const matched = resolveMatchingConditions(patient, action)
    if (!actionHasApplicableEffect(action, matched)) {
      throw new ToolError(`"${action.name}" did nothing for ${formatPatientLabelForNotice(patient)}: no condition matches this patient.${missingTagsHint(world, patient, action)} Tell the user, and add a tag with set_tags only if they say so.`)
    }
    const target = { patient, date }
    const before = new Set((await currentChecklist(target)).map((item) => item.text))
    await applyCustomActionEffects(patient, action, matched, await freshTags(), (items) => appendChecklistItemsToPatientDate(patient.id as number, date, items))
    const after = await currentChecklist(target)
    const added = after.map((item) => item.text).filter((text) => !before.has(text))
    const afterPatient = await freshPatient(patient.id as number)
    const tagChange = [...(patient.tagIds ?? [])].sort().join() === [...(afterPatient.tagIds ?? [])].sort().join() ? '' : ' Tags were changed too.'
    return {
      summary: `Ran "${action.name}" for ${patientIdentifier(afterPatient)} (checklist of ${date}): ${added.length > 0 ? `added ${added.length} item(s): ${added.join('; ')}` : 'all its items were already on the list'}.${tagChange}`,
      patient: afterPatient,
    }
  }

  if (input.patient) throw new ToolError(`"${action.name}" is a General action: it takes no patient. Run it without room and last name.`)
  const matched = resolveMatchingGeneralConditions(action)
  const hasEffect = actionHasApplicableGeneralEffect(action, matched)
  const target = { patient: null, date }
  const before = new Set((await currentChecklist(target)).map((item) => item.text))
  if (hasEffect) await applyGeneralCustomActionEffects(action, matched, (items) => appendChecklistItemsForPatientDate(GENERAL_CHECKLIST_PATIENT_ID, date, items))
  const added = (await currentChecklist(target)).map((item) => item.text).filter((text) => !before.has(text))
  const checklistPart = !hasEffect
    ? `"${action.name}" has nothing to add today`
    : `Ran "${action.name}" (General checklist of ${date}): ${added.length > 0 ? `added ${added.length} item(s): ${added.join('; ')}` : 'all its items were already on the list'}`

  if (action.templateRunTemplateId === undefined) return { summary: `${checklistPart}.` }

  const fresh = await loadWorld()
  const template = resolveTemplate(fresh, { templateId: action.templateRunTemplateId })
  const rendered = renderReport(fresh, template, {
    tags: tagNames(fresh, action.templateRunFilterTagIds ?? []),
    tagMode: action.templateRunFilterTagMode ?? 'OR',
    wards: tagNames(fresh, action.templateRunFilterWardTagIds ?? []),
  })
  return {
    summary: `${checklistPart}. It also rendered the template "${template.name}" for ${rendered.patients.length} patient(s), using the action's saved filter.`,
    report: { template: template.name, patients: rendered.patients, text: rendered.text },
  }
}

// --- Simple problem list, and the whole problem lists in one go ------------------------------------------------------

export type SimpleRef = { itemId?: number; text?: string }

const simpleItemsOf = async (patientId: number): Promise<SimpleProblemItem[]> =>
  (await db.simpleProblemItems.where('patientId').equals(patientId).toArray()).sort((a, b) => a.sortOrder - b.sortOrder)

const pickSimpleItem = (items: SimpleProblemItem[], patient: Patient, ref: SimpleRef): SimpleProblemItem => {
  if (ref.itemId !== undefined) {
    const found = items.find((item) => item.id === ref.itemId)
    if (!found) throw new ToolError(`${patientIdentifier(patient)} has no simple-list item with id ${ref.itemId}.`)
    return found
  }
  const wanted = lower(ref.text ?? '')
  if (!wanted) throw new ToolError('Say which simple-list item: an itemId or its exact text.')
  const matches = items.filter((item) => lower(item.text) === wanted)
  if (matches.length === 1) return matches[0]
  const listing = items.map((item) => `${item.id}: ${item.text}`).join(' | ')
  throw new ToolError(matches.length === 0
    ? `No simple-list item reads "${ref.text}" for ${patientIdentifier(patient)}. Items: ${listing || '(none)'}.`
    : `More than one item reads "${ref.text}". Use itemId: ${matches.map((item) => item.id).join(', ')}.`)
}

const renumberSimpleItems = async (orderedIds: number[]): Promise<void> => {
  for (const [index, id] of orderedIds.entries()) await db.simpleProblemItems.update(id, { sortOrder: index })
}

export const addSimpleProblems = async (patient: Patient, texts: string[]): Promise<Done> => {
  const cleaned = texts.map(clean).filter((text) => text.length > 0)
  if (cleaned.length === 0) throw new ToolError('Give at least one line of text.')
  const existing = await simpleItemsOf(patient.id as number)
  const seen = new Set(existing.map((item) => lower(item.text)))
  const added: string[] = []
  const skipped: string[] = []
  let order = existing.length
  for (const text of cleaned) {
    if (seen.has(lower(text))) { skipped.push(text); continue }
    seen.add(lower(text))
    await db.simpleProblemItems.add({ patientId: patient.id as number, text, sortOrder: order++, groupedMasterProblemIds: [], createdAt: nowIso() })
    added.push(text)
  }
  if (added.length > 0) await touchPatient(patient.id as number)
  return {
    summary: `Simple problem list of ${patientIdentifier(patient)}: added ${added.length} line(s)${added.length ? ` (${added.join('; ')})` : ''}${skipped.length ? `; already on the list: ${skipped.join('; ')}` : ''}.`,
    patient,
  }
}

export const editSimpleProblem = async (patient: Patient, ref: SimpleRef, newText: string): Promise<Done> => {
  const item = pickSimpleItem(await simpleItemsOf(patient.id as number), patient, ref)
  const text = clean(newText)
  if (!text) throw new ToolError('The line cannot be blank. To remove it use delete_simple_problems.')
  await db.simpleProblemItems.update(item.id as number, { text })
  await touchPatient(patient.id as number)
  return { summary: `Simple problem list of ${patientIdentifier(patient)}: "${item.text}" is now "${text}".`, patient }
}

export const deleteSimpleProblems = async (patient: Patient, refs: SimpleRef[]): Promise<Done> => {
  if (refs.length === 0) throw new ToolError('Say which lines to remove.')
  const items = await simpleItemsOf(patient.id as number)
  const picked = refs.map((ref) => pickSimpleItem(items, patient, ref))
  const ids = new Set(picked.map((item) => item.id as number))
  await db.simpleProblemItems.bulkDelete([...ids])
  await renumberSimpleItems(items.filter((item) => !ids.has(item.id as number)).map((item) => item.id as number))
  await touchPatient(patient.id as number)
  return { summary: `Simple problem list of ${patientIdentifier(patient)}: removed ${picked.length} line(s) (${picked.map((item) => item.text).join('; ')}).`, patient }
}

export const reorderSimpleProblems = async (patient: Patient, order: number[]): Promise<Done> => {
  const items = await simpleItemsOf(patient.id as number)
  const ids = items.map((item) => item.id as number)
  const sameSet = order.length === ids.length && new Set(order).size === order.length && order.every((id) => ids.includes(id))
  if (!sameSet) throw new ToolError(`order must list every simple-list item id once. Items: ${items.map((item) => `${item.id}: ${item.text}`).join(' | ')}.`)
  await renumberSimpleItems(order)
  await touchPatient(patient.id as number)
  return { summary: `Simple problem list of ${patientIdentifier(patient)}: reordered.`, patient }
}

export const groupSimpleProblems = async (
  world: World,
  patient: Patient,
  refs: SimpleRef[],
  problemRef: { problemId?: number; title?: string },
  action: 'group' | 'ungroup',
): Promise<Done> => {
  if (refs.length === 0) throw new ToolError('Say which simple-list lines.')
  const problem = resolveProblem(world, patient, problemRef)
  if (action === 'group' && problem.status !== 'active') throw new ToolError(`"${problem.currentTitle}" is resolved: only active problems can have lines grouped under them.`)
  const items = await simpleItemsOf(patient.id as number)
  const picked = refs.map((ref) => pickSimpleItem(items, patient, ref))
  const changed: string[] = []
  for (const item of picked) {
    const has = item.groupedMasterProblemIds.includes(problem.id as number)
    if (action === 'group' && !has) {
      await db.simpleProblemItems.update(item.id as number, { groupedMasterProblemIds: [...item.groupedMasterProblemIds, problem.id as number] })
      changed.push(item.text)
    } else if (action === 'ungroup' && has) {
      await db.simpleProblemItems.update(item.id as number, { groupedMasterProblemIds: item.groupedMasterProblemIds.filter((id) => id !== problem.id) })
      changed.push(item.text)
    }
  }
  if (changed.length > 0) await touchPatient(patient.id as number)
  const verb = action === 'group' ? 'grouped under' : 'taken out of'
  return {
    summary: `${patientIdentifier(patient)}: ${changed.length ? `${changed.length} simple-list line(s) ${verb} "${problem.currentTitle}" (${changed.join('; ')})` : `nothing to change, those lines were already ${action === 'group' ? 'under' : 'not under'} "${problem.currentTitle}"`}.`,
    patient,
  }
}

export type ProblemSpec = {
  title: string
  dateIdentified?: string
  items?: string[]
  subProblems?: Array<{ title: string; dateIdentified?: string; items?: string[] }>
}

/**
 * The approved package in one change: the simple problem list lines, the master problems (and sub-problems) with
 * their dates, and which lines are grouped under which problem. Lines and problems that already exist (same text /
 * same title and parent, problem still active) are reused, never doubled.
 */
export const createProblemLists = async (patient: Patient, input: { simpleItems?: string[]; problems: ProblemSpec[] }): Promise<Done> => {
  const patientId = patient.id as number
  if (input.problems.length === 0 && (input.simpleItems ?? []).length === 0) throw new ToolError('Give simple-list lines and/or problems.')
  for (const spec of input.problems) {
    if (!clean(spec.title)) throw new ToolError('Every problem needs a title.')
    for (const sub of spec.subProblems ?? []) if (!clean(sub.title)) throw new ToolError(`A sub-problem of "${spec.title}" has no title.`)
  }

  // 1. Simple-list lines: the ones asked for, then any line only mentioned under a problem.
  const mentioned = input.problems.flatMap((spec) => [...(spec.items ?? []), ...(spec.subProblems ?? []).flatMap((sub) => sub.items ?? [])])
  const texts = [...(input.simpleItems ?? []), ...mentioned].map(clean).filter((text) => text.length > 0)
  const existing = await simpleItemsOf(patientId)
  const idByText = new Map(existing.map((item) => [lower(item.text), item.id as number]))
  const groups = new Map(existing.map((item) => [item.id as number, new Set(item.groupedMasterProblemIds)]))
  let order = existing.length
  let linesAdded = 0
  for (const text of texts) {
    if (idByText.has(lower(text))) continue
    const id = await db.simpleProblemItems.add({ patientId, text, sortOrder: order++, groupedMasterProblemIds: [], createdAt: nowIso() }) as number
    idByText.set(lower(text), id)
    groups.set(id, new Set())
    linesAdded += 1
  }

  // 2. Problems and sub-problems, 3. grouping.
  const findActive = async (parentId: number | null, title: string): Promise<number | null> => {
    const found = (await db.masterProblems.where('patientId').equals(patientId).toArray())
      .find((problem) => problem.parentId === parentId && problem.status === 'active' && lower(problem.currentTitle) === lower(title))
    return found ? (found.id as number) : null
  }
  const groupUnder = (problemId: number, items: string[] | undefined) => {
    for (const text of items ?? []) {
      const itemId = idByText.get(lower(clean(text)))
      if (itemId !== undefined) groups.get(itemId)?.add(problemId)
    }
  }
  let problemsAdded = 0
  let reused = 0
  for (const spec of input.problems) {
    const title = clean(spec.title)
    let problemId = await findActive(null, title)
    if (problemId === null) { problemId = await insertMasterProblem(patient, null, title, clean(spec.dateIdentified)); problemsAdded += 1 } else reused += 1
    groupUnder(problemId, spec.items)
    for (const sub of spec.subProblems ?? []) {
      const subTitle = clean(sub.title)
      let subId = await findActive(problemId, subTitle)
      if (subId === null) { subId = await insertMasterProblem(patient, problemId, subTitle, clean(sub.dateIdentified)); problemsAdded += 1 } else reused += 1
      groupUnder(subId, sub.items)
    }
  }
  for (const [itemId, ids] of groups) {
    const before = existing.find((item) => item.id === itemId)?.groupedMasterProblemIds ?? []
    if (ids.size !== before.length || [...ids].some((id) => !before.includes(id))) await db.simpleProblemItems.update(itemId, { groupedMasterProblemIds: [...ids] })
  }
  await touchPatient(patientId)

  // Read it back the way the Problems tab numbers it.
  const problems = await db.masterProblems.where('patientId').equals(patientId).toArray()
  const labels = buildMasterProblemLabels(problems)
  const lines = (await simpleItemsOf(patientId)).filter((item) => item.groupedMasterProblemIds.length > 0)
  const tree = problems
    .filter((problem) => problem.status === 'active')
    .sort((a, b) => (labels.get(a.id as number) ?? '').localeCompare(labels.get(b.id as number) ?? '', undefined, { numeric: true }))
    .map((problem) => {
      const under = lines.filter((item) => item.groupedMasterProblemIds.includes(problem.id as number)).map((item) => item.text)
      return `${labels.get(problem.id as number)}. ${problem.currentTitle}${problem.dateIdentified ? ` (${problem.dateIdentified})` : ''}${under.length ? `: ${under.join('; ')}` : ''}`
    })
  return {
    summary: `${patientIdentifier(patient)}: ${linesAdded} simple-list line(s) added, ${problemsAdded} problem(s) added${reused ? `, ${reused} already existed and were reused` : ''}. Problem list now: ${tree.join(' | ')}`,
    patient,
  }
}
