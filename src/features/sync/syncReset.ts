import { db } from '@/db'
import type { SyncReset } from '@/types'
import {
  SYNCED_TABLE_NAMES,
  type SyncedTableName,
  createSyncUid,
  markSyncImportTransaction,
  notifyLocalSyncedChange,
} from './syncMeta'
import type { MergeSide } from './syncMerge'

/** The things Settings → "Reset room data" offers to clear. Templates, tags, views, actions and
 * formats are deliberately not among them: a reset never touches the app's configuration. */
export type ResetGroupId = 'patients' | 'tagHistory' | 'changeLog' | 'deletionHistory' | 'photos'

export type ResetSelection = Record<ResetGroupId, boolean>

/** Every table that belongs to a patient, plus the General checklist (daily updates for no patient). */
const PATIENT_TABLES: SyncedTableName[] = [
  'patients',
  'dailyUpdates',
  'vitals',
  'medications',
  'labs',
  'orders',
  'masterProblems',
  'simpleProblemItems',
  'tagEvents',
]

/** Markers kept in the room; far more than anyone resets, and each is a couple of hundred bytes. */
const MAX_RESETS = 50

/** Everything a reset or a merge that applies one may touch, so every such transaction declares the
 * same scope (Dexie requires a nested transaction's tables to be within its parent's). */
export const getSyncStateScope = () => [
  ...SYNCED_TABLE_NAMES.map((tableName) => db.table(tableName)),
  db.syncTombstones,
  db.syncResets,
  db.photoAttachments,
  db.customActionRuns,
]

export const buildReset = (selection: ResetSelection, by: string, now = new Date()): SyncReset => {
  const tables = new Set<SyncedTableName>()
  if (selection.patients) PATIENT_TABLES.forEach((tableName) => tables.add(tableName))
  if (selection.tagHistory) tables.add('tagEvents')
  if (selection.changeLog) tables.add('changeLog')

  return {
    id: createSyncUid(),
    at: now.toISOString(),
    by,
    tables: [...tables],
    photos: selection.photos,
    allTombstones: selection.deletionHistory,
  }
}

/** Clears what a reset covers that never travels in a snapshot (this device's photos and Custom
 * Action run history). Runs inside a transaction that spans `getSyncStateScope()`. */
export const applyResetLocalOnlyData = async (reset: SyncReset): Promise<void> => {
  if (reset.photos) await db.photoAttachments.clear()
  if (reset.tables.includes('patients')) await db.customActionRuns.clear()
}

/** Empties everything a reset covers on this device. Runs inside a transaction that spans
 * `getSyncStateScope()` and has called `markSyncImportTransaction()`, so the cleared records aren't
 * logged as individual deletions to sync. */
export const applyResetData = async (reset: SyncReset): Promise<void> => {
  for (const tableName of reset.tables) await db.table(tableName).clear()
  await applyResetLocalOnlyData(reset)

  if (reset.allTombstones) {
    await db.syncTombstones.clear()
  } else if (reset.tables.length > 0) {
    // A deletion record for a table that's now empty has nothing left to delete.
    await db.syncTombstones.where('table').anyOf(reset.tables).delete()
  }
}

/** Runs a reset on this device and records its marker, so the next sync carries it to the room. */
export const resetRoomData = async (selection: ResetSelection, by: string): Promise<SyncReset> => {
  const reset = buildReset(selection, by)
  await db.transaction('rw', getSyncStateScope(), async () => {
    markSyncImportTransaction()
    await applyResetData(reset)
    await db.syncResets.put(reset)
  })
  // The hooks stay quiet during an import-style write, but this is a change to send.
  notifyLocalSyncedChange()
  return reset
}

export const unionResets = (first: SyncReset[], second: SyncReset[]): SyncReset[] => {
  const byId = new Map<string, SyncReset>()
  for (const reset of [...first, ...second]) byId.set(reset.id, reset)
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_RESETS)
}

/** The markers in `resets` that `others` doesn't have, oldest first. */
export const resetsMissingFrom = (resets: SyncReset[], others: SyncReset[]): SyncReset[] => {
  const knownIds = new Set(others.map((reset) => reset.id))
  return resets.filter((reset) => !knownIds.has(reset.id)).sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * A side of a merge that hasn't seen `resets` still holds the data they cleared. That data is
 * dropped — not merged — so a device or room that missed a reset can't bring it back.
 */
export const discardResetData = (side: MergeSide, resets: SyncReset[]): MergeSide => {
  if (resets.length === 0) return side

  const tables = { ...side.tables }
  const clearedTables = new Set<string>()
  for (const reset of resets) {
    for (const tableName of reset.tables) clearedTables.add(tableName)
  }
  for (const tableName of clearedTables) {
    if (tables[tableName as SyncedTableName] !== undefined) tables[tableName as SyncedTableName] = []
  }

  const dropAllTombstones = resets.some((reset) => reset.allTombstones)
  return {
    tables,
    tombstones: dropAllTombstones ? [] : side.tombstones.filter((tombstone) => !clearedTables.has(tombstone.table)),
  }
}

export type ResetCounts = Record<ResetGroupId, number> & {
  /** Rows across the patient-owned tables, shown as "N records". */
  patientRecords: number
}

/** What a reset would clear right now, for the counts beside each checkbox. */
export const getResetCounts = async (): Promise<ResetCounts> => {
  const [patients, tagHistory, changeLog, deletionHistory, photos, ...patientTableCounts] = await Promise.all([
    db.patients.count(),
    db.tagEvents.count(),
    db.changeLog.count(),
    db.syncTombstones.count(),
    db.photoAttachments.count(),
    ...PATIENT_TABLES.filter((tableName) => tableName !== 'patients').map((tableName) => db.table(tableName).count()),
  ])

  return {
    patients,
    tagHistory,
    changeLog,
    deletionHistory,
    photos,
    patientRecords: patientTableCounts.reduce((sum, count) => sum + count, 0),
  }
}
