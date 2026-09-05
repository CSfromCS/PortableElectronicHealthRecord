import Dexie, { type EntityTable } from 'dexie'
import { normalizeDailyUpdate } from './features/problems/problemUtils'
import { DEFAULT_TAG_GROUP_NAMES, DEFAULT_TAG_SEEDS, SERVICE_TAG_GROUP_NAME } from './features/tags/tagConstants'
import { parseLegacyServiceText } from './features/tags/serviceTagParsing'
import { seedDefaultCustomActions } from './features/customActions/customActionConstants'
import { splitCombinedRoomValue } from './lib/roomSplit'
import { buildDefaultDateTimeFormats, buildDefaultReportTemplates, buildLockedLabsTemplate } from './features/templates/templateDefaults'
import { buildDefaultBlockVariableConfig } from './features/templates/templateEngine'
import type {
  BlockVariableConfig,
  BlockVariableId,
  CustomAction,
  CustomActionRun,
  DailyUpdate,
  DateTimeFormatDefinition,
  FlatVariableId,
  LabEntry,
  MedicationEntry,
  OrderEntry,
  Patient,
  PhotoAttachment,
  ProblemBlock,
  ReportTemplate,
  TagDefinition,
  TagEvent,
  TagGroupDefinition,
  TagsVariableConfig,
  TemplateVariableInstance,
  VitalEntry,
} from './types'

void Dexie.delete('roundingAppDatabase').catch(() => undefined)

const db = new Dexie('roundingAppDatabase_v1') as Dexie & {
  patients: EntityTable<Patient, 'id'>
  dailyUpdates: EntityTable<DailyUpdate, 'id'>
  vitals: EntityTable<VitalEntry, 'id'>
  medications: EntityTable<MedicationEntry, 'id'>
  labs: EntityTable<LabEntry, 'id'>
  orders: EntityTable<OrderEntry, 'id'>
  photoAttachments: EntityTable<PhotoAttachment, 'id'>
  tagGroups: EntityTable<TagGroupDefinition, 'id'>
  tagDefinitions: EntityTable<TagDefinition, 'id'>
  tagEvents: EntityTable<TagEvent, 'id'>
  customActions: EntityTable<CustomAction, 'id'>
  customActionRuns: EntityTable<CustomActionRun, 'id'>
  reportTemplates: EntityTable<ReportTemplate, 'id'>
  dateTimeFormats: EntityTable<DateTimeFormatDefinition, 'id'>
}

db.version(1).stores({
  patients: '++id, lastName, roomNumber, service, status, admitDate',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments: '++id, patientId, category, [patientId+category], createdAt',
})

db.version(2).stores({
  patients: '++id, lastName, roomNumber, service, status, admitDate',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments: '++id, patientId, category, [patientId+category], createdAt',
}).upgrade(async (tx) => {
  const medicationTable = tx.table<MedicationEntry, number>('medications')
  const existingMedications = await medicationTable.toArray()
  const groupedByPatient = new Map<number, MedicationEntry[]>()

  existingMedications.forEach((entry) => {
    if (entry.id === undefined) return
    const list = groupedByPatient.get(entry.patientId) ?? []
    list.push(entry)
    groupedByPatient.set(entry.patientId, list)
  })

  const updates: Promise<number>[] = []
  groupedByPatient.forEach((entries) => {
    entries.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'active' ? -1 : 1
      }
      if (a.createdAt !== b.createdAt) {
        return b.createdAt.localeCompare(a.createdAt)
      }
      return (a.id ?? 0) - (b.id ?? 0)
    })

    entries.forEach((entry, index) => {
      if (entry.id === undefined) return
      updates.push(medicationTable.update(entry.id, { sortOrder: index }))
    })
  })

  await Promise.all(updates)
})

db.version(3).stores({
  patients: '++id, lastName, roomNumber, service, status, admitDate',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
})

db.version(4).stores({
  patients: '++id, lastName, roomNumber, service, status, admitDate',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
}).upgrade(async (tx) => {
  const dailyUpdateTable = tx.table<DailyUpdate, number>('dailyUpdates')
  const photoTable = tx.table<PhotoAttachment, number>('photoAttachments')
  const dailyUpdates = await dailyUpdateTable.toArray()
  const photos = await photoTable.toArray()

  await Promise.all(dailyUpdates.map((entry) => dailyUpdateTable.put(normalizeDailyUpdate(entry))))
  await Promise.all(photos.map((entry) => {
    if ((entry.category as string) !== 'frichmond') return Promise.resolve(entry.id ?? 0)
    return photoTable.put({ ...entry, category: 'problems' })
  }))
})

