import { db } from '@/db'
import { SYNCED_TABLE_NAMES, beginChangeRecording } from '@/features/sync/syncMeta'
import type { ChangeLogEntry, ChangeLogField, ChangeLogOp } from '@/types'

export const CHANGE_LOG_RETENTION_DAYS = 30

/** Fields that change on every write or only identify a record: not worth logging. */
const BOOKKEEPING = new Set(['id', 'uid', 'updatedAt', 'lastModified'])
const MAX_TEXT = 200
const MAX_FIELDS = 12
export const MAX_OPS = 25

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

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

const sameValue = (a: unknown, b: unknown): boolean => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a) === JSON.stringify(b)

const show = (value: unknown): string => {
  if (isEmpty(value)) return '(empty)'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

/**
 * What a change did to one record, as just the fields it touched (old → new, long text shortened) —
 * not whole copies of the record, which is what made the log the biggest part of every sync snapshot.
 */
const toLoggedOp = (
  table: string,
  recordId: number,
  kind: ChangeLogOp['kind'],
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {},
): ChangeLogOp => {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !BOOKKEEPING.has(key))

  const fields: ChangeLogField[] = []
  for (const key of keys) {
    if (kind === 'add') {
      if (!isEmpty(after[key])) fields.push({ field: key, to: show(after[key]) })
    } else if (kind === 'delete') {
      if (!isEmpty(before[key])) fields.push({ field: key, from: show(before[key]) })
    } else if (!sameValue(before[key], after[key])) {
      fields.push({ field: key, from: show(before[key]), to: show(after[key]) })
    }
  }

  return {
    table,
    recordId,
    kind,
    fields: fields.slice(0, MAX_FIELDS),
    ...(fields.length > MAX_FIELDS ? { moreFields: fields.length - MAX_FIELDS } : {}),
  }
}

/** The compact form of an op. Entries written before the log kept only changed fields hold whole
 * `before`/`after` records instead; they are converted here when read and rewritten by `pruneChangeLog`. */
export const compactOp = (op: ChangeLogOp): ChangeLogOp =>
  op.fields ? op : toLoggedOp(op.table, op.recordId, op.kind, op.before, op.after)

/**
 * Runs `work` as one recorded change: every record it adds, edits or deletes is captured as the
 * fields that changed (old and new value) and stored as a single entry in the change log — in the same
 * transaction, so a change and its record either both happen or neither does. A change that ends
 * up changing nothing leaves no entry.
 *
 * The capturing happens in the database hooks, so `work` is ordinary code (including the app's own
 * helpers that open nested transactions) and can't forget to say what it touched.
 */
export const recordChange = async <T>(meta: ChangeMeta, work: (context: ChangeContext) => Promise<T>): Promise<{ result: T; entryId: number | null; ops: ChangeLogOp[]; moreOps?: number }> =>
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
        ops.push(toLoggedOp(event.table, event.key, 'add', undefined, after))
      } else if (event.before && !after) {
        ops.push(toLoggedOp(event.table, event.key, 'delete', event.before))
      } else if (event.before && after && JSON.stringify(event.before) !== JSON.stringify(after)) {
        const op = toLoggedOp(event.table, event.key, 'update', event.before, after)
        // Only bookkeeping (a re-stamped record) differed: nothing the user would call a change.
        if (op.fields && (op.fields.length > 0 || op.moreFields)) ops.push(op)
      }
    }

    if (ops.length === 0) return { result, entryId: null, ops }
    const kept = ops.slice(0, MAX_OPS)
    const moreOps = ops.length - kept.length
    const entryId = await db.changeLog.add({
      at: new Date().toISOString(),
      ...entryMeta,
      ops: kept,
      ...(moreOps > 0 ? { moreOps } : {}),
    }) as number
    return { result, entryId, ops: kept, ...(moreOps > 0 ? { moreOps } : {}) }
  })

/** Newest first. */
export const listChanges = async (limit = 20): Promise<ChangeLogEntry[]> =>
  db.changeLog.orderBy('at').reverse().limit(limit).toArray()

/** Drops entries older than the retention window, and shrinks any entry still holding whole
 * before/after records (from before the log kept only changed fields) down to the fields that changed.
 * Returns how many entries it dropped or shrank, so a caller that can push knows whether to. */
export const pruneChangeLog = async (now = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - CHANGE_LOG_RETENTION_DAYS * 86_400_000).toISOString()
  const stale = await db.changeLog.where('at').below(cutoff).primaryKeys()
  if (stale.length > 0) await db.changeLog.bulkDelete(stale)

  const legacy = (await db.changeLog.toArray()).filter((entry) => entry.ops.some((op) => !op.fields))
  for (const entry of legacy) {
    if (entry.id === undefined) continue
    const kept = entry.ops.slice(0, MAX_OPS)
    const moreOps = (entry.moreOps ?? 0) + (entry.ops.length - kept.length)
    await db.changeLog.update(entry.id, { ops: kept.map(compactOp), ...(moreOps > 0 ? { moreOps } : {}) })
  }
  return stale.length + legacy.length
}
