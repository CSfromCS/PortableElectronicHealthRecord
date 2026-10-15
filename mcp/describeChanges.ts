import type { ChangeLogOp } from '@/types'

/** Fields that change on every write or only identify a record: not worth telling the user about. */
const BOOKKEEPING = new Set(['id', 'uid', 'updatedAt', 'lastModified'])
const MAX_TEXT = 200
const MAX_FIELDS = 12
const MAX_OPS = 25

export type FieldChange = { field: string; from?: string; to?: string }
export type OpDescription = {
  action: 'added' | 'edited' | 'deleted'
  record: string
  fields: FieldChange[]
  moreFields?: number
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

const show = (value: unknown): string => {
  if (isEmpty(value)) return '(empty)'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

const sameValue = (a: unknown, b: unknown): boolean => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a) === JSON.stringify(b)

const describeOp = (op: ChangeLogOp): OpDescription => {
  const before = op.before ?? {}
  const after = op.after ?? {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !BOOKKEEPING.has(key))

  const fields: FieldChange[] = []
  for (const key of keys) {
    if (op.kind === 'add') {
      if (!isEmpty(after[key])) fields.push({ field: key, to: show(after[key]) })
    } else if (op.kind === 'delete') {
      if (!isEmpty(before[key])) fields.push({ field: key, from: show(before[key]) })
    } else if (!sameValue(before[key], after[key])) {
      fields.push({ field: key, from: show(before[key]), to: show(after[key]) })
    }
  }

  return {
    action: op.kind === 'add' ? 'added' : op.kind === 'delete' ? 'deleted' : 'edited',
    record: `${op.table} #${op.recordId}`,
    fields: fields.slice(0, MAX_FIELDS),
    ...(fields.length > MAX_FIELDS ? { moreFields: fields.length - MAX_FIELDS } : {}),
  }
}

/**
 * What a recorded change did, record by record and field by field (old value → new value), for the
 * client to read back to the user. With the history screen gone from the app, this is how the user
 * sees exactly what was done.
 */
export const describeOps = (ops: ChangeLogOp[]): { changes: OpDescription[]; moreRecords?: number } => ({
  changes: ops.slice(0, MAX_OPS).map(describeOp),
  ...(ops.length > MAX_OPS ? { moreRecords: ops.length - MAX_OPS } : {}),
})
