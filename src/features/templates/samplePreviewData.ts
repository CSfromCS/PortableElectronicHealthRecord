import { buildCurrentDateTimeText, createVariableId, type TemplateRenderContext } from './templateEngine'
import type { DailyUpdate, DateTimeFormatDefinition, LabEntry, OrderEntry, Patient, VitalEntry } from '@/types'

/** Synthetic patient used only for the template editor's live preview — deliberately decoupled
 * from whatever real patient (if any) is open, so previewing a template never risks surfacing a
 * real patient's data and always shows something regardless of which screen Manage Templates was
 * reached from. */
export const SAMPLE_PREVIEW_PATIENT: Patient = {
  id: -999,
  lastModified: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T08:00:00.000Z',
  roomNumber: '512A',
  ward: 'Medicine Ward',
  lastName: 'CRUZ',
  firstName: 'Maria',
  middleName: 'Santos',
  age: 45,
  sex: 'F',
  admitDate: '2026-01-01',
  admitTime: '08:00',
  referralDate: '2026-01-01',
  referralTime: '09:15',
  dischargeDate: undefined,
  dischargeTime: undefined,
  mainServiceTagIds: [],
  referralServiceTagIds: [],
  attendingPhysician: 'Dr. Sample Attending',
  admissionDiagnosisUnassigned: 'Community-acquired pneumonia, improving',
  admissionDiagnosisByService: {},
  dischargeDiagnosisUnassigned: '',
  dischargeDiagnosisByService: {},
  clinicalSummary: 'Sample clinical summary for template preview — improving on current management.',
  database: 'Sample chief complaint, history, and exam findings for preview purposes.',
  plans: 'Sample plan text.',
  medications: 'Sample free-text medication note.',
  labs: '',
  pendings: '',
  tagIds: [],
}

const SAMPLE_VITALS: VitalEntry[] = [
  { id: -1, patientId: -999, date: '2026-01-02', time: '06:00', bp: '118/76', hr: '84', rr: '18', temp: '37.1', spo2: '97', note: '', createdAt: '2026-01-02T06:00:00.000Z' },
  { id: -2, patientId: -999, date: '2026-01-01', time: '18:00', bp: '124/80', hr: '90', rr: '20', temp: '37.8', spo2: '95', note: 'Sample note', createdAt: '2026-01-01T18:00:00.000Z' },
]

const SAMPLE_ORDERS: OrderEntry[] = [
  { id: -1, patientId: -999, orderDate: '2026-01-02', orderTime: '07:00', service: 'IM', orderText: 'CBC and electrolytes tomorrow AM', status: 'active', note: '', createdAt: '2026-01-02T07:00:00.000Z' },
]

const SAMPLE_LABS: LabEntry[] = [
  { id: -1, patientId: -999, date: '2026-01-02', time: '06:30', templateId: 'ust-cbc', results: {}, note: '', createdAt: '2026-01-02T06:30:00.000Z' },
]

const SAMPLE_DAILY_UPDATES: DailyUpdate[] = [
  {
    id: -1,
    patientId: -999,
    date: '2026-01-02',
    problems: [{ id: createVariableId(), title: 'Sample problem', notes: 'Sample notes for preview', completed: false }],
    assessment: '',
    plans: '',
    checklist: [{ text: 'Sample checklist item', completed: false }],
    lastUpdated: '2026-01-02T07:00:00.000Z',
  },
]

export const buildSamplePreviewContext = (dateTimeFormatsById: Map<string, DateTimeFormatDefinition> = new Map()): TemplateRenderContext => ({
  tagsById: new Map(),
  tagGroups: [],
  vitalsByPatient: new Map([[-999, SAMPLE_VITALS]]),
  labsByPatient: new Map([[-999, SAMPLE_LABS]]),
  ordersByPatient: new Map([[-999, SAMPLE_ORDERS]]),
  medicationsByPatient: new Map(),
  dailyUpdatesByPatient: new Map([[-999, SAMPLE_DAILY_UPDATES]]),
  dateTimeFormatsById,
  ...buildCurrentDateTimeText(),
})