const seedDefaultTagGroupsAndTags = async (
  addGroup: (group: TagGroupDefinition) => Promise<number>,
  addTag: (tag: TagDefinition) => Promise<number>,
): Promise<Map<string, number>> => {
  const now = new Date().toISOString()
  const groupIdByName = new Map<string, number>()
  for (let index = 0; index < DEFAULT_TAG_GROUP_NAMES.length; index += 1) {
    const name = DEFAULT_TAG_GROUP_NAMES[index]
    const id = await addGroup({ name, sortOrder: index })
    groupIdByName.set(name, id)
  }

  const tagIdByName = new Map<string, number>()
  for (let index = 0; index < DEFAULT_TAG_SEEDS.length; index += 1) {
    const seed = DEFAULT_TAG_SEEDS[index]
    const id = await addTag({
      name: seed.name,
      displayType: seed.displayType,
      groupId: groupIdByName.get(seed.group),
      sortOrder: index,
      visibleOnPatientCard: true,
      terminal: seed.terminal,
      automationRole: seed.automationRole,
      createdAt: now,
    })
    tagIdByName.set(seed.name, id)
  }

  return tagIdByName
}

// Seeds default tag groups/tags/custom actions for brand-new installs. Dexie only runs
// version().upgrade() callbacks when migrating an existing database — a fresh IndexedDB is
// created directly at the latest schema version, so first-time installs need this separate
// 'populate' hook instead.
db.on('populate', async () => {
  const tagIdByName = await seedDefaultTagGroupsAndTags(
    (group) => db.tagGroups.add(group) as Promise<number>,
    (tag) => db.tagDefinitions.add(tag) as Promise<number>,
  )
  await seedDefaultCustomActions(tagIdByName, (action) => db.customActions.add(action) as Promise<number>)
  const now = new Date().toISOString()
  await db.reportTemplates.bulkAdd(buildDefaultReportTemplates(now))
  await db.reportTemplates.add(buildLockedLabsTemplate(now, 2))
  await db.dateTimeFormats.bulkAdd(buildDefaultDateTimeFormats(now))
})

db.version(5).stores({
  patients: '++id, lastName, roomNumber, service, admitDate, *tagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
}).upgrade(async (tx) => {
  const tagGroupTable = tx.table<TagGroupDefinition, number>('tagGroups')
  const tagDefinitionTable = tx.table<TagDefinition, number>('tagDefinitions')
  const tagEventTable = tx.table<TagEvent, number>('tagEvents')
  const patientTable = tx.table<Patient, number>('patients')
  const now = new Date().toISOString()

  const tagIdByName = await seedDefaultTagGroupsAndTags(
    (group) => tagGroupTable.add(group),
    (tag) => tagDefinitionTable.add(tag),
  )
  const dischargedTagId = tagIdByName.get('Discharged')
  const legacyPatients = await patientTable.toArray()

  for (const patient of legacyPatients) {
    if (patient.id === undefined) continue
    const legacy = patient as Patient & { status?: string; dischargeDate?: string }
    const tagIds: number[] = []

    if (legacy.status === 'discharged' && dischargedTagId !== undefined) {
      tagIds.push(dischargedTagId)
      await tagEventTable.add({
        patientId: patient.id,
        tagId: dischargedTagId,
        tagName: 'Discharged',
        action: 'added',
        at: legacy.dischargeDate ?? legacy.lastModified ?? now,
      })
    }

    delete legacy.status
    delete legacy.dischargeDate
    await patientTable.put({ ...legacy, tagIds })
  }
})

