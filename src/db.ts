import Dexie, { type EntityTable } from 'dexie'
import type {
  DailyUpdate,
  LabEntry,
  MedicationEntry,
  OrderEntry,
  Patient,
  PhotoAttachment,
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

export { db }
