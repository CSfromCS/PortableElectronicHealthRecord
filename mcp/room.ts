import { readFileSync } from 'node:fs'
import {
  type SyncConfig,
  buildSyncConfig,
  getDefaultSyncEndpoint,
  joinRoomReadOnly,
  refreshRoomReadOnly,
} from '@/features/sync/syncService'
import { type World, loadWorld } from './world'

/** How long a tool call may reuse the last download without asking the room whether it changed. */
const FRESHNESS_WINDOW_MS = 10_000

export type RoomSettings = {
  roomCode: string
  deviceName: string
  username: string
  syncEndpoint: string
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
  }
}

export type RoomStatus = {
  roomTag: string
  deviceTag: string
  lastRefreshedAt: string | null
  roomUpdatedAt: string | null
}

/**
 * Follows the sync room read-only: downloads it once, then re-downloads only when the room's own
 * timestamp moves. It has no way to push, so nothing a tool does here can change the room.
 */
export class RoomFollower {
  private config: SyncConfig | null = null
  private world: World | null = null
  private lastCheckedAt = 0
  private lastRefreshedAt: string | null = null
  private inFlight: Promise<World> | null = null

  private readonly settings: RoomSettings

  constructor(settings: RoomSettings) {
    this.settings = settings
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
    }
  }

  private async refresh(): Promise<World> {
    let changed = false

    if (!this.config) {
      const initial = await buildSyncConfig(this.settings.roomCode, this.settings.deviceName, this.settings.username, this.settings.syncEndpoint)
      this.config = (await joinRoomReadOnly(initial)).config
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
