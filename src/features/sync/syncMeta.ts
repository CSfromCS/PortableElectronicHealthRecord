import Dexie, { type Transaction } from 'dexie'
import type { SyncMeta, SyncTombstone } from '@/types'

/** Every table whose contents travel through sync. Photos and Custom Action run history stay
 * on-device, so they carry no sync bookkeeping. */
export const SYNCED_TABLE_NAMES = [
  'patients',
  'dailyUpdates',
  'vitals',
  'medications',
  'labs',
  'orders',
  'tagGroups',
  'tagDefinitions',
  'tagEvents',
  'reportTemplates',
  'dateTimeFormats',
  'customViews',
  'customActions',
  'masterProblems',
  'simpleProblemItems',
] as const

export type SyncedTableName = typeof SYNCED_TABLE_NAMES[number]

const EPOCH_ISO = new Date(0).toISOString()
const SYNC_IMPORT_FLAG = '__puhrrSyncImport'

type FlaggedTransaction = Transaction & { [SYNC_IMPORT_FLAG]?: boolean }
type SyncedRecord = SyncMeta & Record<string, unknown>

let lastGeneratedRecordId = 0

/**
 * A record id that no other device will pick. Auto-increment ids restart from 1 on every device,
 * so two devices adding records between syncs would both create "vitals #51" — and records point
 * at each other by id (patientId, tag ids inside templates and views, ...), so a merge can't just
 * renumber one. Time-ordered ids with random low bits keep new records collision-free and in
 * creation order; `lastGeneratedRecordId` keeps a burst of adds in one millisecond distinct.
 */
export const createSyncRecordId = (): number => {
  const candidate = Date.now() * 4096 + Math.floor(Math.random() * 4096)
  lastGeneratedRecordId = Math.max(candidate, lastGeneratedRecordId + 1)
  return lastGeneratedRecordId
}

export const createSyncUid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `uid-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/** Best "last edited" guess for a record that predates `updatedAt` — the record's own
 * last-edit/creation timestamp when it has one, else the epoch so it never looks newer than a
 * record somebody actually edited. */
export const deriveSyncUpdatedAt = (record: Record<string, unknown>): string => {
  for (const key of ['lastModified', 'lastUpdated', 'createdAt']) {
    const parsed = typeof record[key] === 'string' ? Date.parse(record[key]) : Number.NaN
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return EPOCH_ISO
}

/**
 * Marks the current `db.transaction()` as bringing in data from elsewhere (a sync pull or a backup
 * import): records keep the `uid`/`updatedAt` they arrive with instead of being treated as local
 * edits, and the tables it clears don't record deletions. Call first thing inside the transaction.
 */
export const markSyncImportTransaction = (): void => {
  const transaction = Dexie.currentTransaction as FlaggedTransaction | null
  if (!transaction) throw new Error('markSyncImportTransaction must run inside db.transaction().')
  transaction[SYNC_IMPORT_FLAG] = true
}

// Schema upgrades set sync fields explicitly (v31), so the hooks stay out of their way the same as
// for imports. Dexie reports an upgrade's transaction as 'readwrite'; only the IndexedDB
// transaction underneath says 'versionchange'.
const isUntrackedWrite = (transaction: Transaction): boolean => {
  if (transaction.idbtrans?.mode === 'versionchange') return true
  for (let current: FlaggedTransaction | undefined = transaction; current; current = current.parent) {
    if (current[SYNC_IMPORT_FLAG]) return true
  }
  return false
}

const rootTransaction = (transaction: Transaction): Transaction => {
  let current = transaction
  while (current.parent) current = current.parent
  return current
}

/**
 * Stamps `uid` and `updatedAt` on every write to a synced table and records each deletion as a
 * tombstone — in one place, so none of the app's many create/edit/delete paths has to remember to.
 */
export const registerSyncMetaHooks = (db: Dexie): void => {
  const pendingTombstones = new WeakMap<Transaction, SyncTombstone[]>()

  const queueTombstone = (transaction: Transaction, tombstone: SyncTombstone) => {
    // Deleting transactions rarely include syncTombstones in their scope, so tombstones are
    // written once the deletion itself has committed (and never, if it aborts).
    const root = rootTransaction(transaction)
    const queued = pendingTombstones.get(root)
    if (queued) {
      queued.push(tombstone)
      return
    }
    const tombstones = [tombstone]
    pendingTombstones.set(root, tombstones)
    root.on('complete', () => {
      void Dexie.ignoreTransaction(() => db.table<SyncTombstone, string>('syncTombstones').bulkPut(tombstones))
        .catch((error: unknown) => console.error('Failed to record sync tombstones.', error))
    })
  }

  for (const tableName of SYNCED_TABLE_NAMES) {
    const table = db.table<SyncedRecord>(tableName)

    table.hook('creating', (primaryKey, record, transaction) => {
      if (isUntrackedWrite(transaction)) {
        // Keep what the import brought; only fill in what an older payload or backup lacks.
        if (typeof record.uid !== 'string' || !record.uid) record.uid = createSyncUid()
        if (typeof record.updatedAt !== 'string' || !record.updatedAt) record.updatedAt = deriveSyncUpdatedAt(record)
        return
      }
      // Always fresh: copies such as Duplicate patient spread the source record, uid included.
      record.uid = createSyncUid()
      record.updatedAt = new Date().toISOString()
      // Dexie uses the id this returns for an add() that left the id to auto-increment.
      return primaryKey == null ? createSyncRecordId() : undefined
    })

    table.hook('updating', (modifications, _primaryKey, existing, transaction) => {
      if (isUntrackedWrite(transaction)) return undefined
      // Dexie lists every array field as modified whenever the array is a new instance, so compare
      // contents before calling it an edit — re-saving an unchanged form keeps the old updatedAt.
      // A put of an object built without the sync fields shows up here as them being cleared:
      // put them back rather than counting that as an edit.
      const isEdited = Object.entries(modifications as Record<string, unknown>).some(([keyPath, value]) => (
        keyPath !== 'uid'
        && keyPath !== 'updatedAt'
        && JSON.stringify(Dexie.getByKeyPath(existing, keyPath)) !== JSON.stringify(value)
      ))
      return {
        uid: typeof existing.uid === 'string' && existing.uid ? existing.uid : createSyncUid(),
        updatedAt: isEdited || !existing.updatedAt ? new Date().toISOString() : existing.updatedAt,
      }
    })

    table.hook('deleting', (primaryKey, existing, transaction) => {
      if (isUntrackedWrite(transaction)) return
      if (typeof existing?.uid !== 'string' || !existing.uid) return
      queueTombstone(transaction, {
        uid: existing.uid,
        table: tableName,
        deletedAt: new Date().toISOString(),
        ...(typeof primaryKey === 'number' ? { recordId: primaryKey } : {}),
      })
    })
  }
}

/** v31 upgrade step: gives every existing synced record its `uid` and a best-guess `updatedAt`. */
export const backfillSyncMeta = async (transaction: Transaction): Promise<void> => {
  for (const tableName of SYNCED_TABLE_NAMES) {
    await transaction.table<SyncedRecord>(tableName).toCollection().modify((record) => {
      if (typeof record.uid !== 'string' || !record.uid) record.uid = createSyncUid()
      if (typeof record.updatedAt !== 'string' || !record.updatedAt) record.updatedAt = deriveSyncUpdatedAt(record)
    })
  }
}
