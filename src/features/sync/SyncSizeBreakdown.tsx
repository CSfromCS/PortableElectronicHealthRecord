import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/features/photos/photoUtils'
import { getSyncSizeBreakdown, type SyncSizeBreakdown as Breakdown } from './syncService'

const TABLE_LABELS: Record<string, string> = {
  patients: 'Patients',
  dailyUpdates: 'Daily notes and checklists',
  vitals: 'Vitals',
  medications: 'Medications',
  labs: 'Labs',
  orders: 'Orders',
  tagGroups: 'Tag groups',
  tagDefinitions: 'Tags',
  tagEvents: 'Tag history',
  reportTemplates: 'Report templates',
  dateTimeFormats: 'Date/time formats',
  customViews: 'Custom views',
  customActions: 'Custom actions',
  masterProblems: 'Master Problem List',
  simpleProblemItems: 'Simple problem list',
  changeLog: 'Change log',
  syncTombstones: 'Deletion history',
  syncResets: 'Reset markers',
}

type SyncSizeBreakdownProps = {
  deviceTag: string
  roomCode?: string
}

/** Settings → Sync Status: which tables make up the sync snapshot, measured on demand. */
export function SyncSizeBreakdown({ deviceTag, roomCode }: SyncSizeBreakdownProps) {
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [isMeasuring, setIsMeasuring] = useState(false)
  const [failed, setFailed] = useState(false)

  const measure = async () => {
    setIsMeasuring(true)
    setFailed(false)
    try {
      setBreakdown(await getSyncSizeBreakdown(deviceTag, roomCode))
    } catch {
      setFailed(true)
    } finally {
      setIsMeasuring(false)
    }
  }

  const rows = breakdown?.rows.filter((row) => row.bytes > 2) ?? []

  return (
    <div className='space-y-2'>
      <Button size='sm' variant='secondary' onClick={() => void measure()} disabled={isMeasuring}>
        {isMeasuring ? 'Measuring…' : breakdown ? 'Measure again' : 'Measure sync size'}
      </Button>
      {failed ? <p className='text-xs text-action-danger'>Could not measure the sync size.</p> : null}
      {breakdown ? (
        <div className='space-y-1 text-xs text-espresso'>
          <p>
            <strong>Uploaded to the room:</strong> {breakdown.uploadBytes === null ? 'unknown' : formatBytes(breakdown.uploadBytes)}
            {' '}(compressed and encrypted). <strong>Plain data:</strong> {formatBytes(breakdown.totalBytes)}.
          </p>
          <ul className='space-y-0.5'>
            {rows.map((row) => (
              <li key={row.table} className='flex justify-between gap-3'>
                <span className='min-w-0 truncate'>{TABLE_LABELS[row.table] ?? row.table} ({row.records})</span>
                <span className='shrink-0 tabular-nums text-clay'>
                  {formatBytes(row.bytes)} · {Math.round((row.bytes / Math.max(breakdown.totalBytes, 1)) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
