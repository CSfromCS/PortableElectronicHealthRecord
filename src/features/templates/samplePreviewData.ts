import { buildPatientPoolContext } from '@/features/filters/patientFilterUtils'
import { SERVICE_TAG_GROUP_NAME } from '@/features/tags/tagConstants'
import { buildCurrentDateTimeText, createVariableId, type TemplateRenderContext } from './templateEngine'
import type { DailyUpdate, DateTimeFormatDefinition, LabEntry, MedicationEntry, OrderEntry, Patient, TagDefinition, TagGroupDefinition, VitalEntry } from '@/types'

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
  {
    id: -1,
    patientId: -999,
    date: '2026-01-02',
    time: '06:30',
    templateId: 'ust-cbc',
    results: {
      RBC: '4.58', Hgb: '136', Hct: '0.41', MCV: '89.5', MCH: '29.7', MCHC: '33.2', RDW: '13.4',
      Plt: '302', MPV: '9.8', WBC: '11.2', N: '0', Metamyelocytes: '0', Bands: '2', S: '78',
      L: '14', M: '5', E: '1', B: '0', Blasts: '0', Myelocytes: '0', MDW: '21.5',
    },
    note: 'Sample note for preview',
    createdAt: '2026-01-02T06:30:00.000Z',
  },
]

// Previously an empty Map, so the Medications Block variable chip had nothing to render in the
// preview at all — unlike Vitals/Labs/Orders/Problems/Checklist, which all had at least one entry.
const SAMPLE_MEDICATIONS: MedicationEntry[] = [
  { id: -1, patientId: -999, sortOrder: 0, medication: 'Amlodipine', dose: '10 mg', route: 'PO', frequency: 'OD', note: 'Home antihypertensive', status: 'active', createdAt: '2026-01-01T09:00:00.000Z' },
  { id: -2, patientId: -999, sortOrder: 1, medication: 'Ceftriaxone', dose: '2 g', route: 'IV', frequency: 'q24h', note: 'Completed course', status: 'discontinued', createdAt: '2026-01-01T09:00:00.000Z' },
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

/**
 * Resolves the preview patient's Main/Referral service, and a couple of general tags, against
 * this install's REAL tag definitions — same principle as `tagsById`/`tagGroups` on
 * `buildSamplePreviewContext` below (tag *definitions* aren't patient data): without this, the
 * Main Service/Referral Service flat variables and any Tags variable chip always rendered blank
 * in the preview, since the static `SAMPLE_PREVIEW_PATIENT` has no way to reference a real tag id
 * that varies per install. Falls back to none applied (still blank) wherever this install hasn't
 * created the relevant tags yet — nothing real exists to preview.
 *
 * General tags are deliberately limited to "Main" (Relationship) and "EHR" (Chart Type) rather
 * than every non-terminal tag this install has — those two are unambiguous, always-seeded
 * defaults; applying everything else (e.g. both Category options, or both OR Status options at
 * once) would produce a combination no real patient would actually carry.
 */
export const buildSamplePreviewPatient = (
  tagsById: Map<number, TagDefinition> = new Map(),
  tagGroups: TagGroupDefinition[] = [],
): Patient => {
  const serviceGroupId = tagGroups.find((group) => group.name === SERVICE_TAG_GROUP_NAME)?.id
  const serviceTagIds = serviceGroupId === undefined
    ? []
    : Array.from(tagsById.values())
      .filter((tag) => tag.groupId === serviceGroupId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tag) => tag.id)
      .filter((id): id is number => id !== undefined)

  const generalTagIds = ['Main', 'EHR']
    .map((name) => Array.from(tagsById.values()).find((tag) => tag.name === name)?.id)
    .filter((id): id is number => id !== undefined)

  return {
    ...SAMPLE_PREVIEW_PATIENT,
    mainServiceTagIds: serviceTagIds.slice(0, 1),
    referralServiceTagIds: serviceTagIds.slice(1, 2),
    tagIds: generalTagIds,
  }
}

/**
 * `tagsById`/`tagGroups` default to empty (decoupled from real data, like everything else here),
 * but the Manage Templates editor passes the app's REAL tag/group definitions through so a Census
 * Summary variable's chosen Tag Group can actually be found and labeled in the preview, and so
 * buildSamplePreviewPatient above has real tag/service ids to apply to the preview patient — tag
 * *definitions* aren't patient data, so this doesn't compromise the "never surface a real
 * patient's data" guarantee above.
 */
export const buildSamplePreviewContext = (
  dateTimeFormatsById: Map<string, DateTimeFormatDefinition> = new Map(),
  tagsById: Map<number, TagDefinition> = new Map(),
  tagGroups: TagGroupDefinition[] = [],
  previewPatient: Patient = buildSamplePreviewPatient(tagsById, tagGroups),
): TemplateRenderContext => ({
  tagsById,
  tagGroups,
  vitalsByPatient: new Map([[-999, SAMPLE_VITALS]]),
  labsByPatient: new Map([[-999, SAMPLE_LABS]]),
  ordersByPatient: new Map([[-999, SAMPLE_ORDERS]]),
  medicationsByPatient: new Map([[-999, SAMPLE_MEDICATIONS]]),
  dailyUpdatesByPatient: new Map([[-999, SAMPLE_DAILY_UPDATES]]),
  dateTimeFormatsById,
  allPatients: [previewPatient],
  poolContext: buildPatientPoolContext(tagsById, []),
  ...buildCurrentDateTimeText(),
})
