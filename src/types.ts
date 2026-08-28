export interface Patient {
  id?: number
  lastModified: string
  roomNumber: string
  ward: string
  /** Set only when the legacy combined Room value couldn't be auto-split into Room Number + Ward; shown as a fallback until manually resolved. */
  roomLegacyRaw?: string
  lastName: string
  firstName: string
  middleName?: string
  age: number
  sex: 'M' | 'F' | 'O'
  admitDate: string
  /** One-time copy of admitDate at creation; independently editable afterward. */
  referralDate: string
  /** References to TagDefinition rows in the "Service" tag group. Kept separate from the general `tagIds` because the same service tag pool is split into Main vs Referral roles per patient. */
  mainServiceTagIds: number[]
  referralServiceTagIds: number[]
  attendingPhysician: string
  diagnosis: string
  chiefComplaint: string
  hpiText: string
  pmhText: string
  peText: string
  clinicalSummary: string
  plans: string
  medications: string
  labs: string
  pendings: string
  clerkNotes: string
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

export interface ProblemBlock {
  id: string
  title: string
  notes: string
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
