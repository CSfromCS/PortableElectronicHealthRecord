import { db } from '@/db'
import type {
  ChangeLogEntry,
  CustomAction,
  CustomView,
  DailyUpdate,
  DateTimeFormatDefinition,
  LabEntry,
  MasterProblem,
  MedicationEntry,
  OrderEntry,
  Patient,
  ReportTemplate,
  SimpleProblemItem,
  SyncMeta,
  SyncReset,
  SyncTombstone,
  TagDefinition,
  TagEvent,
  TagGroupDefinition,
  VitalEntry,
} from '@/types'
import { normalizeDailyUpdate } from '@/features/problems/problemUtils'
import { decryptBlobToPayload, encryptPayloadToBlob, sha256Hex } from './crypto'
import { type MergeRow, type MergeSide, mergeSyncSnapshots } from './syncMerge'
import {
  applyResetData,
  applyResetLocalOnlyData,
  discardResetData,
  getSyncStateScope,
  resetsMissingFrom,
  unionResets,
} from './syncReset'
import { SYNCED_TABLE_NAMES, type SyncedTableName, deriveSyncUpdatedAt, markSyncImportTransaction } from './syncMeta'

const SYNC_CONFIG_STORAGE_KEY = 'puhrr.sync.config'
// v3 was bumped for the Master Problem List: DailyUpdate.problems changed shape from embedded
// title/notes/completed blocks to {masterProblemId, notes} references against the new
// masterProblems table — a payload from an older app version would otherwise silently
// misinterpret that field, so cross-version sync is refused instead (see pullSnapshotWithMeta).
// v4 adds per-record uid/updatedAt, date/time formats and deletion tombstones. A v3 snapshot (one
// pushed before every device updated) is still readable — its records get their sync fields as
// they're imported — while an app still on v3 refuses a v4 snapshot and asks to update.
// v5 adds the change log (what an MCP client changed, field by field). Older snapshots are
// still readable; an app on v4 refuses a v5 snapshot and asks to update, so a device that cannot
// carry those changes never takes part once an MCP client is writing.
// v6 adds reset markers (Settings → Reset room data). An app that predates them would merge the
// cleared data straight back in, so it refuses a v6 snapshot and asks to update instead.
const SYNC_DATA_VERSION = 6
const OLDEST_READABLE_SYNC_DATA_VERSION = 3
const DEFAULT_SYNC_ENDPOINT = 'https://puhr-sync.csfromcs.workers.dev'
const LEGACY_SYNC_HOSTS = new Set([
  'purh-sync-dfeeeqh8hhdhhfb0.southeastasia-01.azurewebsites.net',
])

type DeviceName = string
type SyncUsername = string

type SyncPayload = {
  version: number
  exportedAt: string
  deviceTag: string
  patients: Patient[]
  dailyUpdates: DailyUpdate[]
  vitals?: VitalEntry[]
  medications?: MedicationEntry[]
  labs?: LabEntry[]
  orders?: OrderEntry[]
  tagGroups?: TagGroupDefinition[]
  tagDefinitions?: TagDefinition[]
  tagEvents?: TagEvent[]
  reportTemplates?: ReportTemplate[]
  dateTimeFormats?: DateTimeFormatDefinition[]
  customViews?: CustomView[]
  customActions?: CustomAction[]
  masterProblems?: MasterProblem[]
  simpleProblemItems?: SimpleProblemItem[]
  changeLog?: ChangeLogEntry[]
  syncTombstones?: SyncTombstone[]
  syncResets?: SyncReset[]
}

type RemoteDescription = {
  roomTag: string
  lastPushedAt: string
  lastPushedBy: string
  username?: string
  blobSizeBytes: number
}

type SyncPushResponse = {
  gistId: string
}

type SyncCheckResponse = {
  description: string
  updatedAt: string
}

type SyncPullResponse = {
  blob: string
}

type LegacySyncVersion = {
  version: string
  committedAt: string
}

export type SyncVersion = {
  sha: string
  pushedAt: string
  deviceTag: string
  sizeBytes: number
}

export type LocalSyncVersionMeta = {
  changedAt: string | null
  sizeBytes: number
}

const isSyncVersion = (value: unknown): value is SyncVersion => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.sha === 'string'
    && typeof candidate.pushedAt === 'string'
    && typeof candidate.deviceTag === 'string'
    && typeof candidate.sizeBytes === 'number'
  )
}

const isLegacySyncVersion = (value: unknown): value is LegacySyncVersion => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.version === 'string' && typeof candidate.committedAt === 'string'
}

export type SyncConfig = {
  roomCode: string
  roomHash: string
  roomTag: string
  username: SyncUsername
  deviceName: DeviceName
  deviceTag: string
  gistId: string | null
  lastSyncedAt: string | null
  syncEndpoint: string
}

