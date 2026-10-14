import { readFileSync } from 'node:fs'
import {
  type SyncConfig,
  buildSyncConfig,
  getDefaultSyncEndpoint,
  joinRoomReadOnly,
  refreshRoomReadOnly,
  syncWithRoom,
} from '@/features/sync/syncService'
import { type World, loadWorld } from './world'

/** How long a tool call may reuse the last download without asking the room whether it changed. */
const FRESHNESS_WINDOW_MS = 10_000

export type RoomSettings = {
  roomCode: string
  deviceName: string
  username: string
  syncEndpoint: string
  /** Whether write tools exist at all. Off unless PUHRR_ALLOW_WRITES is set. */
  allowWrites: boolean
}

/** The room code unlocks all patient data, so it's read from a file that only the bridge's
 * service account can read (PUHRR_ROOM_CODE_FILE); an environment variable is the fallback. */
export const readRoomSettings = (env: NodeJS.ProcessEnv = process.env): RoomSettings => {
  const fromFile = env.PUHRR_ROOM_CODE_FILE ? readFileSync(env.PUHRR_ROOM_CODE_FILE, 'utf8').trim() : ''
  const roomCode = fromFile || env.PUHRR_ROOM_CODE?.trim() || ''
  if (!roomCode) {
    throw new Error('Set PUHRR_ROOM_CODE_FILE (a file holding the room code) or PUHRR_ROOM_CODE.')
  }
  return {
    roomCode,
    deviceName: env.PUHRR_DEVICE_NAME?.trim() || 'Medmin',
    username: env.PUHRR_USERNAME?.trim() || 'Medmin',
    syncEndpoint: env.PUHRR_SYNC_ENDPOINT?.trim() || getDefaultSyncEndpoint(),
    allowWrites: /^(1|true|yes)$/i.test(env.PUHRR_ALLOW_WRITES?.trim() ?? ''),
  }
}

export type RoomStatus = {
  roomTag: string
  deviceTag: string
  lastRefreshedAt: string | null
  roomUpdatedAt: string | null
  /** True while a change made here hasn't reached the room yet. */
  hasUnsyncedChanges: boolean
}

export type WriteOutcome<T> = {
  result: T
  /** False when the change was made here but the room couldn't be reached to store it. */
  stored: boolean
  warning?: string
}

/**
 * Follows the sync room. By default it only reads: it downloads the room once, then re-downloads
 * only when the room's own timestamp moves. When writes are allowed, `write` makes a change on top
 * of the freshest copy and uploads it before returning.
 */
export class RoomFollower {
  private config: SyncConfig | null = null
  private world: World | null = null
  private lastCheckedAt = 0
  private lastRefreshedAt: string | null = null
  private inFlight: Promise<World> | null = null
  private writeQueue: Promise<unknown> = Promise.resolve()
  /** A change was made here and not yet stored in the room, so a plain re-download would erase it. */
  private unsynced = false
  private readonly settings: RoomSettings

  constructor(settings: RoomSettings) {
    this.settings = settings
  }

  get allowWrites(): boolean {
    return this.settings.allowWrites
  }

  /** The room's current contents, no older than a few seconds. Concurrent callers share one refresh. */
  getWorld(): Promise<World> {
    if (this.world && Date.now() - this.lastCheckedAt < FRESHNESS_WINDOW_MS) return Promise.resolve(this.world)
    this.inFlight ??= this.refresh().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  /** Skips the freshness window — for a caller that knows the room just changed. */
  forceRefresh(): Promise<World> {
    this.lastCheckedAt = 0
    return this.getWorld()
  }

  status(): RoomStatus {
    return {
      roomTag: this.config?.roomTag ?? '',
      deviceTag: this.config?.deviceTag ?? '',
      lastRefreshedAt: this.lastRefreshedAt,
      roomUpdatedAt: this.config?.lastSyncedAt ?? null,
      hasUnsyncedChanges: this.unsynced,
    }
  }

  /**
   * Makes a change: brings this copy up to date with the room, runs `work` on it, then merges with
   * the room again and uploads the result. Changes are made one at a time, so two tool calls can
   * never interleave. If the upload fails the change stays here and is retried with the next one.
   */
  write<T>(work: (world: World) => Promise<T>): Promise<WriteOutcome<T>> {
    if (!this.settings.allowWrites) return Promise.reject(new Error('This connection is read-only.'))
    const run = async (): Promise<WriteOutcome<T>> => {
      const world = await this.forceRefresh()
      const result = await work(world)

      let stored = true
      let warning: string | undefined
      try {
        if (!this.config) throw new Error('Not connected to the room.')
        this.config = (await syncWithRoom(this.config)).config
        this.unsynced = false
      } catch (error) {
        stored = false
        this.unsynced = true
        warning = `The change was made, but it could not be stored in the sync room (${error instanceof Error ? error.message : String(error)}). It will be retried with the next change; until then PUHRR on the user's devices does not have it.`
      }

      this.world = await loadWorld()
      this.lastRefreshedAt = new Date().toISOString()
      this.lastCheckedAt = Date.now()
      return { result, stored, warning }
    }
    const next = this.writeQueue.then(run, run)
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  private async refresh(): Promise<World> {
    let changed = false

    if (!this.config) {
      const initial = await buildSyncConfig(this.settings.roomCode, this.settings.deviceName, this.settings.username, this.settings.syncEndpoint)
      this.config = (await joinRoomReadOnly(initial)).config
      changed = true
    } else if (this.unsynced) {
      // A plain re-download would replace the unsent change; merge it with the room instead.
      this.config = (await syncWithRoom(this.config)).config
      this.unsynced = false
      changed = true
    } else {
      const result = await refreshRoomReadOnly(this.config)
      this.config = result.config
      changed = result.changed
    }

    if (changed || !this.world) {
      this.world = await loadWorld()
      this.lastRefreshedAt = new Date().toISOString()
    }
    this.lastCheckedAt = Date.now()
    return this.world
  }
}
