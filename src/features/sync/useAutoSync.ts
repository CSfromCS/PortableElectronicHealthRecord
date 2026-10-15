import { useEffect, useRef } from 'react'
import { type SyncConfig, type SyncNowResult, syncNow } from './syncService'
import { subscribeToLocalSyncedChanges } from './syncMeta'

/** How long after the last edit before it's pushed — long enough that typing in a field is one
 * push, short enough that another device sees the change within seconds. */
export const AUTO_SYNC_PUSH_DELAY_MS = 5_000
/** How often an open, visible PUHRR checks the room for changes made elsewhere. */
export const AUTO_SYNC_POLL_INTERVAL_MS = 60_000

type UseAutoSyncOptions = {
  config: SyncConfig | null
  /** False while a patient is open, so pulled changes don't land under a form being edited. */
  canApplyRemoteChanges: boolean
  /** Called after a background sync that moved data in either direction. */
  onSynced: (result: Exclude<SyncNowResult, { kind: 'conflict' | 'first-sync' }>) => void
  /** Called after a background sync that left the room's changes for later. */
  onDeferred: (config: SyncConfig) => void
}

/**
 * Keeps this device in step with the sync room without the Sync button: pushes a few seconds after
 * edits, and pulls when PUHRR opens, comes back to the foreground or online, and every minute while
 * it's on screen. Only runs for a device that has already finished its first sync, because that
 * one needs a human choice (upload or download). Network failures are silent: the next trigger
 * just tries again, and the Sync button still shows the true state.
 */
export const useAutoSync = ({ config, canApplyRemoteChanges, onSynced, onDeferred }: UseAutoSyncOptions): void => {
  // Refs hold the latest values so the timers below never need to be torn down and rebuilt.
  const configRef = useRef(config)
  const canApplyRef = useRef(canApplyRemoteChanges)
  const onSyncedRef = useRef(onSynced)
  const onDeferredRef = useRef(onDeferred)
  useEffect(() => {
    configRef.current = config
    canApplyRef.current = canApplyRemoteChanges
    onSyncedRef.current = onSynced
    onDeferredRef.current = onDeferred
  })

  const isEnabled = Boolean(config?.gistId && config.lastSyncedAt)
  const runRef = useRef<() => void>(undefined)

  useEffect(() => {
    if (!isEnabled || typeof window === 'undefined') return undefined

    let pushTimer: number | undefined
    let isRunning = false
    let runAgain = false
    let isDisposed = false

    const run = async () => {
      const current = configRef.current
      if (!current || isDisposed || document.visibilityState === 'hidden' || navigator.onLine === false) return
      if (isRunning) {
        runAgain = true
        return
      }

      isRunning = true
      try {
        const result = await syncNow(current, { allowLocalChanges: canApplyRef.current })
        if (isDisposed || 'kind' in result) return
        if (result.operation === 'deferred') onDeferredRef.current(result.config)
        else if (result.operation !== 'noop') onSyncedRef.current(result)
      } catch {
        // Offline, a sleeping tab or a busy Worker: the next trigger retries.
      } finally {
        isRunning = false
        if (runAgain && !isDisposed) {
          runAgain = false
          void run()
        }
      }
    }

    runRef.current = () => void run()

    const schedulePush = () => {
      window.clearTimeout(pushTimer)
      pushTimer = window.setTimeout(() => void run(), AUTO_SYNC_PUSH_DELAY_MS)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void run()
    }
    const onOnline = () => void run()

    const unsubscribe = subscribeToLocalSyncedChanges(schedulePush)
    const pollTimer = window.setInterval(() => void run(), AUTO_SYNC_POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    void run()

    return () => {
      runRef.current = undefined
      isDisposed = true
      unsubscribe()
      window.clearTimeout(pushTimer)
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [isEnabled])

  // Leaving the open patient is the moment deferred room changes can finally be applied.
  useEffect(() => {
    if (canApplyRemoteChanges) runRef.current?.()
  }, [canApplyRemoteChanges])
}