type SyncResult = {
  config: SyncConfig
  /** 'deferred': the room has changes this device wasn't allowed to apply right now. */
  operation: 'push' | 'pull' | 'merge' | 'noop' | 'deferred'
  message: string
}

export type ConflictResult = {
  kind: 'conflict' | 'first-sync'
  config: SyncConfig
  versions: SyncVersion[]
  remoteDeviceTag: string
  remotePushedAt: string
}

export type SyncNowResult = SyncResult | ConflictResult

export type SyncInsight = {
  localLatestChangeAt: string | null
  remoteLatestPushAt: string | null
  remoteLatestPushedBy: string | null
  hasLocalChangesSinceLastSync: boolean
  remoteHasNewerData: boolean
}

const normalizeSyncEndpoint = (endpoint?: string): string => {
  if (!endpoint || !endpoint.trim()) {
    return DEFAULT_SYNC_ENDPOINT
  }

  const normalizedEndpoint = endpoint.trim().replace(/\/+$/, '')

  try {
    const url = new URL(normalizedEndpoint)
    return LEGACY_SYNC_HOSTS.has(url.hostname.toLowerCase())
      ? DEFAULT_SYNC_ENDPOINT
      : normalizedEndpoint
  } catch {
    return DEFAULT_SYNC_ENDPOINT
  }
}

const isSyncConfig = (value: unknown): value is SyncConfig => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.roomCode === 'string'
    && typeof candidate.roomHash === 'string'
    && typeof candidate.roomTag === 'string'
    && (candidate.username === undefined || typeof candidate.username === 'string')
    && typeof candidate.deviceName === 'string'
    && candidate.deviceName.trim().length > 0
    && typeof candidate.deviceTag === 'string'
    && (candidate.gistId === null || typeof candidate.gistId === 'string')
    && (candidate.lastSyncedAt === null || typeof candidate.lastSyncedAt === 'string')
    && typeof candidate.syncEndpoint === 'string'
  )
}

const parseDescription = (descriptionRaw: string): RemoteDescription | null => {
  try {
    const parsed = JSON.parse(descriptionRaw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.roomTag !== 'string'
      || typeof candidate.lastPushedAt !== 'string'
      || typeof candidate.lastPushedBy !== 'string'
      || typeof candidate.blobSizeBytes !== 'number'
      || (candidate.username !== undefined && typeof candidate.username !== 'string')
    ) {
      return null
    }

    return {
      roomTag: candidate.roomTag,
      lastPushedAt: candidate.lastPushedAt,
      lastPushedBy: candidate.lastPushedBy,
      username: candidate.username,
      blobSizeBytes: candidate.blobSizeBytes,
    }
  } catch {
    return null
  }
}

const toIsoNow = (): string => new Date().toISOString()

// Every synced record's updatedAt is bumped by the hooks in syncMeta.ts on any real edit, and
// every deletion leaves a tombstone, so creates, edits and deletes all count as local changes.
export const getLatestLocalChangeAt = async (): Promise<string | null> => {
  const [recordsByTable, tombstones, resets] = await Promise.all([
    Promise.all(SYNCED_TABLE_NAMES.map((tableName) => db.table<SyncMeta>(tableName).toArray())),
    db.syncTombstones.toArray(),
    db.syncResets.toArray(),
  ])

  let latestTimestamp = 0
  const considerTimestamp = (value: string | undefined) => {
    const parsed = Date.parse(value ?? '')
    if (Number.isFinite(parsed) && parsed > latestTimestamp) {
      latestTimestamp = parsed
    }
  }

  for (const records of recordsByTable) {
    for (const record of records) {
      considerTimestamp(record.updatedAt)
    }
  }

  for (const tombstone of tombstones) {
    considerTimestamp(tombstone.deletedAt)
  }

  // A reset leaves no record behind to carry its time, so the marker does.
  for (const reset of resets) {
    considerTimestamp(reset.at)
  }

  return latestTimestamp > 0 ? new Date(latestTimestamp).toISOString() : null
}

const exportSyncPayload = async (deviceTag: string): Promise<SyncPayload> => {
  const [recordsByTable, syncTombstones, syncResets] = await Promise.all([
    Promise.all(SYNCED_TABLE_NAMES.map((tableName) => db.table(tableName).toArray())),
    db.syncTombstones.toArray(),
    db.syncResets.toArray(),
  ])

  return {
    version: SYNC_DATA_VERSION,
    exportedAt: toIsoNow(),
    deviceTag,
    ...(Object.fromEntries(SYNCED_TABLE_NAMES.map((tableName, index) => [tableName, recordsByTable[index]])) as Pick<SyncPayload, SyncedTableName>),
    syncTombstones,
    syncResets,
  }
}

