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
