export interface Patient {
  id?: number
  lastModified: string
  roomNumber: string
  lastName: string
  firstName: string
  middleName?: string
  age: number
  sex: 'M' | 'F' | 'O'
  admitDate: string
  service: string
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
  status: 'active' | 'discharged'
  dischargeDate?: string
}

export interface DailyUpdate {
  id?: number
  patientId: number
  date: string
  fluid: string
  respiratory: string
  infectious: string
  cardio: string
  hema: string
  metabolic: string
  output: string
  neuro: string
  drugs: string
  other: string
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
  | 'frichmond'
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
