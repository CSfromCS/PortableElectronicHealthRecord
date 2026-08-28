import Dexie, { type EntityTable } from 'dexie'
import { normalizeDailyUpdate } from './features/problems/problemUtils'
import { DEFAULT_TAG_GROUP_NAMES, DEFAULT_TAG_SEEDS, SERVICE_TAG_GROUP_NAME } from './features/tags/tagConstants'
import { parseLegacyServiceText } from './features/tags/serviceTagParsing'
import { splitCombinedRoomValue } from './lib/roomSplit'
import type {
  DailyUpdate,
  LabEntry,
  MedicationEntry,
  OrderEntry,
  Patient,
  PhotoAttachment,
  TagDefinition,
  TagEvent,
  TagGroupDefinition,
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

// Seeds default tag groups/tags for brand-new installs. Dexie only runs version().upgrade()
// callbacks when migrating an existing database — a fresh IndexedDB is created directly at the
// latest schema version, so first-time installs need this separate 'populate' hook instead.
db.on('populate', async () => {
  await seedDefaultTagGroupsAndTags(
    (group) => db.tagGroups.add(group) as Promise<number>,
    (tag) => db.tagDefinitions.add(tag) as Promise<number>,
  )
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

export { db }
