export interface Patient {
  id?: number
  lastModified: string
  /** Set once at creation; used as the computed default for Admission Date and Referral Date until the user types an override. */
  createdAt: string
  roomNumber: string
  ward: string
  /** Set only when the legacy combined Room value couldn't be auto-split into Room Number + Ward; shown as a fallback until manually resolved. */
  roomLegacyRaw?: string
  lastName: string
  firstName: string
  middleName?: string
  age: number
  sex: 'M' | 'F' | 'O'
  /** User-typed override only — unset (blank) by default. While unset, the UI displays (but does not persist) `createdAt`'s date. */
  admitDate: string
  /** User-typed override only — unset (blank) by default. While unset, the UI displays (but does not persist) `createdAt`'s date. Only shown in the UI once a "Referral" tag is applied to the patient. */
  referralDate: string
  /** User-typed override only — unset by default. While unset, the UI displays (but does not persist) the date the patient's current Terminal-flagged tag was applied, computed from Tag Event history. Only shown in the UI while a terminal tag is currently attached. */
  dischargeDate?: string
  /** References to TagDefinition rows in the "Service" tag group. Kept separate from the general `tagIds` because the same service tag pool is split into Main vs Referral roles per patient. */
  mainServiceTagIds: number[]
  referralServiceTagIds: number[]
  attendingPhysician: string
  diagnosis: string
  clinicalSummary: string
  /** Unstructured scratch pad — merges the legacy Chief Complaint / HPI / PMH / PE / Clerk notes fields into a single free-text area (Database tab). */
  database: string
  plans: string
  medications: string
  labs: string
  pendings: string
  tagIds: number[]
}

export type TagDisplayType = 'emoji' | 'color'

export type TagAutomationRole =
  | 'none'
  | 'category-cd'
  | 'category-pd'
  | 'relationship-main'
  | 'relationship-referral'

export interface TagGroupDefinition {
  id?: number
  name: string
  sortOrder: number
}

export interface TagDefinition {
  id?: number
  name: string
  displayType: TagDisplayType
  emoji?: string
  color?: string
  /** Text-with-Color only: what's actually shown on the badge (e.g. "Ref" for a "Referral" tag). Falls back to name when unset. */
  displayText?: string
  groupId?: number
  sortOrder: number
  visibleOnPatientCard: boolean
  terminal: boolean
  automationRole: TagAutomationRole
  createdAt: string
}

export interface TagEvent {
  id?: number
  patientId: number
  tagId: number
  tagName: string
  action: 'added' | 'removed'
  at: string
}

export type CustomActionTriggerType = 'manual' | 'automatic'

/** One Task List Variant per Category x Relationship Automation Role combination (point 1). */
export type CustomActionVariantKey = 'cd-main' | 'cd-referral' | 'pd-main' | 'pd-referral'

export type CustomActionVariants = Record<CustomActionVariantKey, string[]>

export interface CustomActionTagEffect {
  tagId: number
  action: 'add' | 'remove'
}

export interface CustomAction {
  id?: number
  name: string
  triggerType: CustomActionTriggerType
  /** Required (and only meaningful) when triggerType === 'automatic': the tag whose absent→present transition fires this action. */
  triggerTagId?: number
  variants: CustomActionVariants
  tagEffects: CustomActionTagEffect[]
  sortOrder: number
  createdAt: string
}

/** One row per (actionId, patientId, date) a Manual action was actually run — powers the once-per-day duplicate-prevention rule. */
export interface CustomActionRun {
  id?: number
  actionId: number
  patientId: number
  date: string
  at: string
}

export interface ProblemBlock {
  id: string
  title: string
  notes: string
  /** Adopts the Checklist tab's per-date carry-forward model: unresolved problems roll forward to the next date automatically; resolved ones stay put. */
  completed: boolean
}

export interface DailyUpdate {
  id?: number
  patientId: number
  date: string
  problems: ProblemBlock[]
  assessment: string
  plans: string
  checklist: { text: string; completed: boolean }[]
  lastUpdated: string
}

export interface VitalEntry {
  id?: number
  patientId: number
  date: string
  time: string
  bp: string
  hr: string
  rr: string
  temp: string
  spo2: string
  note: string
  createdAt: string
}

export interface MedicationEntry {
  id?: number
  patientId: number
  sortOrder?: number
  medication: string
  dose: string
  route: string
  frequency: string
  note: string
  status: 'active' | 'discontinued' | 'completed'
  createdAt: string
}

export interface LabEntry {
  id?: number
  patientId: number
  date: string
  time?: string
  templateId: string
  results: Record<string, string>
  note: string
  createdAt: string
}

export interface OrderEntry {
  id?: number
  patientId: number
  orderDate: string
  orderTime: string
  service: string
  orderText: string
  status: 'active' | 'carriedOut' | 'discontinued'
  note: string
  createdAt: string
}

export type PhotoCategory =
  | 'profile'
  | 'problems'
  | 'vitals'
  | 'medications'
  | 'labs'
  | 'orders'

export interface PhotoAttachment {
  id?: number
  patientId: number
  category: PhotoCategory
  title: string
  uploadGroupId?: string
  selectionOrderInGroup?: number
  mimeType: string
  width: number
  height: number
  byteSize: number
  imageBlob: Blob
  createdAt: string
}
