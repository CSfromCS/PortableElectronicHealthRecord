import type { TagFilterMode } from './patientFilterUtils'

export type FilterViewKey = 'patients' | 'checklist' | 'census'

// App-local display preference, not clinical data — deliberately kept out of Dexie/sync/backup,
// matching how tabConfig.ts and SyncConfig already use localStorage for device-local settings.
const modeStorageKey = (view: FilterViewKey) => `puhrr.patientFilter.${view}.tagMode`

/** Point 3 of issue #81: the Tag facet's AND/OR toggle is sticky per view, defaulting to OR only the first time a view's filter is ever used. */
export const loadTagFilterMode = (view: FilterViewKey): TagFilterMode => {
  try {
    const raw = window.localStorage.getItem(modeStorageKey(view))
    return raw === 'AND' ? 'AND' : 'OR'
  } catch {
    return 'OR'
  }
}

export const saveTagFilterMode = (view: FilterViewKey, mode: TagFilterMode) => {
  try {
    window.localStorage.setItem(modeStorageKey(view), mode)
  } catch {
    // Storage can fail (private browsing, quota) — the toggle just won't persist this session.
  }
}

const CENSUS_WINDOW_BOOKMARK_KEY = 'puhrr.patientFilter.census.lastGeneratedAt'

/** Convenience default for the Patient Pool facet's shared window: pre-fills "From" with the last
 * time a Multiple Census/Vitals export was generated, so the common workflow (generate once near
 * shift start, again near the end) needs no manual date entry. Always overridable by hand. */
export const loadCensusWindowBookmark = (): string | null => {
  try {
    return window.localStorage.getItem(CENSUS_WINDOW_BOOKMARK_KEY)
  } catch {
    return null
  }
}

export const saveCensusWindowBookmark = (isoTimestamp: string) => {
  try {
    window.localStorage.setItem(CENSUS_WINDOW_BOOKMARK_KEY, isoTimestamp)
  } catch {
    // Storage can fail (private browsing, quota) — the bookmark just won't persist this session.
  }
}
