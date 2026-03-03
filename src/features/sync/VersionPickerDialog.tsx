import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { SyncVersion } from './syncService'

type VersionPickerDialogProps = {
  open: boolean
  mode?: 'conflict' | 'first-sync'
  versions: SyncVersion[]
  localDeviceTag: string
  localVersionMeta?: {
    changedAt: string | null
    sizeBytes: number
  } | null
  selectedVersion: string
  onSelectVersion: (value: string) => void
  onResolve: () => Promise<void>
  onOpenChange: (open: boolean) => void
  isResolving: boolean
}

const formatSize = (sizeBytes: number): string => {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDateTime = (isoString: string | null): string => {
  if (!isoString) return '—'

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function VersionPickerDialog({
  open,
  mode = 'conflict',
  versions,
  localDeviceTag,
  localVersionMeta,
  selectedVersion,
  onSelectVersion,
  onResolve,
  onOpenChange,
  isResolving,
}: VersionPickerDialogProps) {
  const isFirstSync = mode === 'first-sync'
  const localSizeLabel = localVersionMeta ? formatSize(localVersionMeta.sizeBytes) : '—'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{isFirstSync ? 'Choose first sync direction' : 'Resolve sync conflict'}</DialogTitle>
        </DialogHeader>
        <p className='text-sm text-clay'>
          {isFirstSync
            ? 'A room snapshot already exists. Choose whether to upload this device now or download room data first.'
            : 'Both devices changed since last sync. Pick one version to keep.'}
        </p>
        <div className='space-y-2 max-h-[52vh] overflow-y-auto pr-1'>
          <button
            type='button'
            className={cn(
              'w-full rounded-lg border px-3 py-2 text-left transition-colors',
              selectedVersion === 'local'
                ? 'border-action-primary bg-action-primary/10'
                : 'border-clay/25 bg-warm-ivory hover:bg-blush-sand/45',
            )}
            onClick={() => onSelectVersion('local')}
          >
            <p className='text-sm font-semibold text-espresso'>
              {isFirstSync ? `Upload this device (${localDeviceTag})` : `Keep current (${localDeviceTag})`}
            </p>
            <p className='text-xs text-clay'>
              {isFirstSync ? 'Push local data to the room.' : 'Use this device state and overwrite remote.'}
            </p>
            <p className='text-xs text-clay'>
              {formatDateTime(localVersionMeta?.changedAt ?? null)}
              {' · '}
              {localSizeLabel}
            </p>
          </button>

          {versions.map((version) => (
            <button
              key={version.sha}
              type='button'
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                selectedVersion === version.sha
                  ? 'border-action-primary bg-action-primary/10'
                  : 'border-clay/25 bg-warm-ivory hover:bg-blush-sand/45',
              )}
              onClick={() => onSelectVersion(version.sha)}
            >
              <p className='text-sm font-semibold text-espresso'>{version.deviceTag}</p>
              <p className='text-xs text-clay'>
                {new Date(version.pushedAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {' · '}
                {formatSize(version.sizeBytes)}
              </p>
            </button>
          ))}
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='secondary' onClick={() => onOpenChange(false)} disabled={isResolving}>Cancel</Button>
          <Button onClick={() => void onResolve()} disabled={isResolving}>
            {isResolving ? 'Applying...' : isFirstSync ? 'Continue' : 'Use selected'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