db.version(6).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
}).upgrade(async (tx) => {
  // Adds Admission Date/Referral Date editability, splits the combined Room field into Room
  // Number + Ward/Location, and replaces the free-text Service field (line 1 = Main, rest =
  // Referrals) with tags in a "Service" Tag Group. See issue #67.
  const tagGroupTable = tx.table<TagGroupDefinition, number>('tagGroups')
  const tagDefinitionTable = tx.table<TagDefinition, number>('tagDefinitions')
  const patientTable = tx.table<Patient, number>('patients')

  const existingGroups = await tagGroupTable.toArray()
  let serviceGroupId = existingGroups.find((group) => group.name === SERVICE_TAG_GROUP_NAME)?.id
  if (serviceGroupId === undefined) {
    // Already created by the v5 upgrade above (which now seeds 'Service' too) unless this
    // database was already at v5 before that group existed — create it if still missing.
    const nextSortOrder = existingGroups.length > 0 ? Math.max(...existingGroups.map((group) => group.sortOrder)) + 1 : 0
    serviceGroupId = await tagGroupTable.add({ name: SERVICE_TAG_GROUP_NAME, sortOrder: nextSortOrder })
  }
  const resolvedServiceGroupId = serviceGroupId

  const serviceTags = await tagDefinitionTable.where('groupId').equals(resolvedServiceGroupId).toArray()
  const tagIdByLowerName = new Map<string, number>(
    serviceTags.filter((tag) => tag.id !== undefined).map((tag) => [tag.name.trim().toLowerCase(), tag.id as number]),
  )
  let nextTagSortOrder = serviceTags.length > 0 ? Math.max(...serviceTags.map((tag) => tag.sortOrder)) + 1 : 0

  const getOrCreateTagId = async (name: string): Promise<number> => {
    const key = name.trim().toLowerCase()
    const existingId = tagIdByLowerName.get(key)
    if (existingId !== undefined) return existingId

    const id = await tagDefinitionTable.add({
      name: name.trim(),
      displayType: 'color',
      color: '#8aa4bd',
      groupId: resolvedServiceGroupId,
      sortOrder: nextTagSortOrder,
      visibleOnPatientCard: false,
      terminal: false,
      automationRole: 'none',
      createdAt: new Date().toISOString(),
    })
    nextTagSortOrder += 1
    tagIdByLowerName.set(key, id)
    return id
  }

  const legacyPatients = await patientTable.toArray()
  for (const patient of legacyPatients) {
    if (patient.id === undefined) continue
    const legacy = patient as Patient & { service?: string }

    const { mainNames, referralNames } = parseLegacyServiceText(legacy.service ?? '')
    const mainServiceTagIds: number[] = []
    for (const name of mainNames) {
      const tagId = await getOrCreateTagId(name)
      if (!mainServiceTagIds.includes(tagId)) mainServiceTagIds.push(tagId)
    }
    const referralServiceTagIds: number[] = []
    for (const name of referralNames) {
      const tagId = await getOrCreateTagId(name)
      if (!referralServiceTagIds.includes(tagId)) referralServiceTagIds.push(tagId)
    }

    const roomSplit = splitCombinedRoomValue(legacy.roomNumber ?? '')

    delete legacy.service
    await patientTable.put({
      ...legacy,
      roomNumber: roomSplit.roomNumber,
      ward: roomSplit.ward,
      roomLegacyRaw: roomSplit.roomLegacyRaw,
      referralDate: legacy.admitDate,
      mainServiceTagIds,
      referralServiceTagIds,
    })
  }
})

db.version(7).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
}).upgrade(async (tx) => {
  // Splits the Profile tab into Profile + Database: Chief Complaint, HPI, PMH, PE, and Clerk
  // notes merge into one unstructured `database` field so no existing text is lost. See issue #70.
  const patientTable = tx.table<Patient, number>('patients')
  const dailyUpdateTable = tx.table<DailyUpdate, number>('dailyUpdates')

  const legacyPatients = await patientTable.toArray()
  for (const patient of legacyPatients) {
    if (patient.id === undefined) continue
    const legacy = patient as Patient & {
      chiefComplaint?: string
      hpiText?: string
      pmhText?: string
      peText?: string
      clerkNotes?: string
    }

    const database = [
      legacy.chiefComplaint?.trim() ? `Chief Complaint:\n${legacy.chiefComplaint.trim()}` : '',
      legacy.hpiText?.trim() ? `History of Present Illness:\n${legacy.hpiText.trim()}` : '',
      legacy.pmhText?.trim() ? `Past Medical History:\n${legacy.pmhText.trim()}` : '',
      legacy.peText?.trim() ? `Physical Examination:\n${legacy.peText.trim()}` : '',
      legacy.clerkNotes?.trim() ? `Clerk Notes:\n${legacy.clerkNotes.trim()}` : '',
    ].filter(Boolean).join('\n\n')

    delete legacy.chiefComplaint
    delete legacy.hpiText
    delete legacy.pmhText
    delete legacy.peText
    delete legacy.clerkNotes
    await patientTable.put({ ...legacy, database })
  }

  // Problems now carry an explicit `completed` flag (default false) so they can roll forward
  // per-date the same way Checklist items already do.
  const dailyUpdates = await dailyUpdateTable.toArray()
  await Promise.all(dailyUpdates.map((entry) => {
    if (entry.id === undefined) return Promise.resolve()
    const problems = entry.problems.map((problem) => ({ ...problem, completed: Boolean((problem as ProblemBlock).completed) }))
    return dailyUpdateTable.update(entry.id, { problems })
  }))
})

