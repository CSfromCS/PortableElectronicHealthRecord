import type { DailyUpdate, SyncMeta, SyncTombstone } from '@/types'
import { SYNCED_TABLE_NAMES, type SyncedTableName } from './syncMeta'

export type MergeRow = SyncMeta & { id?: number; createdAt?: string } & Record<string, unknown>
export type MergeTables = Record<SyncedTableName, MergeRow[]>

export type MergeSide = {
  /** A table a legacy snapshot doesn't include is left out, and merges as "nothing to say". */
  tables: Partial<Record<SyncedTableName, MergeRow[]>>
  tombstones: SyncTombstone[]
}

export type MergeResult = {
  tables: MergeTables
  tombstones: SyncTombstone[]
  /** The merged state differs from what this device already has — apply it locally. */
  changedLocal: boolean
  /** The merged state differs from what the room already has — push it. */
  changedRemote: boolean
}

/** Two different records ended up with the same id, which a merge can't reconcile without
 * guessing. Sync stops with nothing written rather than risk mixing up two patients' data. */
export class SyncMergeConflictError extends Error {
  constructor(tableName: string, id: number) {
    super(`Sync stopped: two different ${tableName} records share id ${id}. Nothing was changed.`)
    this.name = 'SyncMergeConflictError'
  }
}

/** Tables whose rows belong to a patient, and so can't outlive that patient. */
const PATIENT_OWNED_TABLES: SyncedTableName[] = [
  'dailyUpdates',
  'vitals',
  'medications',
  'labs',
  'orders',
  'tagEvents',
  'masterProblems',
  'simpleProblemItems',
]

const toMs = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

const rowKey = (row: MergeRow): string => row.uid ?? `id:${String(row.id)}`

// Records from before v31 were backfilled with a random uid on each device, so the same record can
// carry different uids. Its id is the same on both (snapshots used to replace each other whole),
// and createdAt, where the record has one, confirms it.
const isSameLegacyRecord = (local: MergeRow, remote: MergeRow): boolean => (
  local.id !== undefined
  && local.id === remote.id
  && (local.createdAt === undefined || remote.createdAt === undefined || local.createdAt === remote.createdAt)
)

const mergeRows = (tableName: SyncedTableName, localRows: MergeRow[], remoteRows: MergeRow[]): MergeRow[] => {
  const localByKey = new Map(localRows.map((row) => [rowKey(row), row]))
  const localById = new Map<number, MergeRow>()
  for (const row of localRows) {
    if (row.id !== undefined) localById.set(row.id, row)
  }
  const remoteKeys = new Set(remoteRows.map(rowKey))
  const matchedLocal = new Set<MergeRow>()
  const merged: MergeRow[] = []

  for (const remote of remoteRows) {
    let local = localByKey.get(rowKey(remote))
    if (local && matchedLocal.has(local)) local = undefined

    if (!local && remote.id !== undefined) {
      const sameId = localById.get(remote.id)
      if (sameId) {
        const isLegacyTwin = !matchedLocal.has(sameId) && !remoteKeys.has(rowKey(sameId)) && isSameLegacyRecord(sameId, remote)
        if (!isLegacyTwin) throw new SyncMergeConflictError(tableName, remote.id)
        local = sameId
      }
    }

    if (!local) {
      merged.push(remote)
      continue
    }

    matchedLocal.add(local)
    const winner = toMs(remote.updatedAt) > toMs(local.updatedAt) ? remote : local
    // Both devices pick the smaller uid, so they converge instead of swapping.
    const uids = [local.uid, remote.uid].filter((uid): uid is string => typeof uid === 'string')
    const canonicalUid = uids.length > 0 ? uids.sort()[0] : undefined
    merged.push(canonicalUid !== undefined && winner.uid !== canonicalUid ? { ...winner, uid: canonicalUid } : winner)
  }

  for (const local of localRows) {
    if (!matchedLocal.has(local)) merged.push(local)
  }

  return merged
}

const mergeTombstones = (local: SyncTombstone[], remote: SyncTombstone[]): Map<string, SyncTombstone> => {
  const byUid = new Map<string, SyncTombstone>()
  for (const tombstone of [...local, ...remote]) {
    const existing = byUid.get(tombstone.uid)
    if (!existing || toMs(tombstone.deletedAt) > toMs(existing.deletedAt)) byUid.set(tombstone.uid, tombstone)
  }
  return byUid
}

const findTombstone = (
  tombstones: Map<string, SyncTombstone>,
  tombstonesByRecord: Map<string, SyncTombstone>,
  tableName: string,
  row: MergeRow,
): SyncTombstone | undefined => (
  (row.uid !== undefined ? tombstones.get(row.uid) : undefined)
  ?? (row.id !== undefined ? tombstonesByRecord.get(`${tableName}:${row.id}`) : undefined)
)

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Two devices each opening a patient's note for the same day before syncing create two daily
 * updates for it, but the app expects one per patient and date. Keeps the newest as the record and
 * folds the other's content in, so nothing either device wrote is lost. */
