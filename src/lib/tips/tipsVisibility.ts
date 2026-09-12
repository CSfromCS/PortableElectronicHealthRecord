// App-local display preference, not clinical data — deliberately kept out of Dexie/sync/backup,
// same rationale as patientTabSettings (features/tabs/tabConfig.ts). A module-level store (rather
// than React Context) so any component can read/toggle it without needing a Provider wired into
// App.tsx's own render tree.
const STORAGE_KEY = 'puhrr.hideTips'

const loadHideTips = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let hideTips = loadHideTips()
const listeners = new Set<() => void>()

export const getHideTipsSnapshot = () => hideTips

export const setHideTips = (next: boolean) => {
  if (next === hideTips) return
  hideTips = next
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Storage can fail (private browsing, quota) — the toggle just won't persist this session.
  }
  listeners.forEach((listener) => listener())
}

export const subscribeHideTips = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