db.version(8).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
}).upgrade(async (tx) => {
  // Last names are now encoded in all caps by default (new entries are uppercased as typed) —
  // uppercase existing records too so the whole app is consistent.
  const patientTable = tx.table<Patient, number>('patients')
  const patients = await patientTable.toArray()
  await Promise.all(patients.map((patient) => {
    if (patient.id === undefined) return Promise.resolve()
    const uppercased = patient.lastName.toUpperCase()
    if (uppercased === patient.lastName) return Promise.resolve()
    return patientTable.update(patient.id, { lastName: uppercased })
  }))
})

db.version(9).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
}).upgrade(async (tx) => {
  // Patients now carry a `createdAt` timestamp, used as the computed default for Admission Date
  // and Referral Date (mirroring Discharge Date's existing computed-default pattern). Existing
  // records never captured a true creation time, so backfill with the best available proxy.
  const patientTable = tx.table<Patient, number>('patients')
  const patients = await patientTable.toArray()
  await Promise.all(patients.map((patient) => {
    if (patient.id === undefined) return Promise.resolve()
    const createdAt = patient.admitDate ? new Date(patient.admitDate).toISOString() : (patient.lastModified ?? new Date().toISOString())
    return patientTable.update(patient.id, { createdAt })
  }))
})

db.version(10).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
}).upgrade(async (tx) => {
  // Adds the general Custom Action system (issue #75): configurable named actions that append
  // checklist items scoped by Category/Relationship tags and/or add/remove tags, fired manually
  // or automatically when a chosen tag is newly applied. Pre-populate the same defaults a fresh
  // install gets, using this existing database's own tag definitions.
  const tagDefinitionTable = tx.table<TagDefinition, number>('tagDefinitions')
  const customActionTable = tx.table<CustomAction, number>('customActions')
  const existingTags = await tagDefinitionTable.toArray()
  const tagIdByName = new Map<string, number>(
    existingTags.filter((tag) => tag.id !== undefined).map((tag) => [tag.name, tag.id as number]),
  )
  await seedDefaultCustomActions(tagIdByName, (action) => customActionTable.add(action))
})

db.version(11).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
}).upgrade(async (tx) => {
  // Replaces the fixed CD/PD x Main/Referral Task List Variants with free-form Conditions: each
  // one names an arbitrary combination of required tags (general or Service) plus its own
  // checklist items and Tag Effects, so several can match — or none match — a given patient. The
  // v10 schema shipped only within this same unreleased feature, so rather than hand-translating
  // its fixed-variant shape, just re-seed the same defaults in the new shape.
  const tagDefinitionTable = tx.table<TagDefinition, number>('tagDefinitions')
  const customActionTable = tx.table<CustomAction, number>('customActions')
  const customActionRunTable = tx.table<CustomActionRun, number>('customActionRuns')

  await customActionRunTable.clear()
  await customActionTable.clear()

  const existingTags = await tagDefinitionTable.toArray()
  const tagIdByName = new Map<string, number>(
    existingTags.filter((tag) => tag.id !== undefined).map((tag) => [tag.name, tag.id as number]),
  )
  await seedDefaultCustomActions(tagIdByName, (action) => customActionTable.add(action))
})

db.version(12).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
}).upgrade(async (tx) => {
  // Adds an unconditional checklistItems/tagEffects pair directly on the action, alongside its
  // (now optional) Conditions — so an action can "apply uniformly to any patient" with zero
  // conditions defined, rather than needing a workaround empty-required-tags condition. The v11
  // schema shipped only within this same unreleased feature, so re-seed the same defaults in the
  // new shape rather than hand-translating existing rows.
  const tagDefinitionTable = tx.table<TagDefinition, number>('tagDefinitions')
  const customActionTable = tx.table<CustomAction, number>('customActions')
  const customActionRunTable = tx.table<CustomActionRun, number>('customActionRuns')

  await customActionRunTable.clear()
  await customActionTable.clear()

  const existingTags = await tagDefinitionTable.toArray()
  const tagIdByName = new Map<string, number>(
    existingTags.filter((tag) => tag.id !== undefined).map((tag) => [tag.name, tag.id as number]),
  )
  await seedDefaultCustomActions(tagIdByName, (action) => customActionTable.add(action))
})