const sanitizeImportedPatient = (patient: Patient): Patient => {
  return {
    ...patient,
    lastModified: patient.lastModified ?? patient.admitDate ?? toIsoNow(),
    createdAt: patient.createdAt ?? patient.admitDate ?? patient.lastModified ?? toIsoNow(),
    tagIds: patient.tagIds ?? [],
  }
}

const isSyncPayload = (value: unknown): value is SyncPayload => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.version === 'number'
    && typeof candidate.exportedAt === 'string'
    && typeof candidate.deviceTag === 'string'
    && Array.isArray(candidate.patients)
    && Array.isArray(candidate.dailyUpdates)
    && SYNCED_TABLE_NAMES.every((tableName) => candidate[tableName] === undefined || Array.isArray(candidate[tableName]))
    && (candidate.syncTombstones === undefined || Array.isArray(candidate.syncTombstones))
    && (candidate.syncResets === undefined || Array.isArray(candidate.syncResets))
  )
}

const getMissingSecondaryTables = (payload: SyncPayload): string[] => {
  const missingTables: string[] = []

  if (payload.vitals === undefined) {
    missingTables.push('vitals')
  }
  if (payload.medications === undefined) {
    missingTables.push('medications')
  }
  if (payload.labs === undefined) {
    missingTables.push('labs')
  }
  if (payload.orders === undefined) {
    missingTables.push('orders')
  }
  if (payload.tagGroups === undefined || payload.tagDefinitions === undefined) {
    missingTables.push('tags')
  }
  if (payload.reportTemplates === undefined) {
    missingTables.push('report templates')
  }
  if (payload.dateTimeFormats === undefined) {
    missingTables.push('date/time formats')
  }
  if (payload.customViews === undefined) {
    missingTables.push('custom views')
  }
  if (payload.customActions === undefined) {
    missingTables.push('custom actions')
  }
  if (payload.masterProblems === undefined) {
    missingTables.push('master problem list')
  }
  if (payload.simpleProblemItems === undefined) {
    missingTables.push('simple problem list')
  }

  return missingTables
}

const buildLegacySnapshotWarning = (missingTables: string[]): string => {
  if (missingTables.length === 0) return ''
  return ` Legacy room snapshot does not include ${missingTables.join(', ')}.`
}

const replaceSyncedTables = async (payload: SyncPayload): Promise<void> => {
  const normalizers: Partial<Record<SyncedTableName, (record: never) => unknown>> = {
    patients: sanitizeImportedPatient,
    dailyUpdates: normalizeDailyUpdate,
  }

  await db.transaction(
    'rw',
    getSyncStateScope(),
    async () => {
      markSyncImportTransaction()

      // Markers are only ever added: a device that replaces its data with an older room version
      // keeps the resets it has already applied, so they aren't applied (or lost) a second time.
      if (payload.syncResets !== undefined) {
        const localResets = await db.syncResets.toArray()
        for (const reset of resetsMissingFrom(payload.syncResets, localResets)) await applyResetLocalOnlyData(reset)
        await db.syncResets.clear()
        await db.syncResets.bulkPut(unionResets(localResets, payload.syncResets))
      }

      for (const tableName of SYNCED_TABLE_NAMES) {
        const incoming = payload[tableName] as unknown[] | undefined
        // Patients and daily updates have always been required; every other table is only
        // replaced when the snapshot carries it, so a legacy room does not wipe what it never had.
        if (incoming === undefined && tableName !== 'patients' && tableName !== 'dailyUpdates') continue

        const normalize = normalizers[tableName] as ((record: unknown) => unknown) | undefined
        const rows = (incoming ?? []).map((record) => (normalize ? normalize(record) : record))
        await db.table(tableName).clear()
        if (rows.length > 0) await db.table(tableName).bulkPut(rows)
      }

      if (payload.syncTombstones !== undefined) {
        await db.syncTombstones.clear()
        if (payload.syncTombstones.length > 0) {
          await db.syncTombstones.bulkPut(payload.syncTombstones)
        }
      }
    },
  )
}

const buildDescription = (config: SyncConfig, blobSizeBytes: number): string => {
  const description: RemoteDescription = {
    roomTag: config.roomTag,
    lastPushedAt: toIsoNow(),
    lastPushedBy: config.deviceTag,
    username: config.username,
    blobSizeBytes,
  }

  return JSON.stringify(description)
}

