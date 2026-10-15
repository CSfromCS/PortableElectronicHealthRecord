import { MAX_OPS, compactOp } from '@/features/changes/changeLog'
import type { ChangeLogField, ChangeLogOp } from '@/types'

export type OpDescription = {
  action: 'added' | 'edited' | 'deleted'
  record: string
  fields: ChangeLogField[]
  moreFields?: number
}

const describeOp = (op: ChangeLogOp): OpDescription => {
  const { table, recordId, kind, fields = [], moreFields } = compactOp(op)
  return {
    action: kind === 'add' ? 'added' : kind === 'delete' ? 'deleted' : 'edited',
    record: `${table} #${recordId}`,
    fields,
    ...(moreFields ? { moreFields } : {}),
  }
}

/**
 * What a recorded change did, record by record and field by field (old value → new value), for the
 * client to read back to the user. With the history screen gone from the app, this is how the user
 * sees exactly what was done.
 */
export const describeOps = (ops: ChangeLogOp[], moreOps = 0): { changes: OpDescription[]; moreRecords?: number } => {
  // Entries from before the log kept only changed fields can list more than MAX_OPS.
  const shown = ops.slice(0, MAX_OPS)
  const more = moreOps + ops.length - shown.length
  return {
    changes: shown.map(describeOp),
    ...(more > 0 ? { moreRecords: more } : {}),
  }
}