db.version(13).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
}).upgrade(async (tx) => {
  // Adds `isDefaultTitle`, tracking whether a photo batch's title is still the auto-generated
  // default (drives same-day collision lettering going forward). Every pre-existing batch was
  // titled under the old "Category-YYYY-MM-DD-HH:MM:SS" scheme, which the new collision logic
  // never generates or matches, so backfilling them as `false` (never touched by relettering)
  // is correct regardless of whether that old title was later hand-edited.
  const photoAttachmentTable = tx.table<PhotoAttachment, number>('photoAttachments')
  await photoAttachmentTable.toCollection().modify({ isDefaultTitle: false })
})

db.version(14).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
}).upgrade(async (tx) => {
  // Adds `scope` (issue #120) — every pre-existing Custom Action was authored before General
  // (non-patient) actions existed, so they're all "patient"-scoped by definition.
  const customActionTable = tx.table<CustomAction, number>('customActions')
  await customActionTable.toCollection().modify({ scope: 'patient' })
})

db.version(15).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
}).upgrade(async (tx) => {
  // Adds Admission/Referral/Discharge Time (paired with their existing dates, same
  // blank-shows-a-computed-default behavior), and replaces the single free-text `diagnosis` field
  // with per-service Admission/Discharge Diagnosis. Existing diagnosis text is carried into
  // Admission Diagnosis: under the patient's first Main service if one is assigned, else their
  // first Referral service, else as an "unassigned" line (shown only while the patient has no
  // services at all). Discharge Diagnosis starts empty for every existing patient — the old field
  // never distinguished an admission diagnosis from a discharge one.
  const patientTable = tx.table<Patient, number>('patients')
  const legacyPatients = await patientTable.toArray()

  for (const patient of legacyPatients) {
    if (patient.id === undefined) continue
    const legacy = patient as Patient & { diagnosis?: string }
    const oldDiagnosis = (legacy.diagnosis ?? '').trim()

    let admissionDiagnosisUnassigned = ''
    let admissionDiagnosisByService: Record<number, string> = {}
    if (oldDiagnosis) {
      if (legacy.mainServiceTagIds.length > 0) {
        admissionDiagnosisByService = { [legacy.mainServiceTagIds[0]]: oldDiagnosis }
      } else if (legacy.referralServiceTagIds.length > 0) {
        admissionDiagnosisByService = { [legacy.referralServiceTagIds[0]]: oldDiagnosis }
      } else {
        admissionDiagnosisUnassigned = oldDiagnosis
      }
    }

    delete legacy.diagnosis
    await patientTable.put({
      ...legacy,
      admitTime: '',
      referralTime: '',
      dischargeTime: '',
      admissionDiagnosisUnassigned,
      admissionDiagnosisByService,
      dischargeDiagnosisUnassigned: '',
      dischargeDiagnosisByService: {},
    })
  }
})

db.version(16).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
  reportTemplates: '++id, sortOrder',
}).upgrade(async (tx) => {
  // Issue #82: user-defined, savable report templates, replacing the Reporting tab's fixed export
  // formats. Pre-populate the same two example templates ("Full Census", "Short List") a fresh
  // install gets, since an existing database never had any.
  const reportTemplateTable = tx.table<ReportTemplate, number>('reportTemplates')
  await reportTemplateTable.bulkAdd(buildDefaultReportTemplates(new Date().toISOString()))
})

type LegacyTemplateSegment =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'lineBreak' }
  | { id: string; type: 'flatVariable'; variableId: string }
  | { id: string; type: 'blockVariable'; variableId: string; config: unknown }
  | { id: string; type: 'tagsVariable'; config: unknown }