const foldDuplicateDailyUpdates = (rows: MergeRow[]): { kept: MergeRow[]; removed: MergeRow[] } => {
  const groups = new Map<string, MergeRow[]>()
  for (const row of rows) {
    const key = `${String(row.patientId)}|${String(row.date)}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const kept: MergeRow[] = []
  const removed: MergeRow[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }

    const [newest, ...others] = [...group].sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))
    const folded = { ...newest } as MergeRow & Partial<DailyUpdate>
    for (const other of others as Array<MergeRow & Partial<DailyUpdate>>) {
      const checklist = [...(folded.checklist ?? [])]
      for (const item of other.checklist ?? []) {
        if (!checklist.some((existing) => existing.text === item.text)) checklist.push(item)
      }
      folded.checklist = checklist

      const problems = [...(folded.problems ?? [])]
      for (const note of other.problems ?? []) {
        const existing = problems.find((candidate) => candidate.masterProblemId === note.masterProblemId)
        if (!existing) problems.push(note)
        else if (note.notes && !existing.notes.includes(note.notes)) existing.notes = `${existing.notes}\n\n${note.notes}`.trim()
      }
      folded.problems = problems

      for (const field of ['subjective', 'objective', 'assessment', 'plans'] as const) {
        const extra = textOf(other[field])
        if (extra && !textOf(folded[field]).includes(extra)) folded[field] = `${textOf(folded[field])}\n\n${extra}`.trim()
      }
    }
    folded.updatedAt = new Date(Math.max(Date.now(), ...group.map((row) => toMs(row.updatedAt)))).toISOString()
    folded.lastUpdated = folded.updatedAt
    kept.push(folded)
    removed.push(...others)
  }

  return { kept, removed }
}

const signature = (tables: Partial<Record<SyncedTableName, MergeRow[]>>, tombstones: Map<string, SyncTombstone>): string => {
  const parts: string[] = []
  for (const tableName of SYNCED_TABLE_NAMES) {
    for (const row of tables[tableName] ?? []) {
      parts.push(`r|${tableName}|${rowKey(row)}|${String(row.id)}|${String(row.updatedAt)}`)
    }
  }
  for (const tombstone of tombstones.values()) {
    parts.push(`t|${tombstone.uid}|${tombstone.deletedAt}`)
  }
  return parts.sort().join('\n')
}

/**
 * Combines this device's data with the room's, record by record. A record is matched by `uid`; when
 * both sides have it, the later `updatedAt` wins. A deletion beats the record unless the record was
 * edited after it. A record only one side has is kept, which is what stops either device's new
 * entries — a phone's new vitals, an MCP client's new order — from being overwritten by the other's copy.
 * Pure: reads nothing and writes nothing, so it can run inside one local transaction.
 */
export const mergeSyncSnapshots = (local: MergeSide, remote: MergeSide, now = new Date()): MergeResult => {
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones)
  const tombstonesByRecord = new Map<string, SyncTombstone>()
  for (const tombstone of tombstones.values()) {
    if (tombstone.recordId !== undefined) tombstonesByRecord.set(`${tombstone.table}:${tombstone.recordId}`, tombstone)
  }

  const tables = {} as MergeTables
  for (const tableName of SYNCED_TABLE_NAMES) {
    const remoteRows = remote.tables[tableName]
    const unionRows = remoteRows === undefined
      ? local.tables[tableName] ?? []
      : mergeRows(tableName, local.tables[tableName] ?? [], remoteRows)

    const survivors: MergeRow[] = []
    for (const row of unionRows) {
      const tombstone = findTombstone(tombstones, tombstonesByRecord, tableName, row)
      if (!tombstone) {
        survivors.push(row)
      } else if (toMs(row.updatedAt) > toMs(tombstone.deletedAt)) {
        // Edited after it was deleted elsewhere: the edit wins and the deletion is withdrawn.
        tombstones.delete(tombstone.uid)
        if (tombstone.recordId !== undefined) tombstonesByRecord.delete(`${tombstone.table}:${tombstone.recordId}`)
        survivors.push(row)
      }
    }
    tables[tableName] = survivors
  }

  const folded = foldDuplicateDailyUpdates(tables.dailyUpdates)
  tables.dailyUpdates = folded.kept
  for (const row of folded.removed) {
    if (row.uid !== undefined) tombstones.set(row.uid, { uid: row.uid, table: 'dailyUpdates', deletedAt: now.toISOString(), ...(row.id !== undefined ? { recordId: row.id } : {}) })
  }

  // A patient deleted on one device takes their records with it, including ones the other device
  // added meanwhile — they'd otherwise sit in the database pointing at nobody.
  const patientIds = new Set(tables.patients.map((patient) => patient.id))
  for (const tableName of PATIENT_OWNED_TABLES) {
    tables[tableName] = tables[tableName].filter((row) => {
      // A negative patientId is the General (no patient) checklist, which belongs to no patient.
      if (patientIds.has(row.patientId as number) || (row.patientId as number) < 0) return true
      if (row.uid !== undefined) tombstones.set(row.uid, { uid: row.uid, table: tableName, deletedAt: now.toISOString(), ...(row.id !== undefined ? { recordId: row.id } : {}) })
      return false
    })
  }

  const mergedSignature = signature(tables, tombstones)
  const localSignature = signature(local.tables, mergeTombstones(local.tombstones, []))
  // A table the room lacks counts as empty, so a legacy room gets this device's rows on push.
  const remoteSignature = signature(remote.tables, mergeTombstones(remote.tombstones, []))

  return {
    tables,
    tombstones: [...tombstones.values()],
    changedLocal: mergedSignature !== localSignature,
    changedRemote: mergedSignature !== remoteSignature,
  }
}
