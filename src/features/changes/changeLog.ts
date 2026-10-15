import { db } from '@/db'
import { SYNCED_TABLE_NAMES, beginChangeRecording, notifyLocalSyncedChange } from '@/features/sync/syncMeta'
import type { ChangeLogEntry, ChangeLogOp } from '@/types'

export const CHANGE_LOG_RETENTION_DAYS = 30

export type ChangeMeta = {
  /** Who made the change, e.g. 'mcp'. */
  source: string
  tool: string
  /** One plain sentence: what was done and to whom. `ChangeContext.setSummary` can replace it once
   * the work knows what it actually did. */
  summary: string
  patientId?: number
  patientIdentifier?: string
}

export type ChangeContext = {
  setSummary: (summary: string) => void
  setPatient: (patient: { id?: number; identifier: string }) => void
}

type AnyRecord = Record<string, unknown> & { uid?: string; updatedAt?: string }

const syncedScope = () => [...SYNCED_TABLE_NAMES.map((tableName) => db.table(tableName)), db.syncTombstones]

/**
 * Runs `work` as one recorded change: every record it adds, edits or deletes is captured with how
 * it looked before and after, and stored as a single entry in the change log — in the same
 * transaction, so a change and its record either both happen or neither does. A change that ends
 * up changing nothing leaves no entry.
 *
 * The capturing happens in the database hooks, so `work` is ordinary code (including the app's own
 * helpers that open nested transactions) and can't forget to say what it touched.
 */
export const recordChange = async <T>(meta: ChangeMeta, work: (context: ChangeContext) => Promise<T>): Promise<{ result: T; entryId: number | null; ops: ChangeLogOp[] }> =>
  db.transaction('rw', syncedScope(), async () => {
    const events = beginChangeRecording()
    const entryMeta = { ...meta }
    const result = await work({
      setSummary: (summary) => { entryMeta.summary = summary },
      setPatient: (patient) => { entryMeta.patientId = patient.id; entryMeta.patientIdentifier = patient.identifier },
    })

    const ops: ChangeLogOp[] = []
    for (const event of events.values()) {
      const after = await db.table<AnyRecord>(event.table).get(event.key)
      if (!event.before && after) {
        ops.push({ table: event.table, recordId: event.key, kind: 'add', after: structuredClone(after) })
      } else if (event.before && !after) {
        ops.push({ table: event.table, recordId: event.key, kind: 'delete', before: event.before })
      } else if (event.before && after && JSON.stringify(event.before) !== JSON.stringify(after)) {
        ops.push({ table: event.table, recordId: event.key, kind: 'update', before: event.before, after: structuredClone(after) })
      }
    }

    if (ops.length === 0) return { result, entryId: null, ops }
    const entryId = await db.changeLog.add({ at: new Date().toISOString(), ...entryMeta, ops }) as number
    return { result, entryId, ops }
  })

export type UndoOutcome =
  | { undone: true; entry: ChangeLogEntry }
  | { undone: false; entry: ChangeLogEntry; conflicts: string[] }

const describeOp = (op: ChangeLogOp): string => `${op.table} #${op.recordId}`

/**
 * Reverses a recorded change. If anything it touched was changed again afterwards (someone edited
 * the record, or re-created a deleted one), nothing is undone unless `force` is set: undoing then
 * would silently overwrite that later work.
 */
export const undoChange = async (entryId: number, options: { force?: boolean } = {}): Promise<UndoOutcome> =>
  db.transaction('rw', syncedScope(), async () => {
    const entry = await db.changeLog.get(entryId)
    if (!entry) throw new Error(`There is no recorded change #${entryId}.`)
    if (entry.undoneAt) throw new Error(`Change #${entryId} was already undone.`)

    const conflicts: string[] = []
    for (const op of entry.ops) {
      const current = await db.table<AnyRecord>(op.table).get(op.recordId)
      if (op.kind === 'delete') {
        if (current) conflicts.push(`${describeOp(op)} was created again after the delete`)
      } else if (current && current.updatedAt !== (op.after as AnyRecord | undefined)?.updatedAt) {
        conflicts.push(`${describeOp(op)} was changed after this`)
      }
    }
    if (conflicts.length > 0 && !options.force) return { undone: false as const, entry, conflicts }

    for (const op of [...entry.ops].reverse()) {
      const table = db.table<AnyRecord>(op.table)
      if (op.kind === 'add') {
        await table.delete(op.recordId)
      } else if (op.kind === 'update') {
        await table.put({ ...(op.before as AnyRecord) })
      } else {
        const before = op.before as AnyRecord
        await table.put({ ...before, __keepSyncMeta: true })
        if (before.uid) await db.syncTombstones.delete(before.uid)
      }
    }

    const undoneAt = new Date().toISOString()
    await db.changeLog.update(entryId, { undoneAt })
    notifyLocalSyncedChange()
    return { undone: true as const, entry: { ...entry, undoneAt } }
  })

/** Newest first. */
export const listChanges = async (limit = 20): Promise<ChangeLogEntry[]> =>
  db.changeLog.orderBy('at').reverse().limit(limit).toArray()

/** Drops entries older than the retention window — which is also how long a deleted record stays
 * recoverable. */
export const pruneChangeLog = async (now = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - CHANGE_LOG_RETENTION_DAYS * 86_400_000).toISOString()
  const stale = await db.changeLog.where('at').below(cutoff).primaryKeys()
  if (stale.length > 0) await db.changeLog.bulkDelete(stale)
  return stale.length
}