db.version(17).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
  reportTemplates: '++id, sortOrder',
}).upgrade(async (tx) => {
  // Replaces the Format Pattern's array-of-segments shape with a single freeform text string
  // carrying `{{var:<id>}}` placeholder tokens, so the editor can be a real type-anywhere text
  // field (with inline variable "chips") instead of a list of discrete, reorderable rows. Each
  // segment's own id is reused verbatim as its token id, so no data is renumbered — just
  // reshaped: text/lineBreak segments become literal characters, variable segments become a
  // token plus an entry in the new `variables` map.
  const reportTemplateTable = tx.table<ReportTemplate & { segments?: LegacyTemplateSegment[] }, number>('reportTemplates')
  const legacyRows = await reportTemplateTable.toArray()

  for (const row of legacyRows) {
    if (row.id === undefined || !Array.isArray(row.segments)) continue

    const variables: Record<string, TemplateVariableInstance> = {}
    const parts: string[] = []
    for (const segment of row.segments) {
      if (segment.type === 'text') {
        parts.push(segment.text)
      } else if (segment.type === 'lineBreak') {
        parts.push('\n')
      } else if (segment.type === 'flatVariable') {
        variables[segment.id] = { kind: 'flat', variableId: segment.variableId as FlatVariableId }
        parts.push(`{{var:${segment.id}}}`)
      } else if (segment.type === 'blockVariable') {
        variables[segment.id] = {
          kind: 'block',
          variableId: segment.variableId as BlockVariableId,
          config: segment.config as BlockVariableConfig,
        }
        parts.push(`{{var:${segment.id}}}`)
      } else if (segment.type === 'tagsVariable') {
        variables[segment.id] = { kind: 'tags', config: segment.config as TagsVariableConfig }
        parts.push(`{{var:${segment.id}}}`)
      }
    }

    await reportTemplateTable.update(row.id, {
      patternText: parts.join(''),
      variables,
    })
  }
})

db.version(18).stores({
  patients:
    '++id, lastName, roomNumber, admitDate, referralDate, *tagIds, *mainServiceTagIds, *referralServiceTagIds',
  dailyUpdates: '++id, patientId, date, [patientId+date]',
  vitals: '++id, patientId, date, [patientId+date], time',
  medications: '++id, patientId, sortOrder, [patientId+sortOrder], medication, status, [patientId+status], createdAt',
  labs: '++id, patientId, date, templateId, [patientId+date], [patientId+templateId], createdAt',
  orders: '++id, patientId, status, [patientId+status], createdAt',
  photoAttachments:
    '++id, patientId, category, [patientId+category], createdAt, uploadGroupId, selectionOrderInGroup, [uploadGroupId+selectionOrderInGroup]',
  tagGroups: '++id, sortOrder',
  tagDefinitions: '++id, groupId, sortOrder, automationRole, terminal',
  tagEvents: '++id, patientId, tagId, at, [patientId+at]',
  customActions: '++id, sortOrder, triggerType, triggerTagId',
  customActionRuns: '++id, actionId, patientId, date, [actionId+patientId+date]',
  reportTemplates: '++id, sortOrder',
  dateTimeFormats: '++id, sortOrder',
}).upgrade(async (tx) => {
  // Adds user-configurable per-entry formatting to Vitals/Orders/Problems/Checklist Block
  // variables (entry pattern + separators, plus a date-group header toggle/separator for
  // Problems/Checklist), and a savable Date/Time Format library selectable from any date/time
  // variable. Existing Block variable configs only ever had the range-mode fields below, so merge
  // in that record type's default entry pattern (which exactly reproduces the previous hardcoded
  // formatting) while preserving whatever range mode the user already chose. Also introduces the
  // built-in, locked "Labs" template — Labs' comparison-mode formatting is algorithmic rather than
  // field-composable, so it's seeded once here rather than left for the user to reconstruct.
  const reportTemplateTable = tx.table<ReportTemplate, number>('reportTemplates')
  const dateTimeFormatTable = tx.table<DateTimeFormatDefinition, number>('dateTimeFormats')
  const now = new Date().toISOString()

  const existingTemplates = await reportTemplateTable.toArray()
  for (const template of existingTemplates) {
    if (template.id === undefined) continue
    let changed = false
    const nextVariables: Record<string, TemplateVariableInstance> = { ...template.variables }
    for (const [variableId, instance] of Object.entries(nextVariables)) {
      if (instance.kind !== 'block') continue
      const legacyConfig = instance.config as Partial<BlockVariableConfig>
      if (legacyConfig.entryPatternText !== undefined) continue
      nextVariables[variableId] = {
        ...instance,
        config: { ...buildDefaultBlockVariableConfig(instance.variableId), ...legacyConfig },
      }
      changed = true
    }
    if (changed) await reportTemplateTable.update(template.id, { variables: nextVariables })
  }

  const maxSortOrder = existingTemplates.length > 0 ? Math.max(...existingTemplates.map((template) => template.sortOrder)) : -1
  await reportTemplateTable.add(buildLockedLabsTemplate(now, maxSortOrder + 1))
  await dateTimeFormatTable.bulkAdd(buildDefaultDateTimeFormats(now))
})

export { db }
