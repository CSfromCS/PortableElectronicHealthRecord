import { isPatientActive } from '@/features/tags/tagUtils'
import { sortPatientsByConfig, type PatientSortConfig } from '@/features/patients/patientSort'
import { joinNonBlank } from '@/lib/patientIdentity'
import type { DailyUpdate, Patient, TagDefinition } from '@/types'
import {
  normalizeChecklistItems,
  normalizeChecklistItemsKeepingBlanks,
  selectLatestDailyUpdate,
  toPendingChecklistItems,
} from './checklistUtils'

export type MasterChecklistItem = {
  patientId: number
  patientIdentifier: string
  viewDate: string
  index: number
  text: string
  completed: boolean
  notes: string
  createdDate: string | null
  completedDate: string | null
  lastFoundDate: string | null
}

// A checklist not tied to any patient (issue #79) — stored as an ordinary DailyUpdate row like
// any patient's, just addressed by this reserved patientId instead of a real one. Real patient
// ids are Dexie auto-increment ('++id'), which only ever assigns positive integers, so a
// negative sentinel can never collide with one.
export const GENERAL_CHECKLIST_PATIENT_ID = -1
export const GENERAL_CHECKLIST_LABEL = 'General (no patient)'

/**
 * Builds the MasterChecklistItem rows for one checklist source — a real patient's DailyUpdate
 * history, or the General checklist's — sharing the same "show today's entry if it exists,
 * otherwise carry forward incomplete items from the latest prior date" logic either way.
 */
export const buildMasterChecklistItemsForSource = (
  patientId: number,
  patientIdentifier: string,
  updates: DailyUpdate[],
  viewDate: string,
): MasterChecklistItem[] => {
  const priorOrCurrent = updates.filter((entry) => entry.date <= viewDate)
  if (priorOrCurrent.length === 0) return []

  const dateMatchedUpdate = priorOrCurrent.find((entry) => entry.date === viewDate)
  const sourceUpdate = dateMatchedUpdate ?? selectLatestDailyUpdate(priorOrCurrent)
  if (!sourceUpdate) return []

  // dateMatchedUpdate means this is the entry actively being viewed/edited "live" — keep blank
  // items so a split's blank "after" item can actually render (see updateMasterChecklist). A
  // checklist merely carried forward from a prior date is never live-edited directly, so it
  // still drops blanks as stale abandoned edits.
  const scopedChecklist = dateMatchedUpdate
    ? normalizeChecklistItemsKeepingBlanks(sourceUpdate.checklist)
    : toPendingChecklistItems(sourceUpdate.checklist)
  if (scopedChecklist.length === 0) return []

  const normalizedHistory = priorOrCurrent.map((entry) => ({
    date: entry.date,
    checklist: normalizeChecklistItems(entry.checklist),
  }))

  return scopedChecklist.map((item, index) => {
    let createdDate: string | null = null
    let completedDate: string | null = null
    let lastFoundDate: string | null = null

    normalizedHistory.forEach((historyEntry) => {
      const matchedHistoryItem = historyEntry.checklist.find((historyItem) => historyItem.text === item.text)
      if (!matchedHistoryItem) return
      lastFoundDate = historyEntry.date
      if (createdDate === null) {
        createdDate = historyEntry.date
      }
      if (completedDate === null && matchedHistoryItem.completed) {
        completedDate = historyEntry.date
      }
    })

    return {
      patientId,
      patientIdentifier,
      viewDate,
      index,
      text: item.text,
      completed: item.completed,
      notes: item.notes ?? '',
      createdDate,
      completedDate,
      lastFoundDate,
    }
  })
}

/** Each patient's DailyUpdates (the General checklist's included), oldest date first. */
export const groupDailyUpdatesByPatientSorted = (dailyUpdates: DailyUpdate[]): Map<number, DailyUpdate[]> => {
  const grouped = new Map<number, DailyUpdate[]>()
  dailyUpdates.forEach((entry) => {
    const list = grouped.get(entry.patientId) ?? []
    list.push(entry)
    grouped.set(entry.patientId, list)
  })

  grouped.forEach((list) => {
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.lastUpdated.localeCompare(b.lastUpdated)
    })
  })

  return grouped
}

/** Everything the Master Checklist shows for `viewDate`: the General checklist first, then each
 * active patient's (in the chosen sort order), each carrying forward unfinished items. */
export const buildMasterChecklistItems = (
  patients: Patient[],
  tagsById: Map<number, TagDefinition>,
  sortConfig: PatientSortConfig,
  dailyUpdatesByPatient: Map<number, DailyUpdate[]>,
  viewDate: string,
): MasterChecklistItem[] => {
  const sortedPatients = sortPatientsByConfig(
    patients.filter((patient) => isPatientActive(patient, tagsById)),
    sortConfig,
    tagsById,
  )

  const items: MasterChecklistItem[] = [
    ...buildMasterChecklistItemsForSource(
      GENERAL_CHECKLIST_PATIENT_ID,
      GENERAL_CHECKLIST_LABEL,
      dailyUpdatesByPatient.get(GENERAL_CHECKLIST_PATIENT_ID) ?? [],
      viewDate,
    ),
  ]

  sortedPatients.forEach((patient) => {
    if (patient.id === undefined) return
    const patientId = patient.id
    const patientIdentifier = joinNonBlank([patient.roomNumber, patient.lastName.toUpperCase()], ' — ')

    items.push(...buildMasterChecklistItemsForSource(
      patientId,
      patientIdentifier,
      dailyUpdatesByPatient.get(patientId) ?? [],
      viewDate,
    ))
  })

  return items
}
