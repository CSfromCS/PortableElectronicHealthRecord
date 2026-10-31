import { db } from '@/db'
import { SYNC_TOMBSTONE_RETENTION_DAYS } from './syncMeta'

/** Drops this device's deletion records that every device has long since applied (see
 * SYNC_TOMBSTONE_RETENTION_DAYS). Returns how many it dropped. Sync already leaves them out of what
 * it uploads and merges; this just stops them piling up locally. */
export const pruneExpiredTombstones = async (now = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - SYNC_TOMBSTONE_RETENTION_DAYS * 86_400_000).toISOString()
  const expired = await db.syncTombstones.where('deletedAt').below(cutoff).primaryKeys()
  if (expired.length > 0) await db.syncTombstones.bulkDelete(expired)
  return expired.length
}