class SyncRequestError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'SyncRequestError'
    this.status = status
    this.body = body
  }
}

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error('Unable to reach the sync service. Sync stopped without uploading data.')
  }

  const responseText = await response.text()
  let responseBody: unknown = null
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText) as unknown
    } catch {
      responseBody = responseText
    }
  }

  if (!response.ok) {
    const serverMessage = typeof responseBody === 'string'
      ? responseBody
      : responseBody && typeof responseBody === 'object' && typeof (responseBody as Record<string, unknown>).message === 'string'
        ? String((responseBody as Record<string, unknown>).message)
        : ''
    const messageSuffix = serverMessage ? ` ${serverMessage}` : ''
    throw new SyncRequestError(
      response.status,
      `Sync request failed (${response.status}).${messageSuffix}`,
      responseBody,
    )
  }

  if (!responseText) {
    throw new Error('Sync service returned an empty response.')
  }
  if (typeof responseBody === 'string') {
    throw new Error('Sync service returned an invalid JSON response.')
  }

  return responseBody as T
}

const findRoomGist = async (config: SyncConfig): Promise<string | null> => {
  try {
    const response = await fetchJson<SyncPushResponse>(
      `${config.syncEndpoint}/api/sync/find?roomTag=${encodeURIComponent(config.roomTag)}`,
    )
    return typeof response.gistId === 'string' && response.gistId.length > 0
      ? response.gistId
      : null
  } catch (error) {
    if (error instanceof SyncRequestError && error.status === 404) return null
    throw error
  }
}

/** The room changed after this device last looked at it — someone else pushed in between. */
class RoomChangedError extends Error {
  constructor() {
    super('The sync room changed while syncing.')
    this.name = 'RoomChangedError'
  }
}

