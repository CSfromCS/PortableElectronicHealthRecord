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
  'changeLog',
] as const

export type SyncedTableName = typeof SYNCED_TABLE_NAMES[number]

/** How long a deletion record is kept. It only has to outlive the last device that still holds the
 * deleted record, and every device syncs far more often than this; a device that was offline for
 * longer than this and then syncs may bring a record deleted in the meantime back. */
export const SYNC_TOMBSTONE_RETENTION_DAYS = 60

export const isTombstoneExpired = (tombstone: SyncTombstone, now = new Date()): boolean => {
  const deletedAt = Date.parse(tombstone.deletedAt)
  return Number.isFinite(deletedAt) && deletedAt < now.getTime() - SYNC_TOMBSTONE_RETENTION_DAYS * 86_400_000
}

const EPOCH_ISO = new Date(0).toISOString()
const SYNC_IMPORT_FLAG = '__puhrrSyncImport'

type FlaggedTransaction = Transaction & { [SYNC_IMPORT_FLAG]?: boolean }
type SyncedRecord = SyncMeta & Record<string, unknown>

const localChangeListeners = new Set<() => void>()

/** Calls `listener` after every edit made on this device to a synced table (not for pulls,
 * merges or backup restores). Returns the unsubscribe function. */
export const subscribeToLocalSyncedChanges = (listener: () => void): (() => void) => {
  localChangeListeners.add(listener)
  return () => { localChangeListeners.delete(listener) }
}

export const notifyLocalSyncedChange = () => {
  for (const listener of localChangeListeners) listener()
}

// What each record looked like before a change began, gathered while a change is being recorded
// (see features/changes/changeLog.ts). Keyed by the transaction the change runs in.
export type RecordedEvent = { table: string; key: number; before?: Record<string, unknown> }
const recordings = new WeakMap<Transaction, Map<string, RecordedEvent>>()

/** Starts recording every tracked write made in the current transaction. */
export const beginChangeRecording = (): Map<string, RecordedEvent> => {
  const transaction = Dexie.currentTransaction
  if (!transaction) throw new Error('beginChangeRecording must run inside db.transaction().')
  const events = new Map<string, RecordedEvent>()
  recordings.set(rootTransaction(transaction), events)
  return events
}

const recordEvent = (transaction: Transaction, tableName: string, key: unknown, before?: Record<string, unknown>) => {
  // The log of changes is not itself part of any change.
  if (tableName === 'changeLog' || typeof key !== 'number') return
  const events = recordings.get(rootTransaction(transaction))
  if (!events) return
  const id = `${tableName}:${key}`
  if (!events.has(id)) events.set(id, { table: tableName, key, ...(before ? { before: structuredClone(before) } : {}) })
}

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
      notifyLocalSyncedChange()
      // Dexie uses the id this returns for an add() that left the id to auto-increment.
      const generatedId = primaryKey == null ? createSyncRecordId() : undefined
      recordEvent(transaction, tableName, primaryKey ?? generatedId)
      return generatedId
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
      if (isEdited) {
        notifyLocalSyncedChange()
        recordEvent(transaction, tableName, _primaryKey, existing)
      }
      return {
        uid: typeof existing.uid === 'string' && existing.uid ? existing.uid : createSyncUid(),
        updatedAt: isEdited || !existing.updatedAt ? new Date().toISOString() : existing.updatedAt,
      }
    })

    table.hook('deleting', (primaryKey, existing, transaction) => {
      if (isUntrackedWrite(transaction)) return
      if (typeof existing?.uid !== 'string' || !existing.uid) return
      notifyLocalSyncedChange()
      recordEvent(transaction, tableName, primaryKey, existing)
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
    // A table added by a later schema version (the change log) doesn't exist yet when this runs
    // for a device upgrading from before v31, and has nothing to backfill anyway.
    if (!transaction.idbtrans.objectStoreNames.contains(tableName)) continue
    await transaction.table<SyncedRecord>(tableName).toCollection().modify((record) => {
      if (typeof record.uid !== 'string' || !record.uid) record.uid = createSyncUid()
      if (typeof record.updatedAt !== 'string' || !record.updatedAt) record.updatedAt = deriveSyncUpdatedAt(record)
    })
  }
}
