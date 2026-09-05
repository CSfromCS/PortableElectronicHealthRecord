export type PatientTabId =
  | 'profile'
  | 'database'
  | 'problems'
  | 'checklist'
  | 'vitals'
  | 'labs'
  | 'medications'
  | 'orders'
  | 'photos'

export const PATIENT_TAB_LABELS: Record<PatientTabId, string> = {
  profile: 'Profile',
  database: 'Database',
  problems: 'Problems',
  checklist: 'Checklist',
  vitals: 'Vitals',
  labs: 'Labs',
  medications: 'Meds',
  orders: 'Orders',
  photos: 'Photos',
}

export const PATIENT_TAB_DESCRIPTIONS: Record<PatientTabId, string> = {
  profile: 'Demographics, admission/referral dates, service, diagnosis, clinical summary, and tags',
  database: 'Single unstructured scratch pad (chief complaint, HPI, PMH, PE, clerk notes, etc.)',
  problems: 'Ordered, date-based problem blocks with free-text notes — unresolved problems carry forward automatically',
  checklist: 'Per-date task checklist — pending items carry forward automatically',
  vitals: 'Structured BP/HR/RR/Temp/SpO2 log with date & time entries',
  labs: 'CBC, UA, Blood Chem, ABG templates + free-text with date/time',
  medications: 'Structured medication list: drug, dose, route, frequency, status, plus drag-to-reorder',
  orders: "Doctor's orders with date, time, service & status tracking",
  photos: 'Categorized image attachments with grouped uploads & carousel',
}

export const DEFAULT_PATIENT_TAB_ORDER: PatientTabId[] = [
  'profile',
  'database',
  'problems',
  'checklist',
  'vitals',
  'labs',
  'medications',
  'orders',
  'photos',
]

export type PatientTabSetting = { id: PatientTabId; visible: boolean }

export const DEFAULT_PATIENT_TAB_SETTINGS: PatientTabSetting[] = DEFAULT_PATIENT_TAB_ORDER.map((id) => ({
  id,
  visible: true,
}))

// App-local display preference, not clinical data — deliberately kept out of Dexie/sync/backup,
// matching how SyncConfig already uses localStorage for device-local settings.
const STORAGE_KEY = 'puhrr.patientTabSettings'

export const loadPatientTabSettings = (): PatientTabSetting[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PATIENT_TAB_SETTINGS

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_PATIENT_TAB_SETTINGS

    const seen = new Set<PatientTabId>()
    const settings: PatientTabSetting[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Record<string, unknown>
      const id = candidate.id
      if (typeof id !== 'string' || !DEFAULT_PATIENT_TAB_ORDER.includes(id as PatientTabId)) continue
      const tabId = id as PatientTabId
      if (seen.has(tabId)) continue
      seen.add(tabId)
      settings.push({ id: tabId, visible: typeof candidate.visible === 'boolean' ? candidate.visible : true })
    }

    // Append any tabs the stored settings predate (e.g. a new tab shipped in an app update).
    for (const id of DEFAULT_PATIENT_TAB_ORDER) {
      if (!seen.has(id)) settings.push({ id, visible: true })
    }

    return settings.length > 0 ? settings : DEFAULT_PATIENT_TAB_SETTINGS
  } catch {
    return DEFAULT_PATIENT_TAB_SETTINGS
  }
}

export const savePatientTabSettings = (settings: PatientTabSetting[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage can fail (private browsing, quota) — tab layout just won't persist this session.
  }
}