const pushSnapshot = async (config: SyncConfig, expectedRemoteUpdatedAt?: string): Promise<SyncResult> => {
  if (expectedRemoteUpdatedAt && config.gistId) {
    // Checked right before uploading so a push never silently replaces one that landed after this
    // device's last look. `expectedUpdatedAt` also goes to the Worker, which can refuse the upload
    // itself and close the remaining gap between this check and the write.
    const latest = await checkRemote(config)
    if (latest && latest.updatedAt !== expectedRemoteUpdatedAt) throw new RoomChangedError()
  }

  const payload = await exportSyncPayload(config.deviceTag)
  const encryptedBlob = await encryptPayloadToBlob(payload, config.roomCode)
  const description = buildDescription(config, encryptedBlob.length)

  const response = await fetchJson<SyncPushResponse>(`${config.syncEndpoint}/api/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      gistId: config.gistId,
      description,
      blob: encryptedBlob,
      ...(expectedRemoteUpdatedAt ? { expectedUpdatedAt: expectedRemoteUpdatedAt } : {}),
    }),
  })

  if (typeof response.gistId !== 'string' || response.gistId.length === 0) {
    throw new Error('Sync push returned an invalid Gist ID.')
  }

  const nextConfigWithoutSyncTime: SyncConfig = {
    ...config,
    gistId: response.gistId,
  }
  const remoteCheck = await checkRemote(nextConfigWithoutSyncTime)
  if (!remoteCheck) {
    throw new Error('Sync push succeeded, but remote state could not be confirmed via /api/sync/check. Check connectivity and sync again.')
  }

  const nextConfig: SyncConfig = {
    ...nextConfigWithoutSyncTime,
    lastSyncedAt: remoteCheck.updatedAt,
  }

  saveSyncConfig(nextConfig)

  return {
    config: nextConfig,
    operation: 'push',
    message: 'Pushed encrypted snapshot.',
  }
}

const pullSnapshotWithMeta = async (
  config: SyncConfig,
  sha?: string,
): Promise<{ payload: SyncPayload; blobSizeBytes: number }> => {
  if (!config.gistId) {
    throw new Error('Sync is not linked to a room gist yet.')
  }

  const search = new URLSearchParams({ gistId: config.gistId })
  if (sha) {
    search.set('sha', sha)
  }

  const response = await fetchJson<SyncPullResponse>(`${config.syncEndpoint}/api/sync/pull?${search.toString()}`)
  const payload = await decryptBlobToPayload<unknown>(response.blob, config.roomCode)

  if (!isSyncPayload(payload)) {
    throw new Error('Remote payload format is invalid.')
  }

  if (payload.version < OLDEST_READABLE_SYNC_DATA_VERSION || payload.version > SYNC_DATA_VERSION) {
    throw new Error('Remote payload version is unsupported. Please update PUHRR on both devices.')
  }

  return { payload, blobSizeBytes: response.blob.length }
}

const pullSnapshot = async (config: SyncConfig, sha?: string): Promise<SyncPayload> => {
  return (await pullSnapshotWithMeta(config, sha)).payload
}

const checkRemote = async (config: SyncConfig): Promise<SyncCheckResponse | null> => {
  if (!config.gistId) return null

  return fetchJson<SyncCheckResponse>(
    `${config.syncEndpoint}/api/sync/check?gistId=${encodeURIComponent(config.gistId)}`,
  )
}

const prepareVersionShaForPull = (versionSha: string): string | undefined => {
  return versionSha === 'latest' ? undefined : versionSha
}

const getRemoteVersions = async (config: SyncConfig, count = 5): Promise<SyncVersion[]> => {
  if (!config.gistId) return []

  const versionCount = Math.min(Math.max(Math.trunc(count), 1), 10)
  const response = await fetchJson<unknown>(
    `${config.syncEndpoint}/api/sync/versions?gistId=${encodeURIComponent(config.gistId)}&count=${versionCount}`,
  )

  if (!Array.isArray(response)) {
    throw new Error('Sync service returned an invalid version history response.')
  }

  const versions = await Promise.all(response.slice(0, versionCount).map(async (version): Promise<SyncVersion> => {
    if (isSyncVersion(version)) return version
    if (!isLegacySyncVersion(version)) {
      throw new Error('Sync service returned an incompatible version history entry.')
    }

    const snapshot = await pullSnapshotWithMeta(config, version.version)
    return {
      sha: version.version,
      pushedAt: snapshot.payload.exportedAt || version.committedAt,
      deviceTag: snapshot.payload.deviceTag,
      sizeBytes: snapshot.blobSizeBytes,
    }
  }))

  return versions.sort((first, second) => second.pushedAt.localeCompare(first.pushedAt))
}

const buildFirstSyncResult = async (config: SyncConfig): Promise<ConflictResult> => {
  const remoteCheck = await checkRemote(config)
  if (!remoteCheck) {
    throw new Error('Existing sync room could not be checked.')
  }

  const remoteDescription = parseDescription(remoteCheck.description)
  if (remoteDescription && remoteDescription.roomTag !== config.roomTag) {
    throw new Error('Remote sync room does not match this room code.')
  }

  const versionsFromServer = await getRemoteVersions(config, 5)
  const versions = versionsFromServer.length > 0
    ? versionsFromServer
    : [{
      sha: 'latest',
      pushedAt: remoteDescription?.lastPushedAt ?? remoteCheck.updatedAt,
      deviceTag: remoteDescription?.lastPushedBy ?? 'remote room version',
      sizeBytes: remoteDescription?.blobSizeBytes ?? 0,
    }]

  return {
    kind: 'first-sync',
    config,
    versions,
    remoteDeviceTag: remoteDescription?.lastPushedBy ?? 'remote room version',
    remotePushedAt: remoteDescription?.lastPushedAt ?? remoteCheck.updatedAt,
  }
}

const getExistingRoomGistId = (error: unknown): string | null => {
  if (!(error instanceof SyncRequestError) || error.status !== 409) return null
  if (!error.body || typeof error.body !== 'object') return null

  const gistId = (error.body as Record<string, unknown>).gistId
  return typeof gistId === 'string' && gistId.length > 0 ? gistId : null
}

const pushOrJoinExistingRoom = async (config: SyncConfig): Promise<SyncNowResult> => {
  try {
    return await pushSnapshot(config)
  } catch (error) {
    const existingGistId = getExistingRoomGistId(error)
    if (!existingGistId) throw error

    const linkedConfig = { ...config, gistId: existingGistId }
    saveSyncConfig(linkedConfig)
    return buildFirstSyncResult(linkedConfig)
  }
}

const toMergeSide = (payload: SyncPayload): MergeSide => {
  const tables: MergeSide['tables'] = {}
  for (const tableName of SYNCED_TABLE_NAMES) {
    const rows = payload[tableName] as MergeRow[] | undefined
    if (rows === undefined) continue
    // A v3 snapshot predates updatedAt: its records count as last edited when they say they were.
    tables[tableName] = rows.map((row) => (row.updatedAt ? row : { ...row, updatedAt: deriveSyncUpdatedAt(row) }))
  }
  return { tables, tombstones: payload.syncTombstones ?? [] }
}

/**
 * Merges the room's snapshot into this device's data inside one local transaction — reading what's
 * here, combining, and writing back with nothing in between — so an edit made while the download
 * was in flight can't be overwritten.
 */
const mergeRemoteIntoLocal = async (
  remotePayload: SyncPayload,
): Promise<{ changedLocal: boolean; changedRemote: boolean }> => {
  return db.transaction('rw', getSyncStateScope(), async () => {
    // A reset the room has and this device doesn't is applied here first, so what it cleared
    // never reaches the merge. One this device has and the room lacks is applied to the room's
    // side: its copy of the cleared tables is dropped, not merged back in.
    markSyncImportTransaction()
    const localResets = await db.syncResets.toArray()
    const remoteResets = remotePayload.syncResets ?? []
    const pendingHere = resetsMissingFrom(remoteResets, localResets)
    const missingFromRoom = resetsMissingFrom(localResets, remoteResets)
    for (const reset of pendingHere) await applyResetData(reset)

    const localTables: MergeSide['tables'] = {}
    for (const tableName of SYNCED_TABLE_NAMES) {
      localTables[tableName] = await db.table<MergeRow>(tableName).toArray()
    }
    const local: MergeSide = { tables: localTables, tombstones: await db.syncTombstones.toArray() }

    const merged = mergeSyncSnapshots(local, discardResetData(toMergeSide(remotePayload), missingFromRoom))
    const changedLocal = merged.changedLocal || pendingHere.length > 0
    if (changedLocal) {
      await replaceSyncedTables({
        ...remotePayload,
        ...(Object.fromEntries(SYNCED_TABLE_NAMES.map((tableName) => [tableName, merged.tables[tableName]])) as Record<SyncedTableName, never>),
        syncTombstones: merged.tombstones,
        syncResets: unionResets(localResets, remoteResets),
      })
    }

    return { changedLocal, changedRemote: merged.changedRemote || missingFromRoom.length > 0 }
  })
}

const MAX_MERGE_ATTEMPTS = 3

/** Pulls the room, merges it with this device's data, and uploads the result if the room is
 * missing anything. If someone else pushes while this runs, the room is read and merged again. */
const mergeWithRoom = async (config: SyncConfig): Promise<SyncResult> => {
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
    const remoteCheck = await checkRemote(config)
    if (!remoteCheck) throw new Error('Linked sync room could not be checked.')

    const remotePayload = await pullSnapshot(config)
    const { changedLocal, changedRemote } = await mergeRemoteIntoLocal(remotePayload)
    const legacySnapshotWarning = buildLegacySnapshotWarning(getMissingSecondaryTables(remotePayload))

    if (!changedRemote) {
      const syncedConfig = { ...config, lastSyncedAt: remoteCheck.updatedAt }
      saveSyncConfig(syncedConfig)
      return {
        config: syncedConfig,
        operation: changedLocal ? 'pull' : 'noop',
        message: changedLocal ? `Pulled latest room data.${legacySnapshotWarning}` : 'Already synced.',
      }
    }

    try {
      const pushed = await pushSnapshot(config, remoteCheck.updatedAt)
      return {
        ...pushed,
        operation: changedLocal ? 'merge' : 'push',
        message: changedLocal
          ? `Merged room changes with this device and uploaded the result.${legacySnapshotWarning}`
          : pushed.message,
      }
    } catch (error) {
      if (!(error instanceof RoomChangedError)) throw error
    }
  }

  throw new Error('The sync room kept changing while syncing. Wait a moment and sync again.')
}

export const getSyncInsight = async (currentConfig: SyncConfig): Promise<SyncInsight> => {
  const config = {
    ...currentConfig,
    syncEndpoint: normalizeSyncEndpoint(currentConfig.syncEndpoint),
  }

  const localLatestChangeAt = await getLatestLocalChangeAt()
  const localLatestMs = localLatestChangeAt ? Date.parse(localLatestChangeAt) : Number.NaN
  const lastSyncedMs = config.lastSyncedAt ? Date.parse(config.lastSyncedAt) : Number.NaN

  const hasLocalChangesSinceLastSync = Number.isFinite(lastSyncedMs)
    ? Number.isFinite(localLatestMs) && localLatestMs > lastSyncedMs
    : Number.isFinite(localLatestMs)

  if (!config.gistId) {
    return {
      localLatestChangeAt,
      remoteLatestPushAt: null,
      remoteLatestPushedBy: null,
      hasLocalChangesSinceLastSync,
      remoteHasNewerData: false,
    }
  }

  const remoteCheck = await checkRemote(config)
  if (!remoteCheck) {
    return {
      localLatestChangeAt,
      remoteLatestPushAt: null,
      remoteLatestPushedBy: null,
      hasLocalChangesSinceLastSync,
      remoteHasNewerData: false,
    }
  }

  const remoteDescription = parseDescription(remoteCheck.description)
  const remoteLatestPushAt = remoteDescription?.lastPushedAt ?? remoteCheck.updatedAt
  const remoteLatestPushedBy = remoteDescription?.lastPushedBy ?? null
  const remoteUpdatedMs = Date.parse(remoteCheck.updatedAt)

  const remoteHasNewerData = Number.isFinite(lastSyncedMs)
    ? Number.isFinite(remoteUpdatedMs) && remoteUpdatedMs > lastSyncedMs
    : Number.isFinite(remoteUpdatedMs)

  return {
    localLatestChangeAt,
    remoteLatestPushAt,
    remoteLatestPushedBy,
    hasLocalChangesSinceLastSync,
    remoteHasNewerData,
  }
}

export const getLocalSyncVersionMeta = async (currentConfig: SyncConfig): Promise<LocalSyncVersionMeta> => {
  const config = {
    ...currentConfig,
    syncEndpoint: normalizeSyncEndpoint(currentConfig.syncEndpoint),
  }

  const payload = await exportSyncPayload(config.deviceTag)
  const encryptedBlob = await encryptPayloadToBlob(payload, config.roomCode)
  const changedAt = await getLatestLocalChangeAt()

  return {
    changedAt,
    sizeBytes: encryptedBlob.length,
  }
}

export const readSyncConfig = (): SyncConfig | null => {
  if (typeof window === 'undefined') return null

  const rawValue = window.localStorage.getItem(SYNC_CONFIG_STORAGE_KEY)
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!isSyncConfig(parsed)) return null

    const normalizedUsername = typeof parsed.username === 'string' && parsed.username.trim().length > 0
      ? parsed.username.trim()
      : parsed.deviceName

    const normalizedConfig = {
      ...parsed,
      username: normalizedUsername,
      syncEndpoint: normalizeSyncEndpoint(parsed.syncEndpoint),
    }
    if (normalizedConfig.syncEndpoint !== parsed.syncEndpoint) {
      window.localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(normalizedConfig))
    }
    return normalizedConfig
  } catch {
    return null
  }
}

export const saveSyncConfig = (config: SyncConfig): void => {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(
    SYNC_CONFIG_STORAGE_KEY,
    JSON.stringify({
      ...config,
      syncEndpoint: normalizeSyncEndpoint(config.syncEndpoint),
    }),
  )
}

export const buildSyncConfig = async (
  roomCode: string,
  deviceName: DeviceName,
  username: SyncUsername,
  syncEndpoint?: string,
): Promise<SyncConfig> => {
  const normalizedRoomCode = roomCode.trim()
  if (!normalizedRoomCode) {
    throw new Error('Room code is required.')
  }
  const normalizedDeviceName = deviceName.trim()
  if (!normalizedDeviceName) {
    throw new Error('Device name is required.')
  }
  const normalizedUsername = username.trim()
  if (!normalizedUsername) {
    throw new Error('User name is required.')
  }

  const roomHash = await sha256Hex(normalizedRoomCode)
  const roomTag = roomHash.slice(0, 5)
  const deviceTag = `${roomTag}-${normalizedDeviceName}`

  return {
    roomCode: normalizedRoomCode,
    roomHash,
    roomTag,
    username: normalizedUsername,
    deviceName: normalizedDeviceName,
    deviceTag,
    gistId: null,
    lastSyncedAt: null,
    syncEndpoint: normalizeSyncEndpoint(syncEndpoint),
  }
}

export type SyncNowOptions = {
  /** When false, a sync that would have to change this device's data (pulling or merging the
   * room's changes) is skipped with a 'deferred' result instead. Background sync uses this while a
   * patient is open, so data doesn't change under the form being edited. Defaults to true. */
  allowLocalChanges?: boolean
}

// Syncs never overlap: the button, the background timer and a retry could otherwise start two at
// once, each reading the room and writing local data at the same time.
let syncQueue: Promise<unknown> = Promise.resolve()
const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const result = syncQueue.then(task, task)
  syncQueue = result.catch(() => undefined)
  return result
}

const syncNowUnlocked = async (currentConfig: SyncConfig, options: SyncNowOptions): Promise<SyncNowResult> => {
  const allowLocalChanges = options.allowLocalChanges ?? true
  const deferred = (config: SyncConfig): SyncResult => ({
    config,
    operation: 'deferred',
    message: 'The room has updates that will be applied once you leave the open patient.',
  })
  const config = {
    ...currentConfig,
    syncEndpoint: normalizeSyncEndpoint(currentConfig.syncEndpoint),
  }

  let linkedConfig = config

  if (!linkedConfig.gistId) {
    const foundGistId = await findRoomGist(linkedConfig)
    if (foundGistId) {
      linkedConfig = { ...linkedConfig, gistId: foundGistId }
      saveSyncConfig(linkedConfig)
      return buildFirstSyncResult(linkedConfig)
    }

    return pushOrJoinExistingRoom(linkedConfig)
  }

  const remoteCheck = await checkRemote(linkedConfig)
  if (!remoteCheck) {
    throw new Error('Linked sync room could not be checked.')
  }

  const remoteDescription = parseDescription(remoteCheck.description)
  if (remoteDescription && remoteDescription.roomTag !== linkedConfig.roomTag) {
    throw new Error('Remote sync room does not match this room code.')
  }

  if (!linkedConfig.lastSyncedAt) {
    return buildFirstSyncResult(linkedConfig)
  }

  const lastSyncedMs = linkedConfig.lastSyncedAt ? Date.parse(linkedConfig.lastSyncedAt) : Number.NaN
  const remoteUpdatedMs = Date.parse(remoteCheck.updatedAt)
  const localLatestChange = await getLatestLocalChangeAt()
  const localLatestMs = localLatestChange ? Date.parse(localLatestChange) : Number.NaN

  const hasLocalChangesSinceLastSync = Number.isFinite(lastSyncedMs)
    ? Number.isFinite(localLatestMs) && localLatestMs > lastSyncedMs
    : Number.isFinite(localLatestMs)

  const remoteIsNewSinceLastSync = Number.isFinite(lastSyncedMs)
    ? Number.isFinite(remoteUpdatedMs) && remoteUpdatedMs > lastSyncedMs
    : Number.isFinite(remoteUpdatedMs)

  if (remoteIsNewSinceLastSync) {
    return allowLocalChanges ? mergeWithRoom(linkedConfig) : deferred(linkedConfig)
  }

  if (!hasLocalChangesSinceLastSync) {
    return {
      config: linkedConfig,
      operation: 'noop',
      message: 'Already synced.',
    }
  }

  try {
    return await pushSnapshot(linkedConfig, remoteCheck.updatedAt)
  } catch (error) {
    if (!(error instanceof RoomChangedError)) throw error
    return allowLocalChanges ? mergeWithRoom(linkedConfig) : deferred(linkedConfig)
  }
}

export const syncNow = (currentConfig: SyncConfig, options: SyncNowOptions = {}): Promise<SyncNowResult> =>
  runExclusive(() => syncNowUnlocked(currentConfig, options))

export const resolveConflictKeepLocal = (config: SyncConfig): Promise<SyncResult> =>
  runExclusive(() => pushSnapshot(config))

export const resolveConflictWithVersion = (config: SyncConfig, versionSha: string): Promise<SyncResult> =>
  runExclusive(() => resolveConflictWithVersionUnlocked(config, versionSha))

const resolveConflictWithVersionUnlocked = async (
  config: SyncConfig,
  versionSha: string,
): Promise<SyncResult> => {
  const remoteCheck = await checkRemote(config)
  if (!remoteCheck) {
    throw new Error('Linked sync room could not be checked.')
  }

  const preparedVersionSha = prepareVersionShaForPull(versionSha)
  const payload = await pullSnapshot(config, preparedVersionSha)
  await replaceSyncedTables(payload)
  const legacySnapshotWarning = buildLegacySnapshotWarning(getMissingSecondaryTables(payload))

  if (preparedVersionSha) {
    const restoredResult = await pushSnapshot(config)
    return {
      ...restoredResult,
      message: `Restored the selected room version as the latest snapshot.${legacySnapshotWarning}`,
    }
  }

  const updatedConfig = {
    ...config,
    lastSyncedAt: remoteCheck.updatedAt,
  }
  saveSyncConfig(updatedConfig)

  return {
    config: updatedConfig,
    operation: 'pull',
    message: `Pulled selected room version.${legacySnapshotWarning}`,
  }
}

/**
 * Read-only access to a room, for a process that only ever follows it (the MCP server). It never
 * pushes: joining downloads the room over whatever this process holds, and refreshing re-downloads
 * only when the room has changed. Unlike `syncNow` it can't create a room, so a wrong room code
 * fails instead of uploading a new empty one.
 */
export const joinRoomReadOnly = (currentConfig: SyncConfig): Promise<SyncResult> => runExclusive(async () => {
  const config = { ...currentConfig, syncEndpoint: normalizeSyncEndpoint(currentConfig.syncEndpoint) }
  const gistId = await findRoomGist(config)
  if (!gistId) throw new Error('No sync room exists for this room code.')
  const linkedConfig = { ...config, gistId }
  saveSyncConfig(linkedConfig)
  return resolveConflictWithVersionUnlocked(linkedConfig, 'latest')
})

export const refreshRoomReadOnly = (config: SyncConfig): Promise<{ config: SyncConfig; changed: boolean }> => runExclusive(async () => {
  const remoteCheck = await checkRemote(config)
  if (!remoteCheck) throw new Error('Linked sync room could not be checked.')
  if (config.lastSyncedAt === remoteCheck.updatedAt) return { config, changed: false }
  const result = await resolveConflictWithVersionUnlocked(config, 'latest')
  return { config: result.config, changed: true }
})

/**
 * Reconciles this process's data with the room right now: downloads the room, merges it with what's
 * here, and uploads the result if the room is missing anything. Unlike `syncNow` it doesn't decide
 * from timestamps whether there's anything to send, so a change made on a device with a slightly
 * wrong clock is still uploaded. The MCP server calls it after each change it makes.
 */
export const syncWithRoom = (config: SyncConfig): Promise<SyncResult> => runExclusive(() => mergeWithRoom(config))

export const getDefaultSyncEndpoint = (): string => DEFAULT_SYNC_ENDPOINT
