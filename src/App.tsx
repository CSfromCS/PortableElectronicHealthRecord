import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type SetStateAction,
  type TouchEvent,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type {
  DailyUpdate,
  LabEntry,
  MedicationEntry,
  OrderEntry,
  Patient,
  PhotoAttachment,
  PhotoCategory,
  VitalEntry,
} from './types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MasterChecklistQuickAdd } from '@/features/checklist/MasterChecklistQuickAdd'
import {
  appendChecklistItemsForPatientDate,
  insertBlankChecklistItemAfter,
  insertMissingChecklistItems,
  insertNewChecklistItem,
  mergeChecklistItemIntoPrevious,
  normalizeChecklistItems,
  normalizeChecklistItemsKeepingBlanks,
  selectLatestDailyUpdate,
  splitChecklistItemAtCursor,
  toPendingChecklistItems,
  withTrailingBlankChecklistItem,
} from '@/features/checklist/checklistUtils'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import { FlexibleDateInput } from '@/lib/date/FlexibleDateInput'
import { FlexibleTimeInput } from '@/lib/date/FlexibleTimeInput'
import {
  formatClock,
  formatDateMMDD,
  formatDateShortMonthDay,
  formatCalculatedNumber,
  getEffectiveAdmitDate,
  parseNumericInput,
  toLocalISODate,
  toLocalTime,
} from '@/lib/dateTime'
import {
  buildStructuredLabLines,
  formatOrderEntryWithoutService,
  toCensusEntry,
  toLabsSummary,
  toMedicationsSummary,
  toOrdersSummary,
  toProfileSummary,
  toProblemsSummary,
  toSelectedPatientCensusReport,
  toSelectedPatientsVitalsSummary,
  toVitalsLogSummary,
} from './features/reporting/reportBuilders'
import {
  ABG_ACTUAL_FIO2_KEY,
  ABG_DESIRED_FIO2_KEY,
  ABG_PF_RATIO_KEY,
  ABG_PO2_KEY,
  DEFAULT_ABG_DESIRED_PAO2,
  DEFAULT_LAB_TEMPLATE_ID,
  LAB_TEMPLATES,
  OTHERS_LABEL_KEY,
  OTHERS_LAB_TEMPLATE_ID,
  OTHERS_RESULT_KEY,
  UST_ABG_TEMPLATE_ID,
  UST_BLOOD_CHEM_TEMPLATE_ID,
  getNormalRangeFieldKey,
  getUlnFieldKey,
} from './features/labs/labTemplates'
import {
  MentionText,
  PhotoMentionField,
  type MentionablePhoto,
  type PhotoAttachmentGroup,
  type ReviewablePhotoAttachment,
} from './features/photos/photoMentions'
import { ProblemListEditor } from './features/problems/ProblemListEditor'
import { normalizeDailyUpdate, normalizeProblemBlocks, toPendingProblemBlocks } from './features/problems/problemUtils'
import { TabSettingsScreen } from './features/tabs/TabSettingsScreen'
import {
  PATIENT_TAB_DESCRIPTIONS,
  PATIENT_TAB_LABELS,
  loadPatientTabSettings,
  savePatientTabSettings,
  type PatientTabId,
  type PatientTabSetting,
} from './features/tabs/tabConfig'
import {
  PHOTO_CATEGORY_OPTIONS,
  buildDefaultPhotoTitle,
  buildPhotoUploadGroupId,
  compressImageFile,
  formatBytes,
  formatPhotoCategory,
  getPhotoGroupKey,
  resolveDefaultPhotoBatchTitle,
  type DefaultTitledPhotoBatch,
} from './features/photos/photoUtils'
import { SyncButton, type SyncStatus } from './features/sync/SyncButton'
import { SyncSetupDialog, type SetupDeviceName, type SetupUsername } from './features/sync/SyncSetupDialog'
import { VersionPickerDialog } from './features/sync/VersionPickerDialog'
import {
  buildSyncConfig,
  getDefaultSyncEndpoint,
  getLocalSyncVersionMeta,
  getSyncInsight,
  readSyncConfig,
  resolveConflictKeepLocal,
  resolveConflictWithVersion,
  saveSyncConfig,
  syncNow,
  type ConflictResult,
  type LocalSyncVersionMeta,
  type SyncConfig,
  type SyncInsight,
  type SyncNowResult,
  type SyncVersion,
} from './features/sync/syncService'
import { Users, UserRound, Settings, HeartPulse, Pill, FlaskConical, ClipboardList, Camera, ChevronLeft, ChevronRight, ChevronDown, CheckCircle2, Info, Download, Upload, Trash2, Expand, Minimize2, GripVertical, Pencil, Tags as TagsIcon, LayoutGrid, Layers, Zap } from 'lucide-react'
import type { CustomAction, CustomActionCondition, TagDefinition, TagEvent, TagGroupDefinition } from './types'
import { ManageTagsScreen } from './features/tags/ManageTagsScreen'
import { ManageCustomActionsScreen } from './features/customActions/ManageCustomActionsScreen'
import {
  actionHasApplicableEffect,
  actionHasApplicableGeneralEffect,
  addTagsToPatientDirectly,
  applyCustomActionEffects,
  applyGeneralCustomActionEffects,
  formatPatientLabelForNotice,
  getMissingTagsForCondition,
  resolveMatchingConditions,
  resolveMatchingGeneralConditions,
} from './features/customActions/customActionUtils'
import { TagPicker } from './features/tags/TagPicker'
import { BulkTagPicker } from './features/tags/BulkTagPicker'
import { TagChip, TagChipRow } from './features/tags/TagChip'
import { AmbiguityBadge } from './features/tags/AmbiguityBadge'
import {
  applyTagToPatient,
  applyTagsToPatients,
  clearTerminalTagsFromPatient,
  findTagAmbiguities,
  getAppliedPatientTags,
  getVisiblePatientTags,
  isPatientActive,
  orderTagsCanonically,
  removeTagsFromPatients,
  renderTagDisplayText,
  toggleTagOnPatient,
} from './features/tags/tagUtils'
import { SERVICE_TAG_GROUP_NAME } from './features/tags/tagConstants'
import { FilterButton } from './features/filters/FilterButton'
import { PatientFilterDialog } from './features/filters/PatientFilterDialog'
import {
  DEFAULT_PATIENT_POOL_CRITERIA,
  EMPTY_DATE_TIME_WINDOW,
  EMPTY_TAG_WARD_FILTER,
  buildPatientPoolContext,
  collectDistinctWards,
  computeDefaultWindowLookback,
  countTagWardSelections,
  matchesPatientPool,
  matchesTagWardFilter,
  resolveWindowDefaults,
} from './features/filters/patientFilterUtils'
import type { DateTimeWindow, PatientPoolCriterion, TagWardFilterState } from './features/filters/patientFilterUtils'
import { loadTagFilterMode, saveTagFilterMode } from './features/filters/filterSettings'
import {
  addMainServiceTagToPatient,
  addReferralServiceTagToPatient,
  ensureServiceGroupId,
  findServiceTagByName,
  getOrCreateServiceTag,
  removeMainServiceTagFromPatient,
  removeReferralServiceTagFromPatient,
  resolveServiceTagNames,
  resolveServiceTags,
} from './features/tags/serviceTagUtils'
import { ServiceTagMultiSelect } from './features/tags/ServiceTagMultiSelect'
import { ServiceTagSelect } from './features/tags/ServiceTagSelect'

type PatientFormState = {
  roomNumber: string
  ward: string
  firstName: string
  lastName: string
  age: string
  sex: 'M' | 'F' | 'O'
}

const initialForm: PatientFormState = {
  roomNumber: '',
  ward: '',
  firstName: '',
  lastName: '',
  age: '',
  sex: 'M',
}

type ProfileFormState = {
  roomNumber: string
  ward: string
  roomLegacyRaw?: string
  firstName: string
  lastName: string
  age: string
  sex: 'M' | 'F' | 'O'
  admitDate: string
  referralDate: string
  dischargeDate: string
  diagnosis: string
  clinicalSummary: string
  database: string
  plans: string
  medications: string
  labs: string
  pendings: string
}

const initialProfileForm: ProfileFormState = {
  roomNumber: '',
  ward: '',
  roomLegacyRaw: undefined,
  firstName: '',
  lastName: '',
  age: '',
  sex: 'M',
  admitDate: '',
  referralDate: '',
  dischargeDate: '',
  diagnosis: '',
  clinicalSummary: '',
  database: '',
  plans: '',
  medications: '',
  labs: '',
  pendings: '',
}

type DailyUpdateFormState = Omit<DailyUpdate, 'id' | 'patientId' | 'date' | 'lastUpdated'>
type DailyChecklistItem = DailyUpdateFormState['checklist'][number]
type MasterChecklistItem = {
  patientId: number
  patientIdentifier: string
  viewDate: string
  index: number
  text: string
  completed: boolean
  notes: string
  createdDate: string | null
  completedDate: string | null
  lastFoundDate: string | null
}

// A checklist not tied to any patient (issue #79) — stored as an ordinary DailyUpdate row like
// any patient's, just addressed by this reserved patientId instead of a real one. Real patient
// ids are Dexie auto-increment ('++id'), which only ever assigns positive integers, so a
// negative sentinel can never collide with one.
const GENERAL_CHECKLIST_PATIENT_ID = -1
const GENERAL_CHECKLIST_LABEL = 'General (no patient)'

/**
 * Builds the MasterChecklistItem rows for one checklist source — a real patient's DailyUpdate
 * history, or the General checklist's — sharing the same "show today's entry if it exists,
 * otherwise carry forward incomplete items from the latest prior date" logic either way.
 */
const buildMasterChecklistItemsForSource = (
  patientId: number,
  patientIdentifier: string,
  updates: DailyUpdate[],
  viewDate: string,
): MasterChecklistItem[] => {
  const priorOrCurrent = updates.filter((entry) => entry.date <= viewDate)
  if (priorOrCurrent.length === 0) return []

  const dateMatchedUpdate = priorOrCurrent.find((entry) => entry.date === viewDate)
  const sourceUpdate = dateMatchedUpdate ?? selectLatestDailyUpdate(priorOrCurrent)
  if (!sourceUpdate) return []

  // dateMatchedUpdate means this is the entry actively being viewed/edited "live" — keep blank
  // items so a split's blank "after" item can actually render (see updateMasterChecklist). A
  // checklist merely carried forward from a prior date is never live-edited directly, so it
  // still drops blanks as stale abandoned edits.
  const scopedChecklist = dateMatchedUpdate
    ? normalizeChecklistItemsKeepingBlanks(sourceUpdate.checklist)
    : toPendingChecklistItems(sourceUpdate.checklist)
  if (scopedChecklist.length === 0) return []

  const normalizedHistory = priorOrCurrent.map((entry) => ({
    date: entry.date,
    checklist: normalizeChecklistItems(entry.checklist),
  }))

  return scopedChecklist.map((item, index) => {
    let createdDate: string | null = null
    let completedDate: string | null = null
    let lastFoundDate: string | null = null

    normalizedHistory.forEach((historyEntry) => {
      const matchedHistoryItem = historyEntry.checklist.find((historyItem) => historyItem.text === item.text)
      if (!matchedHistoryItem) return
      lastFoundDate = historyEntry.date
      if (createdDate === null) {
        createdDate = historyEntry.date
      }
      if (completedDate === null && matchedHistoryItem.completed) {
        completedDate = historyEntry.date
      }
    })

    return {
      patientId,
      patientIdentifier,
      viewDate,
      index,
      text: item.text,
      completed: item.completed,
      notes: item.notes ?? '',
      createdDate,
      completedDate,
      lastFoundDate,
    }
  })
}

type VitalFormState = {
  date: string
  time: string
  bp: string
  hr: string
  rr: string
  temp: string
  spo2: string
  note: string
}

type MedicationFormState = {
  medication: string
  dose: string
  route: string
  frequency: string
  note: string
  status: 'active' | 'discontinued' | 'completed'
}

type OrderFormState = {
  orderDate: string
  orderTime: string
  service: string
  orderText: string
  note: string
  status: 'active' | 'carriedOut' | 'discontinued'
}



type BackupPayload = {
  patients: Patient[]
  dailyUpdates: DailyUpdate[]
  vitals?: VitalEntry[]
  medications?: MedicationEntry[]
  labs?: LabEntry[]
  orders?: OrderEntry[]
  tagGroups?: TagGroupDefinition[]
  tagDefinitions?: TagDefinition[]
  tagEvents?: TagEvent[]
}

type ReportingAction = {
  id: string
  label: string
  outputTitle: string
  buildText: () => string
}

type ReportingSection = {
  id: string
  title: string
  description: string
  actions: ReportingAction[]
}

const initialDailyUpdateForm: DailyUpdateFormState = {
  problems: [],
  assessment: '',
  plans: '',
  checklist: [],
}

// Once a field has a value, its label recedes so the value itself carries the visual weight.
const fieldLabelClassName = (hasValue: boolean) => (hasValue ? 'text-xs font-normal text-clay/70 transition-colors' : undefined)

const reorderChecklistItems = (items: DailyChecklistItem[], sourceIndex: number, targetIndex: number) => {
  if (sourceIndex === targetIndex || !items[sourceIndex] || !items[targetIndex]) return items
  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)
  nextItems.splice(targetIndex, 0, movedItem)
  return nextItems
}

const setChecklistItemCompletion = (items: DailyChecklistItem[], index: number, completed: boolean) => {
  const currentItem = items[index]
  if (!currentItem || currentItem.completed === completed) return items

  const nextItems = [...items]
  nextItems.splice(index, 1)
  const updatedItem = { ...currentItem, completed }
  if (completed) {
    nextItems.push(updatedItem)
    return nextItems
  }

  const firstCompletedIndex = nextItems.findIndex((item) => item.completed)
  nextItems.splice(firstCompletedIndex < 0 ? nextItems.length : firstCompletedIndex, 0, updatedItem)
  return nextItems
}

const getNormalAaDo2 = (age: number): number => {
  const decadesAboveThirty = age > 30 ? Math.floor((age - 30) / 10) : 0
  return 15 + decadesAboveThirty * 3
}

const getNormalPfRatio = (age: number): number => {
  if (age <= 60) return 400
  return 400 - (age - 60) * 5
}

const initialVitalForm = (): VitalFormState => ({
  date: '',
  time: '',
  bp: '',
  hr: '',
  rr: '',
  temp: '',
  spo2: '',
  note: '',
})

const initialMedicationForm = (): MedicationFormState => ({
  medication: '',
  dose: '',
  route: '',
  frequency: '',
  note: '',
  status: 'active',
})

const initialOrderForm = (): OrderFormState => ({
  orderDate: '',
  orderTime: '',
  service: '',
  orderText: '',
  note: '',
  status: 'active',
})

declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

type MobileInstallPlatform = 'ios' | 'android' | 'other'
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

const isBackupPayload = (value: unknown): value is BackupPayload => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.patients) || !Array.isArray(candidate.dailyUpdates)) {
    return false
  }

  const validVitals = candidate.vitals === undefined || Array.isArray(candidate.vitals)
  const validMedications = candidate.medications === undefined || Array.isArray(candidate.medications)
  const validLabs = candidate.labs === undefined || Array.isArray(candidate.labs)
  const validOrders = candidate.orders === undefined || Array.isArray(candidate.orders)
  const validTagGroups = candidate.tagGroups === undefined || Array.isArray(candidate.tagGroups)
  const validTagDefinitions = candidate.tagDefinitions === undefined || Array.isArray(candidate.tagDefinitions)
  const validTagEvents = candidate.tagEvents === undefined || Array.isArray(candidate.tagEvents)
  return validVitals && validMedications && validLabs && validOrders && validTagGroups && validTagDefinitions && validTagEvents
}

const isConflictSyncResult = (result: SyncNowResult): result is ConflictResult => {
  return 'kind' in result && (result.kind === 'conflict' || result.kind === 'first-sync')
}

const comparePhotosByNewest = (a: PhotoAttachment, b: PhotoAttachment) => {
  if (
    a.uploadGroupId &&
    b.uploadGroupId &&
    a.uploadGroupId === b.uploadGroupId &&
    a.selectionOrderInGroup !== undefined &&
    b.selectionOrderInGroup !== undefined &&
    a.selectionOrderInGroup !== b.selectionOrderInGroup
  ) {
    return a.selectionOrderInGroup - b.selectionOrderInGroup
  }

  if (a.createdAt !== b.createdAt) {
    return b.createdAt.localeCompare(a.createdAt)
  }

  const byTitle = a.title.localeCompare(b.title)
  if (byTitle !== 0) {
    return byTitle
  }

  const aId = a.id ?? Number.MIN_SAFE_INTEGER
  const bId = b.id ?? Number.MIN_SAFE_INTEGER
  if (aId !== bId) {
    return bId - aId
  }

  return 0
}

const comparePhotoGroupsByNewest = (a: PhotoAttachmentGroup, b: PhotoAttachmentGroup) => {
  if (a.createdAt !== b.createdAt) {
    return b.createdAt.localeCompare(a.createdAt)
  }

  return b.groupId.localeCompare(a.groupId)
}

// Fields feeding the dirty flags below already debounce their own typing pause
// (TapToEditField); this just coalesces same-tick multi-field commits before the
// IndexedDB write, so it stays short rather than adding a second perceptible delay.
const AUTOSAVE_FLUSH_MS = 150

// Device-local UI preference (not clinical data), same rationale as patientTabSettings.
const ADD_PATIENT_COLLAPSED_STORAGE_KEY = 'puhrr.addPatientCollapsed'

const loadAddPatientCollapsed = (): boolean => {
  try {
    const stored = window.localStorage.getItem(ADD_PATIENT_COLLAPSED_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

type PhotoViewMode = 'collapsed' | 'expanded'

const PATIENT_PHOTO_VIEW_MODE_STORAGE_KEY = 'puhrr.patientPhotoViewMode'
const REVIEW_PHOTO_VIEW_MODE_STORAGE_KEY = 'puhrr.reviewPhotoViewMode'

const loadPhotoViewMode = (storageKey: string): PhotoViewMode => {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored === 'expanded' ? 'expanded' : 'collapsed'
  } catch {
    return 'collapsed'
  }
}

const savePhotoViewMode = (storageKey: string, mode: PhotoViewMode) => {
  try {
    window.localStorage.setItem(storageKey, mode)
  } catch {
    // Storage can fail (private browsing, quota) — view mode just won't persist this session.
  }
}

const ensurePatientLastModified = (patient: Patient): Patient => {
  return {
    ...patient,
    lastModified: patient.lastModified ?? patient.admitDate ?? new Date().toISOString(),
    createdAt: patient.createdAt ?? patient.admitDate ?? patient.lastModified ?? new Date().toISOString(),
    tagIds: patient.tagIds ?? [],
    ward: patient.ward ?? '',
    referralDate: patient.referralDate ?? '',
    mainServiceTagIds: patient.mainServiceTagIds ?? [],
    referralServiceTagIds: patient.referralServiceTagIds ?? [],
  }
}

function App() {
  const backupFileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const galleryPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const outputPreviewTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const carouselThumbnailButtonRefs = useRef<Record<number, HTMLButtonElement>>({})
  const patientLongPressTimerRef = useRef<number | null>(null)
  const patientLongPressFiredRef = useRef(false)
  const [form, setForm] = useState<PatientFormState>(initialForm)
  const [pendingMainServiceTagIds, setPendingMainServiceTagIds] = useState<number[]>([])
  const [view, setView] = useState<'patients' | 'patient' | 'checklist' | 'settings' | 'manageTags' | 'tabSettings' | 'manageCustomActions'>('patients')
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [tagsEditOverrideByPatientId, setTagsEditOverrideByPatientId] = useState<Map<number, boolean>>(new Map())
  // Snapshot, per patient, of whether tags were already applied the first time this patient's
  // tags were viewed this session — seeded once and never revisited, so later tag adds/removes
  // can't retroactively change the collapse default for a segment the user is already looking
  // at. Resets naturally on a fresh app open (new component instance).
  const tagsCollapseDefaultSeedRef = useRef<Map<number, boolean>>(new Map())
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddPatientCollapsed, setIsAddPatientCollapsed] = useState(() => loadAddPatientCollapsed())
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [sortBy, setSortBy] = useState<'room' | 'name' | 'admitDate'>('room')

  // Issue #81: independent Tag+Ward filters for the Patients list, Master Checklist, and the
  // census/vitals patient picker (this app's closest analog to a "Reporting" multi-patient view —
  // there is no separate templated Reporting screen yet). Each view's Tag AND/OR toggle is sticky
  // per view (localStorage); tag/ward selections themselves are not.
  const [patientListFilter, setPatientListFilterRaw] = useState<TagWardFilterState>(() => ({
    ...EMPTY_TAG_WARD_FILTER,
    tagMode: loadTagFilterMode('patients'),
  }))
  const setPatientListFilter = (next: TagWardFilterState) => {
    if (next.tagMode !== patientListFilter.tagMode) saveTagFilterMode('patients', next.tagMode)
    setPatientListFilterRaw(next)
  }
  const [patientListFilterDialogOpen, setPatientListFilterDialogOpen] = useState(false)

  const [checklistFilter, setChecklistFilterRaw] = useState<TagWardFilterState>(() => ({
    ...EMPTY_TAG_WARD_FILTER,
    tagMode: loadTagFilterMode('checklist'),
  }))
  const setChecklistFilter = (next: TagWardFilterState) => {
    if (next.tagMode !== checklistFilter.tagMode) saveTagFilterMode('checklist', next.tagMode)
    setChecklistFilterRaw(next)
  }
  const [checklistFilterDialogOpen, setChecklistFilterDialogOpen] = useState(false)

  const [censusFilter, setCensusFilterRaw] = useState<TagWardFilterState>(() => ({
    ...EMPTY_TAG_WARD_FILTER,
    tagMode: loadTagFilterMode('census'),
  }))
  const setCensusFilter = (next: TagWardFilterState) => {
    if (next.tagMode !== censusFilter.tagMode) saveTagFilterMode('census', next.tagMode)
    setCensusFilterRaw(next)
  }
  const [censusFilterDialogOpen, setCensusFilterDialogOpen] = useState(false)

  // Patient Pool facet (census/reporting only) — "Active Only" is a hard default every time,
  // not sticky, per point 3 of issue #81. The shared window's fields start blank, like every
  // other optional date/time field in this app (Vitals entry, etc.) — left blank, each resolves
  // to its own computed default (last 12 hours, ending now); "Limit to a time window" starts on
  // so that default actually applies.
  const [censusPoolCriteria, setCensusPoolCriteria] = useState<PatientPoolCriterion[]>(DEFAULT_PATIENT_POOL_CRITERIA)
  const [censusPoolUseWindow, setCensusPoolUseWindow] = useState(true)
  const [censusPoolWindow, setCensusPoolWindow] = useState<DateTimeWindow>(EMPTY_DATE_TIME_WINDOW)
  const [profileForm, setProfileForm] = useState<ProfileFormState>(initialProfileForm)
  const [dailyDate, setDailyDate] = useState(() => toLocalISODate())
  const [masterChecklistDate, setMasterChecklistDate] = useState(() => toLocalISODate())
  const [dailyUpdateForm, setDailyUpdateForm] = useState<DailyUpdateFormState>(initialDailyUpdateForm)
  const [dailyUpdateId, setDailyUpdateId] = useState<number | undefined>(undefined)
  const [draggingDailyChecklistItemIndex, setDraggingDailyChecklistItemIndex] = useState<number | null>(null)
  const [touchDailyChecklistTargetIndex, setTouchDailyChecklistTargetIndex] = useState<number | null>(null)
  const [draggingMasterChecklistItem, setDraggingMasterChecklistItem] = useState<{ patientId: number; index: number } | null>(null)
  const [touchMasterChecklistTarget, setTouchMasterChecklistTarget] = useState<{ patientId: number; index: number } | null>(null)
  // Continuous-checklist editing (issue #78): which row currently has focus somewhere inside it
  // (reveals its notes line even while empty), and a one-shot request to move the cursor into a
  // specific row/offset right after a split or merge reshapes the list.
  const [activeDailyChecklistIndex, setActiveDailyChecklistIndex] = useState<number | null>(null)
  const [pendingDailyChecklistFocus, setPendingDailyChecklistFocus] = useState<{ index: number; caretOffset: number } | null>(null)
  const [activeMasterChecklistRow, setActiveMasterChecklistRow] = useState<{ patientId: number; index: number } | null>(null)
  // expectedText guards against the Master Checklist's async write/live-query race: the focus
  // request is set the instant the edit is queued, but the row it targets won't show the new
  // content until the IndexedDB write lands and the live query re-derives masterChecklistItems
  // (not necessarily by the very next render) — so autoEnter only fires once the row's *actual*
  // text matches what this edit was expected to produce there, not merely once some row exists
  // at that index (which, until then, is still whatever was there before the edit).
  const [pendingMasterChecklistFocus, setPendingMasterChecklistFocus] = useState<{ patientId: number; index: number; caretOffset: number; expectedText: string } | null>(null)
  const [vitalForm, setVitalForm] = useState<VitalFormState>(() => initialVitalForm())
  const [editingVitalId, setEditingVitalId] = useState<number | null>(null)
  const [vitalDraftId, setVitalDraftId] = useState<number | null>(null)
  const [vitalDirty, setVitalDirty] = useState(false)
  const [medicationForm, setMedicationForm] = useState<MedicationFormState>(() => initialMedicationForm())
  const [editingMedicationId, setEditingMedicationId] = useState<number | null>(null)
  const [draggingMedicationIndex, setDraggingMedicationIndex] = useState<number | null>(null)
  const [touchMedicationTargetIndex, setTouchMedicationTargetIndex] = useState<number | null>(null)
  const [orderForm, setOrderForm] = useState<OrderFormState>(() => initialOrderForm())
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null)
  const [orderDraftId, setOrderDraftId] = useState<number | null>(null)
  const [orderDirty, setOrderDirty] = useState(false)
  const [selectedLabTemplateId, setSelectedLabTemplateId] = useState(DEFAULT_LAB_TEMPLATE_ID)
  const [labTemplateDate, setLabTemplateDate] = useState('')
  const [labTemplateTime, setLabTemplateTime] = useState('')
  const [labTemplateValues, setLabTemplateValues] = useState<Record<string, string>>({})
  const [labTemplateNote, setLabTemplateNote] = useState('')
  const [editingLabId, setEditingLabId] = useState<number | null>(null)
  const [profileDirty, setProfileDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [dailyDirty, setDailyDirty] = useState(false)
  const [copyLatestConfirmOpen, setCopyLatestConfirmOpen] = useState(false)
  const [pendingLatestDailyUpdate, setPendingLatestDailyUpdate] = useState<DailyUpdate | null>(null)
  const [deleteDailyConfirmOpen, setDeleteDailyConfirmOpen] = useState(false)
  const [pendingDeleteDailyUpdate, setPendingDeleteDailyUpdate] = useState<DailyUpdate | null>(null)
  // Generic confirm-before-delete gate: any destructive action routes through this instead of
  // firing immediately, so a single Dialog (rendered once, see below) covers every delete button.
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void | Promise<void> } | null>(null)
  const requestDeleteConfirmation = useCallback((action: { title: string; message: string; confirmLabel?: string; onConfirm: () => void | Promise<void> }) => {
    setPendingDeleteAction({ confirmLabel: 'Delete', ...action })
  }, [])
  const closeDeleteConfirmation = useCallback(() => setPendingDeleteAction(null), [])
  const confirmPendingDelete = useCallback(async () => {
    if (!pendingDeleteAction) return
    await pendingDeleteAction.onConfirm()
    setPendingDeleteAction(null)
  }, [pendingDeleteAction])
  const [selectedTab, setSelectedTab] = useState<PatientTabId>('profile')
  const [patientTabSettings, setPatientTabSettings] = useState<PatientTabSetting[]>(() => loadPatientTabSettings())
  const updatePatientTabSettings = useCallback((next: PatientTabSetting[]) => {
    setPatientTabSettings(next)
    savePatientTabSettings(next)
  }, [])
  const toggleAddPatientCollapsed = useCallback(() => {
    setIsAddPatientCollapsed((previous) => {
      const next = !previous
      try {
        window.localStorage.setItem(ADD_PATIENT_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Storage can fail (private browsing, quota) — collapsed state just won't persist this session.
      }
      return next
    })
  }, [])
  const visiblePatientTabs = useMemo(
    () => patientTabSettings.filter((tab) => tab.visible).map((tab) => tab.id),
    [patientTabSettings],
  )
  useEffect(() => {
    if (visiblePatientTabs.length > 0 && !visiblePatientTabs.includes(selectedTab)) {
      setSelectedTab(visiblePatientTabs[0])
    }
  }, [selectedTab, visiblePatientTabs])
  useEffect(() => {
    if (view !== 'patients') {
      setPatientTagSelectionMode(false)
      setSelectedPatientIdsForTagging(new Set())
    }
  }, [view])
  const [notice, setNotice] = useState('')
  const [noticeIsDecaying, setNoticeIsDecaying] = useState(false)
  const [clipboardCopied, setClipboardCopied] = useState(false)
  const [outputPreview, setOutputPreview] = useState('')
  const [outputPreviewTitle, setOutputPreviewTitle] = useState('Generated text')
  const [isOutputPreviewExpanded, setIsOutputPreviewExpanded] = useState(false)
  const [showOutputPreviewExpand, setShowOutputPreviewExpand] = useState(false)
  const [attachmentCategory, setAttachmentCategory] = useState<PhotoCategory>('profile')
  const [attachmentFilter, setAttachmentFilter] = useState<PhotoCategory | 'all'>('all')
  const [attachmentTitle, setAttachmentTitle] = useState(() => buildDefaultPhotoTitle('profile'))
  const [isAttachmentTitleDefault, setIsAttachmentTitleDefault] = useState(true)
  const [isPhotoSaving, setIsPhotoSaving] = useState(false)
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<number | null>(null)
  const [attachmentViewerSource, setAttachmentViewerSource] = useState<'patient' | 'review'>('patient')
  const [isCarouselChromeVisible, setIsCarouselChromeVisible] = useState(false)
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<number, string>>({})
  const [allAttachmentPreviewUrls, setAllAttachmentPreviewUrls] = useState<Record<number, string>>({})
  const [showPhotoReviewDialog, setShowPhotoReviewDialog] = useState(false)
  const [patientPhotoViewMode, setPatientPhotoViewMode] = useState<PhotoViewMode>(() => loadPhotoViewMode(PATIENT_PHOTO_VIEW_MODE_STORAGE_KEY))
  const [reviewPhotoViewMode, setReviewPhotoViewMode] = useState<PhotoViewMode>(() => loadPhotoViewMode(REVIEW_PHOTO_VIEW_MODE_STORAGE_KEY))
  const togglePatientPhotoViewMode = useCallback(() => {
    setPatientPhotoViewMode((previous) => {
      const next = previous === 'collapsed' ? 'expanded' : 'collapsed'
      savePhotoViewMode(PATIENT_PHOTO_VIEW_MODE_STORAGE_KEY, next)
      return next
    })
  }, [])
  const toggleReviewPhotoViewMode = useCallback(() => {
    setReviewPhotoViewMode((previous) => {
      const next = previous === 'collapsed' ? 'expanded' : 'collapsed'
      savePhotoViewMode(REVIEW_PHOTO_VIEW_MODE_STORAGE_KEY, next)
      return next
    })
  }, [])
  const [reassignTargetsByAttachmentId, setReassignTargetsByAttachmentId] = useState<Record<number, string>>({})
  const [selectedCensusPatientIds, setSelectedCensusPatientIds] = useState<number[]>([])
  // Bulk tag management on the Patients list — entered via long-press (mobile) or the Select
  // button (desktop); selection clears whenever the user navigates away from the Patients list.
  const [patientTagSelectionMode, setPatientTagSelectionMode] = useState(false)
  const [selectedPatientIdsForTagging, setSelectedPatientIdsForTagging] = useState<Set<number>>(new Set())
  const [bulkTagDialogMode, setBulkTagDialogMode] = useState<'add' | 'remove' | null>(null)
  const [bulkTagPickerSelectedIds, setBulkTagPickerSelectedIds] = useState<Set<number>>(new Set())
  const [bulkTagConfirmOpen, setBulkTagConfirmOpen] = useState(false)
  const [isBulkTagApplying, setIsBulkTagApplying] = useState(false)
  const [bulkCustomActionTarget, setBulkCustomActionTarget] = useState<CustomAction | null>(null)
  const [isBulkCustomActionApplying, setIsBulkCustomActionApplying] = useState(false)
  const [customActionResolveState, setCustomActionResolveState] = useState<{ action: CustomAction; patient: Patient } | null>(null)
  const [reportVitalsDateFrom, setReportVitalsDateFrom] = useState(() => toLocalISODate())
  const [reportVitalsDateTo, setReportVitalsDateTo] = useState(() => toLocalISODate())
  const [reportVitalsTimeFrom, setReportVitalsTimeFrom] = useState('00:00')
  const [reportVitalsTimeTo, setReportVitalsTimeTo] = useState('23:59')
  const [reportOrdersDateFrom, setReportOrdersDateFrom] = useState(() => toLocalISODate())
  const [reportOrdersDateTo, setReportOrdersDateTo] = useState(() => toLocalISODate())
  const [reportOrdersTimeFrom, setReportOrdersTimeFrom] = useState('00:00')
  const [reportOrdersTimeTo, setReportOrdersTimeTo] = useState('23:59')
  const [selectedPatientLabReportIds, setSelectedPatientLabReportIds] = useState<number[]>([])
  const censusSelectionInitializedRef = useRef(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const onboardingAutoInstallAttemptedRef = useRef(false)
  const [deferredInstallPromptEvent, setDeferredInstallPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(() => readSyncConfig())
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (readSyncConfig() ? 'idle' : 'not-configured'))
  const [syncSetupOpen, setSyncSetupOpen] = useState(false)
  const [syncSetupMode, setSyncSetupMode] = useState<'setup' | 'edit'>('setup')
  const [isSyncBusy, setIsSyncBusy] = useState(false)
  const [conflictVersions, setConflictVersions] = useState<SyncVersion[]>([])
  const [selectedConflictVersion, setSelectedConflictVersion] = useState('local')
  const [syncConflictOpen, setSyncConflictOpen] = useState(false)
  const [syncConflictMode, setSyncConflictMode] = useState<'conflict' | 'first-sync'>('conflict')
  const [localConflictVersionMeta, setLocalConflictVersionMeta] = useState<LocalSyncVersionMeta | null>(null)
  const [syncInsight, setSyncInsight] = useState<SyncInsight | null>(null)
  const [isSyncInsightLoading, setIsSyncInsightLoading] = useState(false)
  const touchPatientLastModified = useCallback(async (patientId?: number | null) => {
    if (patientId === undefined || patientId === null) return
    await db.patients.update(patientId, { lastModified: new Date().toISOString() })
  }, [])
  const canUseWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const isStandaloneDisplayMode = useMemo(() => {
    if (typeof window === 'undefined') return false

    const navigatorWithStandalone = window.navigator as NavigatorWithStandalone
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      navigatorWithStandalone.standalone === true
    )
  }, [])
  // Hides the fixed bottom nav while a text field is focused: on-screen keyboards on mobile
  // push/overlay the layout viewport unreliably (worst on iOS Safari), and a bar pinned to
  // the viewport bottom ends up floating mid-screen on top of whatever the user is editing.
  // Sliding it out of the way for the duration of the edit is more robust than trying to
  // track the real keyboard height across browsers.
  const [isTextInputFocused, setIsTextInputFocused] = useState(false)
  useEffect(() => {
    const isTextEntryElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target instanceof HTMLTextAreaElement) return true
      if (target instanceof HTMLInputElement) {
        return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type)
      }
      return target.isContentEditable
    }
    const handleFocusIn = (event: FocusEvent) => setIsTextInputFocused(isTextEntryElement(event.target))
    const handleFocusOut = () => setIsTextInputFocused(false)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])
  const mobileInstallPlatform = useMemo<MobileInstallPlatform>(() => {
    if (typeof navigator === 'undefined') return 'other'

    const userAgent = navigator.userAgent || ''
    const isIOS = /iPad|iPhone|iPod/.test(userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    if (isIOS) return 'ios'
    if (/Android/i.test(userAgent)) return 'android'
    return 'other'
  }, [])
  const patients = useLiveQuery(() => db.patients.toArray(), [])
  const allDailyUpdates = useLiveQuery(() => db.dailyUpdates.toArray(), [])
  const allVitals = useLiveQuery(() => db.vitals.toArray(), [])
  const medications = useLiveQuery(() => db.medications.toArray(), [])
  const labs = useLiveQuery(() => db.labs.toArray(), [])
  const orders = useLiveQuery(() => db.orders.toArray(), [])
  const photoAttachments = useLiveQuery(() => db.photoAttachments.toArray(), [])
  const tagGroups = useLiveQuery(() => db.tagGroups.toArray(), [])
  const tagDefinitions = useLiveQuery(() => db.tagDefinitions.toArray(), [])
  const allTagEvents = useLiveQuery(() => db.tagEvents.toArray(), [])
  const tagsById = useMemo(() => new Map((tagDefinitions ?? []).map((tag) => [tag.id as number, tag])), [tagDefinitions])
  const customActions = useLiveQuery(() => db.customActions.toArray(), [])
  const manualCustomActions = useMemo(
    () => (customActions ?? []).filter((action) => (action.scope ?? 'patient') === 'patient' && action.triggerType === 'manual').sort((a, b) => a.sortOrder - b.sortOrder),
    [customActions],
  )
  // General-scope actions (issue #120) — always manual by construction, shown on the Master
  // Checklist's General section instead of any patient's Checklist tab.
  const generalCustomActions = useMemo(
    () => (customActions ?? []).filter((action) => action.scope === 'general').sort((a, b) => a.sortOrder - b.sortOrder),
    [customActions],
  )
  const dischargedTag = useMemo(() => (tagDefinitions ?? []).find((tag) => tag.name === 'Discharged'), [tagDefinitions])
  const serviceGroupId = useMemo(
    () => (tagGroups ?? []).find((group) => group.name === SERVICE_TAG_GROUP_NAME)?.id,
    [tagGroups],
  )
  const serviceTags = useMemo(
    () => (tagDefinitions ?? []).filter((tag) => tag.groupId !== undefined && tag.groupId === serviceGroupId),
    [tagDefinitions, serviceGroupId],
  )
  const nonServiceTagDefinitions = useMemo(
    () => (tagDefinitions ?? []).filter((tag) => tag.groupId === undefined || tag.groupId !== serviceGroupId),
    [tagDefinitions, serviceGroupId],
  )

  // Add-patient form has no patient record yet, so newly created/selected service tags are staged
  // in local state (`pendingMainServiceTagIds`) until the patient is created.
  const makePendingServiceTagHandlers = (setIds: Dispatch<SetStateAction<number[]>>) => ({
    onAdd: (tag: TagDefinition) => {
      if (tag.id === undefined) return
      const tagId = tag.id
      setIds((previous) => (previous.includes(tagId) ? previous : [...previous, tagId]))
    },
    onRemove: (tag: TagDefinition) => {
      setIds((previous) => previous.filter((id) => id !== tag.id))
    },
    onCreate: (name: string) => {
      void (async () => {
        const groupId = await ensureServiceGroupId(tagGroups ?? [])
        const tag = await getOrCreateServiceTag(name, serviceTags, groupId)
        if (tag.id === undefined) return
        const tagId = tag.id
        setIds((previous) => (previous.includes(tagId) ? previous : [...previous, tagId]))
      })()
    },
  })

  // Profile tab edits an existing patient, so service tag changes persist immediately (same
  // immediate-write pattern as the general Tags picker), rather than staging through profileForm.
  const makePatientServiceTagHandlers = (
    patient: Patient,
    addFn: (patient: Patient, tag: TagDefinition) => Promise<void>,
    removeFn: (patient: Patient, tag: TagDefinition) => Promise<void>,
  ) => ({
    onAdd: (tag: TagDefinition) => void addFn(patient, tag),
    onRemove: (tag: TagDefinition) => void removeFn(patient, tag),
    onCreate: (name: string) => {
      void (async () => {
        const groupId = await ensureServiceGroupId(tagGroups ?? [])
        const tag = await getOrCreateServiceTag(name, serviceTags, groupId)
        await addFn(patient, tag)
      })()
    },
  })

  const togglePatientTaggingSelection = (patientId: number | undefined) => {
    if (patientId === undefined) return
    setSelectedPatientIdsForTagging((previous) => {
      const next = new Set(previous)
      if (next.has(patientId)) next.delete(patientId)
      else next.add(patientId)
      return next
    })
  }
  const exitPatientTaggingSelectionMode = () => {
    setPatientTagSelectionMode(false)
    setSelectedPatientIdsForTagging(new Set())
  }
  const cancelPatientCardLongPress = () => {
    if (patientLongPressTimerRef.current !== null) {
      window.clearTimeout(patientLongPressTimerRef.current)
      patientLongPressTimerRef.current = null
    }
  }
  const handlePatientCardTouchStart = (patientId: number | undefined) => {
    if (patientId === undefined) return
    patientLongPressFiredRef.current = false
    patientLongPressTimerRef.current = window.setTimeout(() => {
      patientLongPressFiredRef.current = true
      setPatientTagSelectionMode(true)
      togglePatientTaggingSelection(patientId)
    }, 500)
  }
  const handlePatientCardTouchEnd = (event: TouchEvent<HTMLElement>) => {
    cancelPatientCardLongPress()
    if (patientLongPressFiredRef.current) {
      event.preventDefault()
    }
    patientLongPressFiredRef.current = false
  }
  const openBulkTagDialog = (mode: 'add' | 'remove') => {
    setBulkTagDialogMode(mode)
    setBulkTagPickerSelectedIds(new Set())
  }
  const toggleBulkTagPickerTag = (tag: TagDefinition) => {
    if (tag.id === undefined) return
    const tagId = tag.id
    setBulkTagPickerSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }
  const bulkTagPickerSelectedTags = useMemo(
    () => nonServiceTagDefinitions.filter((tag) => tag.id !== undefined && bulkTagPickerSelectedIds.has(tag.id)),
    [nonServiceTagDefinitions, bulkTagPickerSelectedIds],
  )
  const confirmBulkTagAction = async () => {
    if (!bulkTagDialogMode) return
    const targetPatients = (patients ?? []).filter(
      (patient) => patient.id !== undefined && selectedPatientIdsForTagging.has(patient.id),
    )
    if (bulkTagPickerSelectedTags.length === 0 || targetPatients.length === 0) return

    setIsBulkTagApplying(true)
    try {
      if (bulkTagDialogMode === 'add') {
        // Snapshot which (patient, tag) pairs are actually transitioning absent→present *before*
        // applying, since Automatic Custom Actions must only fire on that transition (point 4) —
        // applyTagsToPatients itself skips tags a patient already has, but doesn't report which.
        const newlyAddedTagsByPatientId = new Map<number, TagDefinition[]>()
        targetPatients.forEach((patient) => {
          if (patient.id === undefined) return
          const existingTagIds = new Set(patient.tagIds ?? [])
          const newlyAdded = bulkTagPickerSelectedTags.filter((tag) => tag.id !== undefined && !existingTagIds.has(tag.id))
          if (newlyAdded.length > 0) newlyAddedTagsByPatientId.set(patient.id, newlyAdded)
        })

        await applyTagsToPatients(targetPatients, bulkTagPickerSelectedTags)

        for (const patient of targetPatients) {
          if (patient.id === undefined) continue
          const newlyAdded = newlyAddedTagsByPatientId.get(patient.id)
          if (!newlyAdded || newlyAdded.length === 0) continue
          const patientAfterAdd: Patient = { ...patient, tagIds: [...(patient.tagIds ?? []), ...newlyAdded.map((tag) => tag.id as number)] }
          await runAutomaticCustomActionsForTagAddition(patientAfterAdd, newlyAdded.map((tag) => tag.id as number))
        }
      } else {
        await removeTagsFromPatients(targetPatients, bulkTagPickerSelectedTags)
      }
    } finally {
      setIsBulkTagApplying(false)
      setBulkTagConfirmOpen(false)
      setBulkTagDialogMode(null)
      setBulkTagPickerSelectedIds(new Set())
      exitPatientTaggingSelectionMode()
    }
  }

  // Bulk-triggers a Manual Custom Action for every selected patient independently: each patient's
  // conditions are resolved against its own tags, several can match at once, and a patient
  // matching none of them is simply left unaffected and named in a single summary notice rather
  // than pausing the batch with an interactive per-patient prompt. No once-per-day limit (issue
  // #121) — safe to re-run any number of times since tag effects are already idempotent and
  // checklist items skip any text already listed (see appendCustomActionChecklistItems).
  const confirmBulkCustomAction = async () => {
    const action = bulkCustomActionTarget
    if (!action || action.id === undefined) return
    const targetPatients = (patients ?? []).filter(
      (patient) => patient.id !== undefined && selectedPatientIdsForTagging.has(patient.id),
    )
    if (targetPatients.length === 0) return

    setIsBulkCustomActionApplying(true)
    try {
      const today = toLocalISODate()
      const unaffectedPatients: Patient[] = []
      let ranCount = 0
      for (const patient of targetPatients) {
        if (patient.id === undefined) continue

        const matched = resolveMatchingConditions(patient, action)
        if (!actionHasApplicableEffect(action, matched)) {
          unaffectedPatients.push(patient)
          continue
        }
        await applyCustomActionEffects(patient, action, matched, tagsById, (items) => appendCustomActionChecklistItems(patient.id as number, today, items))
        ranCount += 1
      }

      setNotice(
        unaffectedPatients.length > 0
          ? `Ran "${action.name}" for ${ranCount} patient${ranCount === 1 ? '' : 's'}. ${unaffectedPatients.length} not affected — no condition met: ${unaffectedPatients.map((patient) => formatPatientLabelForNotice(patient)).join(', ')}.`
          : `Ran "${action.name}" for ${ranCount} patient${ranCount === 1 ? '' : 's'}.`,
      )
    } finally {
      setIsBulkCustomActionApplying(false)
      setBulkCustomActionTarget(null)
      exitPatientTaggingSelectionMode()
    }
  }

  const refreshSyncInsight = useCallback(async (config: SyncConfig | null) => {
    if (!config) {
      setSyncInsight(null)
      setIsSyncInsightLoading(false)
      return
    }

    setIsSyncInsightLoading(true)
    try {
      const insight = await getSyncInsight(config)
      setSyncInsight(insight)
    } catch {
      setSyncInsight(null)
    } finally {
      setIsSyncInsightLoading(false)
    }
  }, [])

  const latestLocalChangeAt = useMemo(() => {
    let latestTimestamp = 0

    for (const patient of patients ?? []) {
      const parsed = Date.parse(patient.lastModified ?? '')
      if (Number.isFinite(parsed) && parsed > latestTimestamp) {
        latestTimestamp = parsed
      }
    }

    for (const dailyUpdate of allDailyUpdates ?? []) {
      const parsed = Date.parse(dailyUpdate.lastUpdated)
      if (Number.isFinite(parsed) && parsed > latestTimestamp) {
        latestTimestamp = parsed
      }
    }

    return latestTimestamp > 0 ? new Date(latestTimestamp).toISOString() : null
  }, [allDailyUpdates, patients])

  const hasLocalChangesSinceLastSync = useMemo(() => {
    const lastSyncedMs = syncConfig?.lastSyncedAt ? Date.parse(syncConfig.lastSyncedAt) : Number.NaN
    const latestLocalMs = latestLocalChangeAt ? Date.parse(latestLocalChangeAt) : Number.NaN

    return Number.isFinite(lastSyncedMs)
      ? Number.isFinite(latestLocalMs) && latestLocalMs > lastSyncedMs
      : Number.isFinite(latestLocalMs)
  }, [latestLocalChangeAt, syncConfig?.lastSyncedAt])

  const formatSyncDateTime = useCallback((isoString: string | null | undefined) => {
    if (!isoString) return '—'

    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) return '—'

    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }, [])

  const latestUploadOwnerLabel = useMemo(() => {
    if (!syncInsight?.remoteLatestPushedBy) return '—'
    return syncInsight.remoteLatestPushedBy === syncConfig?.deviceTag
      ? `${syncInsight.remoteLatestPushedBy} (this device)`
      : syncInsight.remoteLatestPushedBy
  }, [syncConfig?.deviceTag, syncInsight?.remoteLatestPushedBy])

  const syncButtonStatus = useMemo<SyncStatus>(() => {
    if (syncStatus === 'syncing' || syncStatus === 'error' || syncStatus === 'conflict' || syncStatus === 'not-configured') {
      return syncStatus
    }

    if (!syncConfig) return 'not-configured'
    if (hasLocalChangesSinceLastSync && syncInsight?.remoteHasNewerData) return 'conflict'
    if (hasLocalChangesSinceLastSync) return 'push-ready'
    if (syncInsight?.remoteHasNewerData) return 'updates-available'
    return 'synced'
  }, [hasLocalChangesSinceLastSync, syncConfig, syncInsight?.remoteHasNewerData, syncStatus])

  useEffect(() => {
    void refreshSyncInsight(syncConfig)
  }, [refreshSyncInsight, syncConfig])

  const savedDailyEntryDates = useLiveQuery(async () => {
    if (selectedPatientId === null) return [] as string[]

    const entries = await db.dailyUpdates.where('patientId').equals(selectedPatientId).toArray()
    return Array.from(new Set(entries.map((entry) => entry.date))).sort((a, b) => a.localeCompare(b))
  }, [selectedPatientId])
  const patientVitals = useLiveQuery(async () => {
    if (selectedPatientId === null) return [] as VitalEntry[]
    const vitals = await db.vitals.where('patientId').equals(selectedPatientId).toArray()
    return vitals.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date)
      }
      if (a.time !== b.time) {
        return a.time.localeCompare(b.time)
      }
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [selectedPatientId])
  const patientTagEvents = useLiveQuery(async () => {
    if (selectedPatientId === null) return [] as TagEvent[]
    return db.tagEvents.where('patientId').equals(selectedPatientId).toArray()
  }, [selectedPatientId])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredInstallPromptEvent(event as InstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setDeferredInstallPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    if ('storage' in navigator && 'persist' in navigator.storage) {
      void navigator.storage.persist()
    }
  }, [])

  useEffect(() => {
    if (patients && patients.length === 0) {
      setShowOnboarding(true)
    }
  }, [patients])

  useEffect(() => {
    if (!showOnboarding) {
      onboardingAutoInstallAttemptedRef.current = false
      return
    }

    if (
      isStandaloneDisplayMode
      || deferredInstallPromptEvent === null
      || onboardingAutoInstallAttemptedRef.current
    ) {
      return
    }

    onboardingAutoInstallAttemptedRef.current = true

    const runInstallPrompt = async () => {
      try {
        await deferredInstallPromptEvent.prompt()
        const choice = await deferredInstallPromptEvent.userChoice
        setDeferredInstallPromptEvent(null)
        setNotice(choice.outcome === 'accepted' ? 'Install prompt accepted.' : 'Install prompt dismissed.')
      } catch {
        setNotice('Use browser menu → Install app/Add to Home screen to install PUHRR.')
      }
    }

    void runInstallPrompt()
  }, [deferredInstallPromptEvent, isStandaloneDisplayMode, showOnboarding])

  useEffect(() => {
    if (!notice) {
      setNoticeIsDecaying(false)
      return
    }

    setNoticeIsDecaying(false)

    const decayTimeoutId = window.setTimeout(() => {
      setNoticeIsDecaying(true)
    }, 5000)

    const clearTimeoutId = window.setTimeout(() => {
      setNotice('')
      setNoticeIsDecaying(false)
    }, 10000)

    return () => {
      window.clearTimeout(decayTimeoutId)
      window.clearTimeout(clearTimeoutId)
    }
  }, [notice])

  const selectedPatient = useMemo(
    () => (patients ?? []).find((patient) => patient.id === selectedPatientId),
    [patients, selectedPatientId],
  )

  const appliedPatientTags = useMemo(
    () => selectedPatient ? orderTagsCanonically(getAppliedPatientTags(selectedPatient, tagsById), tagGroups ?? []) : [],
    [selectedPatient, tagsById, tagGroups],
  )

  // Discharge Date's default: the most recent "added" Tag Event for any Terminal-flagged tag the
  // patient currently carries, falling back to today when no such event was ever logged. Purely
  // computed — never persisted unless the user types an override.
  const defaultDischargeDateIso = useMemo(() => {
    const terminalTagIds = new Set(appliedPatientTags.filter((tag) => tag.terminal).map((tag) => tag.id))
    if (terminalTagIds.size === 0) return toLocalISODate()

    const addedEvents = (patientTagEvents ?? []).filter((event) => event.action === 'added' && terminalTagIds.has(event.tagId))
    if (addedEvents.length === 0) return toLocalISODate()

    const latestEvent = addedEvents.reduce((latest, event) => (event.at > latest.at ? event : latest))
    return toLocalISODate(new Date(latestEvent.at))
  }, [appliedPatientTags, patientTagEvents])

  // Admission Date & Referral Date's default: the date the profile was created. Purely computed —
  // never persisted unless the user types an override.
  const defaultCreatedDateIso = useMemo(
    () => (selectedPatient ? toLocalISODate(new Date(selectedPatient.createdAt)) : null),
    [selectedPatient],
  )

  // Referral Date only appears once the user has applied a "Referral" tag to the patient.
  const hasReferralTag = useMemo(() => appliedPatientTags.some((tag) => tag.name === 'Referral'), [appliedPatientTags])

  // Sticky per patient: an explicit user toggle always wins. Absent one, falls back to a default
  // snapshotted the first time this patient's tags were viewed this session (collapsed if tags
  // were already applied then, expanded otherwise) — later tag adds/removes don't reconsider
  // that snapshot, only another user toggle does. Zero applied tags right now always forces
  // expanded, regardless of sticky state, since there's nothing to show in the collapsed view.
  const isEditingTags = useMemo(() => {
    if (selectedPatient?.id === undefined) return true
    const patientId = selectedPatient.id

    if (!tagsCollapseDefaultSeedRef.current.has(patientId)) {
      tagsCollapseDefaultSeedRef.current.set(patientId, appliedPatientTags.length > 0)
    }

    if (appliedPatientTags.length === 0) return true

    const override = tagsEditOverrideByPatientId.get(patientId)
    if (override !== undefined) return override

    return !tagsCollapseDefaultSeedRef.current.get(patientId)
  }, [appliedPatientTags, selectedPatient, tagsEditOverrideByPatientId])

  const activePatients = useMemo(() => (patients ?? []).filter((patient) => isPatientActive(patient, tagsById)), [patients, tagsById])

  const reportingSelectablePatients = useMemo(() => {
    return [...activePatients].sort((a, b) => {
      const byRoom = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
      if (byRoom !== 0) return byRoom
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })
  }, [activePatients])

  // The General (no-patient) checklist first, then real patients (issue #79) — a plain
  // {id, label} list rather than Patient objects, since General has no such record.
  const masterChecklistQuickAddOptions = useMemo(() => [
    { id: GENERAL_CHECKLIST_PATIENT_ID, label: GENERAL_CHECKLIST_LABEL },
    ...reportingSelectablePatients
      .filter((patient): patient is Patient & { id: number } => patient.id !== undefined)
      .map((patient) => ({ id: patient.id, label: `${patient.roomNumber} — ${patient.lastName}, ${patient.firstName}` })),
  ], [reportingSelectablePatients])

  // Issue #81 Patient Pool facet: unlike the quick-add list above (always active-only), the
  // Multiple Census/Vitals picker draws from the FULL roster, narrowed by the Tag+Ward filter and
  // by the Patient Pool facet (which defaults to "Active" — matching the picker's old active-only
  // behavior — but can also surface Admitted/Discharged/Referred/MGH patients within a window).
  const patientPoolContext = useMemo(
    () => buildPatientPoolContext(tagsById, allTagEvents ?? []),
    [tagsById, allTagEvents],
  )
  // Recomputed (not on every render, which would recreate a new object each time and defeat the
  // memos/effect below that key off it) whenever the raw window fields change or the filter
  // dialog opens/closes — close enough to "now" for a manual filter window, without the object
  // identity churning every render.
  const censusPoolWindowDefaults = useMemo(
    () => computeDefaultWindowLookback(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are a deliberate recompute trigger, not captured values
    [censusPoolWindow, censusFilterDialogOpen],
  )
  const censusResolvedWindow = useMemo(
    () => resolveWindowDefaults(censusPoolWindow, censusPoolWindowDefaults),
    [censusPoolWindow, censusPoolWindowDefaults],
  )
  const censusEffectiveWindow = useMemo(
    () => (censusPoolUseWindow ? censusResolvedWindow : null),
    [censusPoolUseWindow, censusResolvedWindow],
  )
  const censusSelectablePatients = useMemo(() => {
    return (patients ?? [])
      .filter((patient) => matchesTagWardFilter(patient, censusFilter))
      .filter((patient) => matchesPatientPool(patient, censusPoolCriteria, censusEffectiveWindow, patientPoolContext))
      .sort((a, b) => {
        const byRoom = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
        if (byRoom !== 0) return byRoom
        return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
      })
  }, [patients, censusFilter, censusPoolCriteria, censusEffectiveWindow, patientPoolContext])
  const censusSelectablePatientIds = useMemo(
    () => censusSelectablePatients.map((patient) => patient.id).filter((id): id is number => id !== undefined),
    [censusSelectablePatients],
  )

  useEffect(() => {
    if (censusSelectablePatientIds.length === 0) {
      censusSelectionInitializedRef.current = false
      setSelectedCensusPatientIds([])
      return
    }

    // The ref check happens here, outside the updater, and mutates synchronously — so React
    // StrictMode's dev-only double-invocation of this effect (which re-runs the setup function
    // without an intervening render) sees the ref's already-updated value on its second pass,
    // instead of a stale `previous` read from inside a functional updater on both passes.
    if (!censusSelectionInitializedRef.current) {
      censusSelectionInitializedRef.current = true
      setSelectedCensusPatientIds(censusSelectablePatientIds)
      return
    }

    setSelectedCensusPatientIds((previous) => {
      const selectableIdSet = new Set(censusSelectablePatientIds)
      return previous.filter((id) => selectableIdSet.has(id))
    })
  }, [censusSelectablePatientIds])

  const selectedCensusPatients = useMemo(() => {
    const patientsById = new Map<number, Patient>()
    censusSelectablePatients.forEach((patient) => {
      if (patient.id === undefined) return
      patientsById.set(patient.id, patient)
    })

    return selectedCensusPatientIds
      .map((id) => patientsById.get(id))
      .filter((patient): patient is Patient => patient !== undefined)
  }, [censusSelectablePatients, selectedCensusPatientIds])

  const toggleCensusPatientSelection = (patientId: number) => {
    setSelectedCensusPatientIds((previous) =>
      previous.includes(patientId)
        ? previous.filter((id) => id !== patientId)
        : [...previous, patientId],
    )
  }

  const selectAllCensusPatients = () => {
    setSelectedCensusPatientIds(censusSelectablePatientIds)
  }

  const clearCensusPatientsSelection = () => {
    setSelectedCensusPatientIds([])
  }

  const reorderCensusPatientSelection = (sourcePatientId: number, targetPatientId: number) => {
    setSelectedCensusPatientIds((previous) => moveItemByKey(previous, (id) => id, sourcePatientId, targetPatientId))
  }
  const censusPatientDrag = useDragReorder(selectedCensusPatientIds, reorderCensusPatientSelection)

  const toggleSelectedPatientLabReportId = (labId: number) => {
    setSelectedPatientLabReportIds((previous) =>
      previous.includes(labId)
        ? previous.filter((id) => id !== labId)
        : [...previous, labId],
    )
  }

  const structuredMedsByPatient = useMemo(() => {
    const grouped = new Map<number, MedicationEntry[]>()
    ;(medications ?? []).forEach((entry) => {
      const list = grouped.get(entry.patientId) ?? []
      list.push(entry)
      grouped.set(entry.patientId, list)
    })

    grouped.forEach((list) => {
      list.sort((a, b) => {
        const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER
        const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER
        if (aOrder !== bOrder) {
          return aOrder - bOrder
        }
        if (a.createdAt !== b.createdAt) {
          return b.createdAt.localeCompare(a.createdAt)
        }
        return (a.id ?? 0) - (b.id ?? 0)
      })
    })

    return grouped
  }, [medications])

  const selectedPatientStructuredMeds = useMemo(() => {
    if (selectedPatientId === null) return []
    return structuredMedsByPatient.get(selectedPatientId) ?? []
  }, [selectedPatientId, structuredMedsByPatient])

  const structuredLabsByPatient = useMemo(() => {
    const grouped = new Map<number, LabEntry[]>()
    ;(labs ?? []).forEach((entry) => {
      const list = grouped.get(entry.patientId) ?? []
      list.push(entry)
      grouped.set(entry.patientId, list)
    })

    grouped.forEach((list) => {
      list.sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date)
        }
        const aTime = a.time ?? ''
        const bTime = b.time ?? ''
        if (aTime !== bTime) {
          return bTime.localeCompare(aTime)
        }
        return b.createdAt.localeCompare(a.createdAt)
      })
    })

    return grouped
  }, [labs])

  const selectedPatientStructuredLabs = useMemo(() => {
    if (selectedPatientId === null) return []
    return structuredLabsByPatient.get(selectedPatientId) ?? []
  }, [selectedPatientId, structuredLabsByPatient])

  useEffect(() => {
    const entryIds = selectedPatientStructuredLabs
      .map((entry) => entry.id)
      .filter((id): id is number => id !== undefined)
    setSelectedPatientLabReportIds(entryIds)
  }, [selectedPatientId, selectedPatientStructuredLabs])

  const labTemplatesById = useMemo(
    () => new Map(LAB_TEMPLATES.map((template) => [template.id, template] as const)),
    [],
  )

  const selectedPatientLabGroupsForReporting = useMemo(() => {
    const grouped = new Map<string, LabEntry[]>()
    selectedPatientStructuredLabs.forEach((entry) => {
      const list = grouped.get(entry.templateId) ?? []
      list.push(entry)
      grouped.set(entry.templateId, list)
    })
    return Array.from(grouped.entries()).map(([templateId, entries]) => {
      const template = labTemplatesById.get(templateId)
      const templateName = template?.name ?? templateId
      return {
        templateId,
        templateName,
        entries,
      }
    })
  }, [labTemplatesById, selectedPatientStructuredLabs])

  const selectedLabTemplate = useMemo(
    () => LAB_TEMPLATES.find((template) => template.id === selectedLabTemplateId) ?? LAB_TEMPLATES[0],
    [selectedLabTemplateId],
  )

  const isAbgLabTemplate = selectedLabTemplate.id === UST_ABG_TEMPLATE_ID

  const abgNormalAaDo2 = useMemo(() => {
    if (!selectedPatient) return null
    return getNormalAaDo2(selectedPatient.age)
  }, [selectedPatient])

  const abgNormalPfRatio = useMemo(() => {
    if (!selectedPatient) return null
    return getNormalPfRatio(selectedPatient.age)
  }, [selectedPatient])

  useEffect(() => {
    if (!isAbgLabTemplate) return

    setLabTemplateValues((previous) => {
      const actualPaO2 = parseNumericInput(previous[ABG_PO2_KEY])
      const actualFiO2Percent = parseNumericInput(previous[ABG_ACTUAL_FIO2_KEY])

      const pfRatio =
        actualPaO2 !== null && actualFiO2Percent !== null && actualFiO2Percent > 0
          ? formatCalculatedNumber(actualPaO2 / (actualFiO2Percent / 100), 2)
          : ''

      const desiredFiO2 =
        actualPaO2 !== null &&
        actualPaO2 > 0 &&
        actualFiO2Percent !== null &&
        (actualFiO2Percent > 21 || actualPaO2 < 60)
          ? formatCalculatedNumber((actualFiO2Percent * DEFAULT_ABG_DESIRED_PAO2) / actualPaO2, 2)
          : ''

      const currentPfRatio = previous[ABG_PF_RATIO_KEY] ?? ''
      const currentDesiredFiO2 = previous[ABG_DESIRED_FIO2_KEY] ?? ''

      if (currentPfRatio === pfRatio && currentDesiredFiO2 === desiredFiO2) {
        return previous
      }

      return {
        ...previous,
        [ABG_PF_RATIO_KEY]: pfRatio,
        [ABG_DESIRED_FIO2_KEY]: desiredFiO2,
      }
    })
  }, [isAbgLabTemplate, labTemplateValues])

  const structuredOrdersByPatient = useMemo(() => {
    const grouped = new Map<number, OrderEntry[]>()
    ;(orders ?? []).forEach((entry) => {
      const list = grouped.get(entry.patientId) ?? []
      list.push(entry)
      grouped.set(entry.patientId, list)
    })

    grouped.forEach((list) => {
      list.sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === 'active') return -1
          if (b.status === 'active') return 1
          if (a.status === 'carriedOut') return -1
          if (b.status === 'carriedOut') return 1
        }
        return b.createdAt.localeCompare(a.createdAt)
      })
    })

    return grouped
  }, [orders])

  const structuredVitalsByPatient = useMemo(() => {
    const grouped = new Map<number, VitalEntry[]>()
    ;(allVitals ?? []).forEach((entry) => {
      const list = grouped.get(entry.patientId) ?? []
      list.push(entry)
      grouped.set(entry.patientId, list)
    })

    grouped.forEach((list) => {
      list.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        if (a.time !== b.time) return a.time.localeCompare(b.time)
        return a.createdAt.localeCompare(b.createdAt)
      })
    })

    return grouped
  }, [allVitals])

  const selectedPatientOrders = useMemo(() => {
    if (selectedPatientId === null) return []
    return structuredOrdersByPatient.get(selectedPatientId) ?? []
  }, [selectedPatientId, structuredOrdersByPatient])

  const patientsById = useMemo(() => {
    const map = new Map<number, Patient>()
    ;(patients ?? []).forEach((patient) => {
      if (patient.id === undefined) return
      map.set(patient.id, patient)
    })
    return map
  }, [patients])

  const dailyUpdatesByPatient = useMemo(() => {
    const grouped = new Map<number, DailyUpdate[]>()
    ;(allDailyUpdates ?? []).forEach((entry) => {
      const list = grouped.get(entry.patientId) ?? []
      list.push(entry)
      grouped.set(entry.patientId, list)
    })

    grouped.forEach((list) => {
      list.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.lastUpdated.localeCompare(b.lastUpdated)
      })
    })

    return grouped
  }, [allDailyUpdates])

  const masterChecklistItems = useMemo<MasterChecklistItem[]>(() => {
    const sortedPatients = (patients ?? [])
      .filter((patient) => isPatientActive(patient, tagsById))
      .sort((a, b) => {
      const byRoom = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
      if (byRoom !== 0) return byRoom
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })

    const items: MasterChecklistItem[] = [
      ...buildMasterChecklistItemsForSource(
        GENERAL_CHECKLIST_PATIENT_ID,
        GENERAL_CHECKLIST_LABEL,
        dailyUpdatesByPatient.get(GENERAL_CHECKLIST_PATIENT_ID) ?? [],
        masterChecklistDate,
      ),
    ]

    sortedPatients.forEach((patient) => {
      if (patient.id === undefined) return
      const patientId = patient.id
      const patientIdentifier = `${patient.roomNumber} — ${patient.lastName.toUpperCase()}`

      items.push(...buildMasterChecklistItemsForSource(
        patientId,
        patientIdentifier,
        dailyUpdatesByPatient.get(patientId) ?? [],
        masterChecklistDate,
      ))
    })

    return items
  }, [dailyUpdatesByPatient, masterChecklistDate, patients, tagsById])

  const reviewablePhotoAttachments = useMemo(() => {
    return (photoAttachments ?? [])
      .filter((entry): entry is ReviewablePhotoAttachment => entry.id !== undefined)
      .sort(comparePhotosByNewest)
  }, [photoAttachments])

  const reviewablePhotoGroups = useMemo(() => {
    const groupsById = new Map<string, PhotoAttachmentGroup & { patientId: number }>()
    reviewablePhotoAttachments.forEach((entry) => {
      const groupKey = getPhotoGroupKey(entry)
      const existing = groupsById.get(groupKey)
      if (existing) {
        existing.entries.push(entry)
        existing.totalByteSize += entry.byteSize
        if (entry.createdAt > existing.createdAt) {
          existing.createdAt = entry.createdAt
        }
        return
      }

      groupsById.set(groupKey, {
        groupId: groupKey,
        createdAt: entry.createdAt,
        entries: [entry],
        totalByteSize: entry.byteSize,
        patientId: entry.patientId,
      })
    })

    return Array.from(groupsById.values())
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort(comparePhotosByNewest),
      }))
      .sort(comparePhotoGroupsByNewest)
  }, [reviewablePhotoAttachments])

  const selectedPatientAllAttachments = useMemo(() => {
    if (selectedPatientId === null) return [] as PhotoAttachment[]

    return (photoAttachments ?? [])
      .filter((entry) => entry.patientId === selectedPatientId)
      .sort(comparePhotosByNewest)
  }, [photoAttachments, selectedPatientId])

  const selectedPatientAttachmentGroups = useMemo(() => {
    const scopedAttachments = selectedPatientAllAttachments
      .filter((entry): entry is PhotoAttachment & { id: number } => entry.id !== undefined)
      .filter((entry) => (attachmentFilter === 'all' ? true : entry.category === attachmentFilter))

    const groupsById = new Map<string, PhotoAttachmentGroup>()
    scopedAttachments.forEach((entry) => {
      const groupKey = getPhotoGroupKey(entry)
      const existing = groupsById.get(groupKey)
      if (existing) {
        existing.entries.push(entry)
        existing.totalByteSize += entry.byteSize
        if (entry.createdAt > existing.createdAt) {
          existing.createdAt = entry.createdAt
        }
        return
      }

      groupsById.set(groupKey, {
        groupId: groupKey,
        createdAt: entry.createdAt,
        entries: [entry],
        totalByteSize: entry.byteSize,
      })
    })

    return Array.from(groupsById.values())
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort(comparePhotosByNewest),
      }))
      .sort(comparePhotoGroupsByNewest)
  }, [attachmentFilter, selectedPatientAllAttachments])

  const selectedPatientExpandedPhotoSections = useMemo(() => {
    const scopedAttachments = selectedPatientAllAttachments
      .filter((entry): entry is PhotoAttachment & { id: number } => entry.id !== undefined)
      .filter((entry) => (attachmentFilter === 'all' ? true : entry.category === attachmentFilter))

    const entriesByCategory = new Map<PhotoCategory, Array<PhotoAttachment & { id: number }>>()
    scopedAttachments.forEach((entry) => {
      const list = entriesByCategory.get(entry.category) ?? []
      list.push(entry)
      entriesByCategory.set(entry.category, list)
    })

    return PHOTO_CATEGORY_OPTIONS
      .filter((option) => entriesByCategory.has(option.value))
      .map((option) => ({
        category: option.value,
        label: option.label,
        entries: [...(entriesByCategory.get(option.value) ?? [])].sort(comparePhotosByNewest),
      }))
  }, [attachmentFilter, selectedPatientAllAttachments])

  const mentionableAttachments = useMemo(() => {
    const mapped = selectedPatientAllAttachments
      .filter((entry): entry is PhotoAttachment & { id: number } => entry.id !== undefined && entry.title.trim().length > 0)
      .map((entry) => ({
        id: entry.id,
        title: entry.title.trim(),
        category: entry.category,
        createdAt: entry.createdAt,
      }))

    const uniqueByTitle = new Map<string, MentionablePhoto>()
    mapped.forEach((entry) => {
      const key = entry.title.toLowerCase()
      if (!uniqueByTitle.has(key)) {
        uniqueByTitle.set(key, entry)
      }
    })

    return Array.from(uniqueByTitle.values())
  }, [selectedPatientAllAttachments])

  const mentionableAttachmentByTitle = useMemo(() => {
    const byTitle = new Map<string, MentionablePhoto>()
    mentionableAttachments.forEach((entry) => {
      byTitle.set(entry.title.toLowerCase(), entry)
    })
    return byTitle
  }, [mentionableAttachments])

  const openPhotoById = useCallback((attachmentId: number) => {
    setAttachmentViewerSource('patient')
    setIsCarouselChromeVisible(false)
    setSelectedAttachmentId(attachmentId)
  }, [])

  const openReviewPhotoById = useCallback((attachmentId: number) => {
    setAttachmentViewerSource('review')
    setIsCarouselChromeVisible(false)
    setSelectedAttachmentId(attachmentId)
  }, [])

  useEffect(() => {
    const urls: Record<number, string> = {}
    selectedPatientAllAttachments.forEach((entry) => {
      if (entry.id === undefined) return
      urls[entry.id] = URL.createObjectURL(entry.imageBlob)
    })
    setAttachmentPreviewUrls(urls)

    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [selectedPatientAllAttachments])

  useEffect(() => {
    const urls: Record<number, string> = {}
    reviewablePhotoAttachments.forEach((entry) => {
      urls[entry.id] = URL.createObjectURL(entry.imageBlob)
    })
    setAllAttachmentPreviewUrls(urls)

    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [reviewablePhotoAttachments])

  const selectedAttachmentCarousel = useMemo(() => {
    if (selectedAttachmentId === null) return null

    const sourceAttachments = attachmentViewerSource === 'review' ? reviewablePhotoAttachments : selectedPatientAllAttachments

    const grouped = new Map<string, Array<PhotoAttachment & { id: number }>>()
    sourceAttachments
      .filter((entry): entry is PhotoAttachment & { id: number } => entry.id !== undefined)
      .forEach((entry) => {
        const key = getPhotoGroupKey(entry)
        const list = grouped.get(key) ?? []
        list.push(entry)
        grouped.set(key, list)
      })

    for (const entries of grouped.values()) {
      const sortedEntries = [...entries].sort(comparePhotosByNewest)
      const currentIndex = sortedEntries.findIndex((entry) => entry.id === selectedAttachmentId)
      if (currentIndex >= 0) {
        return {
          entries: sortedEntries,
          currentIndex,
        }
      }
    }

    return null
  }, [attachmentViewerSource, reviewablePhotoAttachments, selectedAttachmentId, selectedPatientAllAttachments])

  const carouselPreviewUrls = attachmentViewerSource === 'review' ? allAttachmentPreviewUrls : attachmentPreviewUrls

  const selectedAttachmentCarouselEntry = selectedAttachmentCarousel
    ? selectedAttachmentCarousel.entries[selectedAttachmentCarousel.currentIndex]
    : null

  const moveCarousel = useCallback((direction: 'previous' | 'next') => {
    if (!selectedAttachmentCarousel) return

    const total = selectedAttachmentCarousel.entries.length
    if (total <= 1) return

    const offset = direction === 'next' ? 1 : -1
    const nextIndex = (selectedAttachmentCarousel.currentIndex + offset + total) % total
    setSelectedAttachmentId(selectedAttachmentCarousel.entries[nextIndex].id)
  }, [selectedAttachmentCarousel])

  const jumpToCarouselIndex = useCallback((targetIndex: number) => {
    if (!selectedAttachmentCarousel) return

    const boundedIndex = Math.max(0, Math.min(targetIndex, selectedAttachmentCarousel.entries.length - 1))
    const entry = selectedAttachmentCarousel.entries[boundedIndex]
    if (!entry) return
    setSelectedAttachmentId(entry.id)
  }, [selectedAttachmentCarousel])

  // Swipe left/right on the full-screen photo viewer to move through the carousel, mirroring
  // the patient-card swipe's feel exactly: the same deadzone/lock approach (only locks into a
  // horizontal drag, and blocks the page/click once locked, after movement is clearly more
  // horizontal than vertical, so a plain tap still reaches the chrome-toggle onClick and a
  // vertical drag is untouched), the same live 1:1 finger-tracked translate+fade during the
  // drag (mutated directly on the ref'd node, bypassing React, since this component re-renders
  // the whole app on every setState), and on release the same spring-back (below threshold) or
  // exit-then-opposite-edge-entry animation (at/above threshold) driven by a handful of state
  // updates rather than per-frame ones. Ignored when the gesture starts on a control or an
  // explicitly opted-out area (see data-no-swipe, used by the thumbnail strip).
  const photoSwipeStartRef = useRef<{ x: number; y: number; locked: boolean } | null>(null)
  const photoSwipeVisualRef = useRef<HTMLDivElement | null>(null)
  const photoSwipeExitTimeoutRef = useRef<number | null>(null)
  const photoSwipeRafRef = useRef<number | null>(null)
  const photoSwipePendingDeltaXRef = useRef(0)
  const [photoSwipeOffsetX, setPhotoSwipeOffsetX] = useState(0)
  const [photoSwipeTransitionOn, setPhotoSwipeTransitionOn] = useState(false)
  const [photoSwipeReleaseActive, setPhotoSwipeReleaseActive] = useState(false)

  const PHOTO_SWIPE_LOCK_DEADZONE_PX = 10
  const PHOTO_SWIPE_MIN_DISTANCE_PX = 60
  const PHOTO_SWIPE_EXIT_DISTANCE_PX = 300
  const PHOTO_SWIPE_ENTRY_DISTANCE_PX = 56
  const PHOTO_SWIPE_EXIT_DURATION_MS = 180

  const photoSwipeOpacityForOffset = (offsetX: number) => 1 - Math.min(Math.abs(offsetX) / 250, 0.85)

  const applyPhotoSwipeVisualTransform = (offsetX: number) => {
    const node = photoSwipeVisualRef.current
    if (!node) return
    node.style.transform = `translateX(${offsetX}px)`
    node.style.opacity = String(photoSwipeOpacityForOffset(offsetX))
  }

  const resetPhotoSwipe = () => {
    photoSwipeStartRef.current = null
    if (photoSwipeRafRef.current !== null) {
      cancelAnimationFrame(photoSwipeRafRef.current)
      photoSwipeRafRef.current = null
    }
    setPhotoSwipeReleaseActive(false)
    setPhotoSwipeTransitionOn(false)
    setPhotoSwipeOffsetX(0)
    applyPhotoSwipeVisualTransform(0)
  }

  const handlePhotoSwipeTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('button, [data-no-swipe]')) {
      photoSwipeStartRef.current = null
      return
    }
    if (photoSwipeExitTimeoutRef.current !== null) {
      window.clearTimeout(photoSwipeExitTimeoutRef.current)
      photoSwipeExitTimeoutRef.current = null
    }
    const touch = event.touches[0]
    if (!touch) return
    resetPhotoSwipe()
    photoSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, locked: false }
  }

  const handlePhotoSwipeTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = photoSwipeStartRef.current
    if (!start) return
    const touch = event.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (!start.locked) {
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > PHOTO_SWIPE_LOCK_DEADZONE_PX) {
        photoSwipeStartRef.current = null
        return
      }
      if (Math.abs(deltaX) < PHOTO_SWIPE_LOCK_DEADZONE_PX) return
      start.locked = true
    }

    event.preventDefault()
    photoSwipePendingDeltaXRef.current = deltaX
    if (photoSwipeRafRef.current !== null) return
    photoSwipeRafRef.current = requestAnimationFrame(() => {
      photoSwipeRafRef.current = null
      applyPhotoSwipeVisualTransform(photoSwipePendingDeltaXRef.current)
    })
  }

  const handlePhotoSwipeTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = photoSwipeStartRef.current
    photoSwipeStartRef.current = null
    if (photoSwipeRafRef.current !== null) {
      cancelAnimationFrame(photoSwipeRafRef.current)
      photoSwipeRafRef.current = null
    }
    if (!start?.locked) {
      resetPhotoSwipe()
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch ? touch.clientX - start.x : photoSwipePendingDeltaXRef.current
    const direction: 'next' | 'previous' = deltaX < 0 ? 'next' : 'previous'
    const hasMultiplePhotos = (selectedAttachmentCarousel?.entries.length ?? 0) > 1
    const shouldAdvance = hasMultiplePhotos && Math.abs(deltaX) >= PHOTO_SWIPE_MIN_DISTANCE_PX

    // Hand off from the imperative ref-driven transform to React-state-driven `style` at the
    // exact live position, so switching modes here can't cause a visual jump.
    setPhotoSwipeReleaseActive(true)
    setPhotoSwipeTransitionOn(false)
    setPhotoSwipeOffsetX(deltaX)

    if (!shouldAdvance) {
      requestAnimationFrame(() => {
        setPhotoSwipeTransitionOn(true)
        setPhotoSwipeOffsetX(0)
      })
      return
    }

    const exitOffset = direction === 'next' ? -PHOTO_SWIPE_EXIT_DISTANCE_PX : PHOTO_SWIPE_EXIT_DISTANCE_PX
    requestAnimationFrame(() => {
      setPhotoSwipeTransitionOn(true)
      setPhotoSwipeOffsetX(exitOffset)
    })
    photoSwipeExitTimeoutRef.current = window.setTimeout(() => {
      moveCarousel(direction)
      setPhotoSwipeTransitionOn(false)
      setPhotoSwipeOffsetX(direction === 'next' ? PHOTO_SWIPE_ENTRY_DISTANCE_PX : -PHOTO_SWIPE_ENTRY_DISTANCE_PX)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhotoSwipeTransitionOn(true)
          setPhotoSwipeOffsetX(0)
        })
      })
    }, PHOTO_SWIPE_EXIT_DURATION_MS)
  }

  useEffect(() => {
    if (!selectedAttachmentCarouselEntry) return

    const handleCarouselKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase()
        if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
          return
        }
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveCarousel('previous')
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveCarousel('next')
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        jumpToCarouselIndex(0)
        return
      }

      if (event.key === 'End' && selectedAttachmentCarousel) {
        event.preventDefault()
        jumpToCarouselIndex(selectedAttachmentCarousel.entries.length - 1)
      }
    }

    window.addEventListener('keydown', handleCarouselKeyDown)
    return () => {
      window.removeEventListener('keydown', handleCarouselKeyDown)
    }
  }, [jumpToCarouselIndex, moveCarousel, selectedAttachmentCarousel, selectedAttachmentCarouselEntry])

  useEffect(() => {
    if (!selectedAttachmentCarouselEntry) return

    const activeThumbnailButton = carouselThumbnailButtonRefs.current[selectedAttachmentCarouselEntry.id]
    if (!activeThumbnailButton) return

    activeThumbnailButton.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [selectedAttachmentCarouselEntry])

  // Ward facet options — shared by all three views' filter dialogs.
  const distinctWards = useMemo(() => collectDistinctWards(patients ?? []), [patients])

  // Point 2, issue #81: (Tag facet AND/OR result) AND (ward match, if any) AND (patient pool, in the census view).
  const visiblePatients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matchesQuery = (patient: Patient) => {
      if (!query) return true
      const serviceNames = [
        ...resolveServiceTagNames(patient.mainServiceTagIds, tagsById),
        ...resolveServiceTagNames(patient.referralServiceTagIds, tagsById),
      ]
      return [patient.roomNumber, patient.ward, patient.lastName, patient.firstName, ...serviceNames]
        .join(' ')
        .toLowerCase()
        .includes(query)
    }

    const compareByRoom = (a: Patient, b: Patient) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })

    return (patients ?? [])
      .filter((patient) => {
        if (statusFilter === 'all') return true
        const active = isPatientActive(patient, tagsById)
        return statusFilter === 'active' ? active : !active
      })
      .filter(matchesQuery)
      .filter((patient) => matchesTagWardFilter(patient, patientListFilter))
      .sort((a, b) => {
        if (sortBy === 'name') {
          return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
        }
        if (sortBy === 'admitDate') {
          return getEffectiveAdmitDate(b.admitDate, b.createdAt).localeCompare(getEffectiveAdmitDate(a.admitDate, a.createdAt))
        }
        return compareByRoom(a, b)
      })
  }, [patients, searchQuery, sortBy, statusFilter, tagsById, patientListFilter])

  const quickSwitchPatients = useMemo(() => {
    const compareByRoom = (a: Patient, b: Patient) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })

    return (patients ?? [])
      .filter((patient) => isPatientActive(patient, tagsById))
      .sort(compareByRoom)
  }, [patients, tagsById])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.lastName.trim()) return
    const parsedAge = Number.parseInt(form.age, 10)
    const age = Number.isFinite(parsedAge) ? parsedAge : 0

    const now = new Date().toISOString()
    const patientPayload: Omit<Patient, 'id'> = {
      lastModified: now,
      createdAt: now,
      roomNumber: form.roomNumber.trim(),
      ward: form.ward.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      age,
      sex: form.sex,
      diagnosis: '',
      admitDate: '',
      referralDate: '',
      mainServiceTagIds: pendingMainServiceTagIds,
      referralServiceTagIds: [],
      attendingPhysician: '',
      clinicalSummary: '',
      database: '',
      plans: '',
      medications: '',
      labs: '',
      pendings: '',
      tagIds: [],
    }

    await db.patients.add(patientPayload)
    setForm(initialForm)
    setPendingMainServiceTagIds([])
  }

  const loadDailyUpdate = useCallback(async (patientId: number, date: string) => {
    const update = await db.dailyUpdates.where('[patientId+date]').equals([patientId, date]).first()
    if (!update) {
      const priorUpdates = (await db.dailyUpdates.where('patientId').equals(patientId).toArray())
        .filter((entry) => entry.date < date)
      const latestPriorUpdate = selectLatestDailyUpdate(priorUpdates)
      setDailyUpdateId(undefined)
      setDailyUpdateForm({
        ...initialDailyUpdateForm,
        problems: toPendingProblemBlocks(latestPriorUpdate?.problems),
        checklist: toPendingChecklistItems(latestPriorUpdate?.checklist),
      })
      setDailyDirty(false)
      return
    }

    const normalizedUpdate = normalizeDailyUpdate(update)
    setDailyUpdateId(normalizedUpdate.id)
    setDailyUpdateForm({
      problems: normalizeProblemBlocks(normalizedUpdate.problems),
      assessment: normalizedUpdate.assessment,
      plans: normalizedUpdate.plans,
      checklist: normalizeChecklistItems(normalizedUpdate.checklist),
    })
    setDailyDirty(false)
  }, [])

  const applyDailyUpdateToForm = useCallback((update: DailyUpdate) => {
    const normalizedUpdate = normalizeDailyUpdate(update)
    setDailyUpdateForm({
      problems: normalizeProblemBlocks(normalizedUpdate.problems),
      assessment: normalizedUpdate.assessment,
      plans: normalizedUpdate.plans,
      checklist: toPendingChecklistItems(normalizedUpdate.checklist),
    })
    setDailyDirty(true)
  }, [])

  const copyLatestDailyUpdateToForm = useCallback(async () => {
    if (selectedPatientId === null) return

    const updates = await db.dailyUpdates.where('patientId').equals(selectedPatientId).toArray()
    if (updates.length === 0) {
      setNotice('No saved daily entry to copy yet.')
      return
    }

    const latestUpdate = selectLatestDailyUpdate(updates)
    if (!latestUpdate) {
      setNotice('No saved daily entry to copy yet.')
      return
    }

    const sourceUpdate = latestUpdate.date === dailyDate
      ? selectLatestDailyUpdate(updates.filter((entry) => entry.date < dailyDate))
      : latestUpdate

    if (!sourceUpdate) {
      setNotice('No previous daily entry to copy yet.')
      return
    }

    setPendingLatestDailyUpdate(sourceUpdate)
    setCopyLatestConfirmOpen(true)
  }, [dailyDate, selectedPatientId])

  const confirmCopyLatestDailyUpdate = useCallback(() => {
    if (!pendingLatestDailyUpdate) return

    applyDailyUpdateToForm(pendingLatestDailyUpdate)
    setNotice(`Copied latest daily entry (${pendingLatestDailyUpdate.date}).`)
    setCopyLatestConfirmOpen(false)
    setPendingLatestDailyUpdate(null)
  }, [applyDailyUpdateToForm, pendingLatestDailyUpdate])

  const closeCopyLatestConfirm = useCallback(() => {
    setCopyLatestConfirmOpen(false)
    setPendingLatestDailyUpdate(null)
  }, [])

  const requestDeleteDailyUpdate = useCallback(async () => {
    if (selectedPatientId === null) return
    const update = await db.dailyUpdates.where('[patientId+date]').equals([selectedPatientId, dailyDate]).first()
    if (!update) {
      setNotice('No saved daily entry for this date.')
      return
    }

    setPendingDeleteDailyUpdate(update)
    setDeleteDailyConfirmOpen(true)
  }, [dailyDate, selectedPatientId])

  const confirmDeleteDailyUpdate = async () => {
    if (!pendingDeleteDailyUpdate || selectedPatientId === null) return

    await db.dailyUpdates.delete(pendingDeleteDailyUpdate.id)
    await touchPatientLastModified(selectedPatientId)
    setNotice(`Deleted daily entry (${pendingDeleteDailyUpdate.date}).`)
    setDeleteDailyConfirmOpen(false)
    setPendingDeleteDailyUpdate(null)
    await loadDailyUpdate(selectedPatientId, dailyDate)
  }

  const closeDeleteDailyConfirm = useCallback(() => {
    setDeleteDailyConfirmOpen(false)
    setPendingDeleteDailyUpdate(null)
  }, [])

  useEffect(() => {
    if (selectedPatientId === null && copyLatestConfirmOpen) {
      closeCopyLatestConfirm()
    }
    if (selectedPatientId === null && deleteDailyConfirmOpen) {
      closeDeleteDailyConfirm()
    }
  }, [closeCopyLatestConfirm, closeDeleteDailyConfirm, copyLatestConfirmOpen, deleteDailyConfirmOpen, selectedPatientId])

  const saveProfile = useCallback(
    async () => {
      if (selectedPatientId === null) return false

      const age = Number.parseInt(profileForm.age, 10)
      const ageIsValid = Number.isFinite(age)

      setIsSaving(true)

      try {
        const wardTrimmed = profileForm.ward.trim()
        await db.patients.update(selectedPatientId, {
          lastModified: new Date().toISOString(),
          roomNumber: profileForm.roomNumber.trim(),
          ward: wardTrimmed,
          // Resolved once the clerk fills in Ward manually; keep it until then so nothing is lost.
          roomLegacyRaw: wardTrimmed ? undefined : profileForm.roomLegacyRaw,
          firstName: profileForm.firstName.trim(),
          lastName: profileForm.lastName.trim(),
          ...(ageIsValid ? { age } : {}),
          sex: profileForm.sex,
          admitDate: profileForm.admitDate,
          referralDate: profileForm.referralDate,
          dischargeDate: profileForm.dischargeDate || undefined,
          diagnosis: profileForm.diagnosis,
          clinicalSummary: profileForm.clinicalSummary,
          database: profileForm.database,
          plans: profileForm.plans,
          medications: profileForm.medications,
          labs: profileForm.labs,
          pendings: profileForm.pendings,
        })

        setLastSavedAt(new Date().toISOString())
        setProfileDirty(false)
        if (!ageIsValid) {
          setNotice('Age not saved until valid.')
        }
        return true
      } catch {
        setNotice('Unable to save. Please try again.')
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [profileForm, selectedPatientId],
  )

  const selectPatient = async (patient: Patient, options?: { preserveSelectedTab?: boolean }) => {
    const patientId = patient.id ?? null
    if (patientId === null) return

    if (profileDirty && selectedPatientId !== null && selectedPatientId !== patientId) {
      const saved = await saveProfile()
      if (!saved) {
        setNotice('Fix profile save issue before switching patients.')
        return
      }
    }

    setProfileForm({
      roomNumber: patient.roomNumber,
      ward: patient.ward ?? '',
      roomLegacyRaw: patient.roomLegacyRaw,
      firstName: patient.firstName,
      lastName: patient.lastName,
      age: patient.age.toString(),
      sex: patient.sex,
      admitDate: patient.admitDate,
      referralDate: patient.referralDate ?? patient.admitDate,
      dischargeDate: patient.dischargeDate ?? '',
      diagnosis: patient.diagnosis,
      clinicalSummary: patient.clinicalSummary ?? '',
      database: patient.database ?? '',
      plans: patient.plans,
      medications: patient.medications,
      labs: patient.labs,
      pendings: patient.pendings,
    })
    setLastSavedAt(null)
    setProfileDirty(false)
    void loadDailyUpdate(patientId, dailyDate)
    setView('patient')
    setSelectedPatientId(patient.id ?? null)
    setMedicationForm(initialMedicationForm())
    setEditingMedicationId(null)
    setVitalForm(initialVitalForm())
    setEditingVitalId(null)
    setVitalDraftId(null)
    setVitalDirty(false)
    setOrderForm(initialOrderForm())
    setEditingOrderId(null)
    setOrderDraftId(null)
    setOrderDirty(false)
    setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
    setLabTemplateDate('')
    setLabTemplateTime('')
    setLabTemplateValues({})
    setLabTemplateNote('')
    setEditingLabId(null)
    setAttachmentCategory('profile')
    setAttachmentFilter('all')
    setAttachmentTitle(buildDefaultPhotoTitle('profile'))
    setIsAttachmentTitleDefault(true)
    setSelectedAttachmentId(null)
    if (!options?.preserveSelectedTab) {
      setSelectedTab('profile')
    }
  }

  // Swipe left/right anywhere on the mobile patient view to move through active patients
  // (same room-number order as the quick-switch picker), staying on the same tab. The card
  // tracks the finger 1:1 (translateX) so the gesture is unmistakable before it's even
  // completed, and a name badge with a directional arrow pops in once you cross the
  // deadzone. A confirmed swipe finishes sliding the old card off, then the new patient's
  // card snaps to the opposite edge and slides in to rest. Ignored when the gesture starts
  // on a drag handle, a form control, or an explicitly opted-out horizontally-scrollable
  // area (see data-no-swipe). Only locks into a horizontal drag (and blocks page scroll)
  // once movement is clearly more horizontal than vertical, so ordinary scrolling is
  // untouched.
  //
  // The live-follow phase deliberately never touches React state: this is one large,
  // unmemoized component, so a setState on every touchmove would re-render the entire
  // active tab's tree (tables, forms, everything) once per frame. Instead the card's own
  // ref is mutated directly, batched to one rAF per frame. React only takes over — via
  // patientSwipeOffsetX/patientSwipeTransitionOn — for the release animation (spring-back
  // or exit+entry), which is a handful of updates per gesture rather than dozens per second.
  const patientSwipeStartRef = useRef<{ x: number; y: number; locked: boolean } | null>(null)
  const patientSwipeCardRef = useRef<HTMLDivElement | null>(null)
  const patientSwipeExitTimeoutRef = useRef<number | null>(null)
  const patientSwipeRafRef = useRef<number | null>(null)
  const patientSwipePendingDeltaXRef = useRef(0)
  const patientSwipeLastDirectionRef = useRef<'next' | 'prev' | null>(null)
  const [patientSwipeOffsetX, setPatientSwipeOffsetX] = useState(0)
  const [patientSwipeTransitionOn, setPatientSwipeTransitionOn] = useState(false)
  const [patientSwipeReleaseActive, setPatientSwipeReleaseActive] = useState(false)
  const [patientSwipeDirection, setPatientSwipeDirection] = useState<'next' | 'prev' | null>(null)
  const [patientSwipePreviewPatient, setPatientSwipePreviewPatient] = useState<Patient | undefined>(undefined)

  const PATIENT_SWIPE_LOCK_DEADZONE_PX = 10
  const PATIENT_SWIPE_MIN_DISTANCE_PX = 80
  const PATIENT_SWIPE_EXIT_DISTANCE_PX = 500
  const PATIENT_SWIPE_ENTRY_DISTANCE_PX = 56
  const PATIENT_SWIPE_EXIT_DURATION_MS = 180

  const getAdjacentPatient = (direction: 'next' | 'prev'): Patient | undefined => {
    if (!selectedPatient) return undefined
    const orderedIds = quickSwitchPatients.map((patient) => patient.id).filter((id): id is number => id !== undefined)
    const currentIndex = orderedIds.indexOf(selectedPatient.id ?? -1)
    if (currentIndex === -1) return undefined
    const targetId = orderedIds[direction === 'next' ? currentIndex + 1 : currentIndex - 1]
    return quickSwitchPatients.find((patient) => patient.id === targetId)
  }

  const patientSwipeOpacityForOffset = (offsetX: number) => 1 - Math.min(Math.abs(offsetX) / 250, 0.85)

  // Applied only while patientSwipeReleaseActive is false, i.e. React's own `style` prop on
  // the card is left unset — so this direct mutation can't be clobbered by an unrelated
  // re-render elsewhere in the app while a drag is in progress.
  const applyPatientSwipeCardTransform = (offsetX: number) => {
    const node = patientSwipeCardRef.current
    if (!node) return
    node.style.transform = `translateX(${offsetX}px)`
    node.style.opacity = String(patientSwipeOpacityForOffset(offsetX))
  }

  const resetPatientSwipe = () => {
    patientSwipeStartRef.current = null
    patientSwipeLastDirectionRef.current = null
    if (patientSwipeRafRef.current !== null) {
      cancelAnimationFrame(patientSwipeRafRef.current)
      patientSwipeRafRef.current = null
    }
    setPatientSwipeDirection(null)
    setPatientSwipePreviewPatient(undefined)
    setPatientSwipeReleaseActive(false)
    setPatientSwipeTransitionOn(false)
    setPatientSwipeOffsetX(0)
    applyPatientSwipeCardTransform(0)
  }

  const handlePatientSwipeTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('[draggable="true"], input, textarea, select, [data-no-swipe]')) {
      patientSwipeStartRef.current = null
      return
    }
    if (patientSwipeExitTimeoutRef.current !== null) {
      window.clearTimeout(patientSwipeExitTimeoutRef.current)
      patientSwipeExitTimeoutRef.current = null
    }
    const touch = event.touches[0]
    if (!touch) return
    resetPatientSwipe()
    patientSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, locked: false }
  }

  const handlePatientSwipeTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = patientSwipeStartRef.current
    if (!start) return
    const touch = event.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (!start.locked) {
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > PATIENT_SWIPE_LOCK_DEADZONE_PX) {
        patientSwipeStartRef.current = null
        return
      }
      if (Math.abs(deltaX) < PATIENT_SWIPE_LOCK_DEADZONE_PX) return
      start.locked = true
    }

    event.preventDefault()
    patientSwipePendingDeltaXRef.current = deltaX
    if (patientSwipeRafRef.current !== null) return
    patientSwipeRafRef.current = requestAnimationFrame(() => {
      patientSwipeRafRef.current = null
      const offsetX = patientSwipePendingDeltaXRef.current
      applyPatientSwipeCardTransform(offsetX)

      const direction: 'next' | 'prev' | null =
        offsetX < -PATIENT_SWIPE_LOCK_DEADZONE_PX ? 'next'
          : offsetX > PATIENT_SWIPE_LOCK_DEADZONE_PX ? 'prev'
            : null
      if (direction !== patientSwipeLastDirectionRef.current) {
        patientSwipeLastDirectionRef.current = direction
        setPatientSwipeDirection(direction)
        setPatientSwipePreviewPatient(direction ? getAdjacentPatient(direction) : undefined)
      }
    })
  }

  const handlePatientSwipeTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = patientSwipeStartRef.current
    patientSwipeStartRef.current = null
    if (patientSwipeRafRef.current !== null) {
      cancelAnimationFrame(patientSwipeRafRef.current)
      patientSwipeRafRef.current = null
    }
    if (!start?.locked) {
      resetPatientSwipe()
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch ? touch.clientX - start.x : patientSwipePendingDeltaXRef.current
    const direction: 'next' | 'prev' = deltaX < 0 ? 'next' : 'prev'
    const targetPatient = Math.abs(deltaX) >= PATIENT_SWIPE_MIN_DISTANCE_PX ? getAdjacentPatient(direction) : undefined

    setPatientSwipePreviewPatient(undefined)
    // Hand off from the imperative ref-driven transform to React-state-driven `style` at the
    // exact live position, so switching modes here can't cause a visual jump.
    setPatientSwipeReleaseActive(true)
    setPatientSwipeTransitionOn(false)
    setPatientSwipeOffsetX(deltaX)

    if (!targetPatient) {
      requestAnimationFrame(() => {
        setPatientSwipeTransitionOn(true)
        setPatientSwipeOffsetX(0)
      })
      return
    }

    const exitOffset = direction === 'next' ? -PATIENT_SWIPE_EXIT_DISTANCE_PX : PATIENT_SWIPE_EXIT_DISTANCE_PX
    requestAnimationFrame(() => {
      setPatientSwipeTransitionOn(true)
      setPatientSwipeOffsetX(exitOffset)
    })
    patientSwipeExitTimeoutRef.current = window.setTimeout(() => {
      void selectPatient(targetPatient, { preserveSelectedTab: true })
      setPatientSwipeTransitionOn(false)
      setPatientSwipeOffsetX(direction === 'next' ? PATIENT_SWIPE_ENTRY_DISTANCE_PX : -PATIENT_SWIPE_ENTRY_DISTANCE_PX)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPatientSwipeTransitionOn(true)
          setPatientSwipeOffsetX(0)
        })
      })
    }, PATIENT_SWIPE_EXIT_DURATION_MS)
  }


  const toggleDischarge = async (patient: Patient) => {
    if (patient.id === undefined) return
    const active = isPatientActive(patient, tagsById)
    if (active) {
      if (!dischargedTag) return
      await applyTagToPatient(patient, dischargedTag)
    } else {
      await clearTerminalTagsFromPatient(patient, tagsById)
    }
  }

  useEffect(() => {
    if (selectedPatientId === null || !profileDirty || isSaving) return

    // Fields feeding this flag already debounce their own typing pause (TapToEditField);
    // this just coalesces same-tick multi-field commits before writing to IndexedDB.
    const timeoutId = window.setTimeout(() => {
      void saveProfile()
    }, AUTOSAVE_FLUSH_MS)

    return () => window.clearTimeout(timeoutId)
  }, [isSaving, profileDirty, saveProfile, selectedPatientId])

  const updateProfileField = useCallback(<K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => {
    setProfileForm((previous) => ({ ...previous, [field]: value }))
    setProfileDirty(true)
  }, [])

  const updateVitalField = useCallback(<K extends keyof VitalFormState>(field: K, value: VitalFormState[K]) => {
    setVitalForm((previous) => ({ ...previous, [field]: value }))
    setVitalDirty(true)
  }, [])

  const updateOrderField = useCallback(<K extends keyof OrderFormState>(field: K, value: OrderFormState[K]) => {
    setOrderForm((previous) => ({ ...previous, [field]: value }))
    setOrderDirty(true)
  }, [])

  const updateMasterChecklist = useCallback(async (
    patientId: number,
    updater: (checklist: DailyChecklistItem[]) => DailyChecklistItem[],
  ) => {
    const existingEntry = await db.dailyUpdates.where('[patientId+date]').equals([patientId, masterChecklistDate]).first()
    const entryForDate = existingEntry ?? (() => {
      const updates = (dailyUpdatesByPatient.get(patientId) ?? []).filter((entry) => entry.date < masterChecklistDate)
      const latestPriorUpdate = selectLatestDailyUpdate(updates)
      return {
        patientId,
        date: masterChecklistDate,
        ...initialDailyUpdateForm,
        checklist: toPendingChecklistItems(latestPriorUpdate?.checklist),
        lastUpdated: new Date().toISOString(),
      } satisfies Omit<DailyUpdate, 'id'>
    })()

    // Keeps blank-text items rather than dropping them: unlike the per-patient tab, this view
    // has no local draft layer, so a split's blank "after" item would otherwise be stripped
    // before it could ever be rendered or typed into. Deliberate edits to empty text remove the
    // item explicitly instead (see updateMasterChecklistItemText / the row's blur handler).
    const currentChecklist = normalizeChecklistItemsKeepingBlanks(entryForDate.checklist)
    const nextChecklist = normalizeChecklistItemsKeepingBlanks(updater(currentChecklist))

    const savedId = await db.dailyUpdates.put({
      ...entryForDate,
      id: existingEntry?.id,
      checklist: nextChecklist,
      lastUpdated: new Date().toISOString(),
    })
    await touchPatientLastModified(patientId)

    return typeof savedId === 'number' ? savedId : existingEntry?.id
  }, [dailyUpdatesByPatient, masterChecklistDate, touchPatientLastModified])

  // Pressing Enter mid-item splits it at the cursor into two items in place (issue #78) — kept
  // separate from insertNewChecklistItem's default-position logic, which other entry points
  // (Master Checklist quick-add, Custom Actions) still use unchanged.
  const splitDailyChecklistItem = useCallback((index: number, fieldValue: string, caretOffset: number) => {
    setDailyUpdateForm((previous) => {
      const result = splitChecklistItemAtCursor(previous.checklist, index, fieldValue, caretOffset)
      if (result.focusIndex !== null) {
        setPendingDailyChecklistFocus({ index: result.focusIndex, caretOffset: 0 })
      }
      return { ...previous, checklist: result.items }
    })
    setDailyDirty(true)
  }, [])

  // Backspacing at the start of an item (empty or not) merges it into the previous one — undoes
  // an accidental split (issue #78). Takes the item's live field value rather than reading its
  // (possibly stale, still-debounced) committed text — see mergeChecklistItemIntoPrevious's doc.
  const mergeDailyChecklistItemWithPrevious = useCallback((index: number, fieldValue: string) => {
    setDailyUpdateForm((previous) => {
      const result = mergeChecklistItemIntoPrevious(previous.checklist, index, fieldValue)
      if (!result) return previous
      setPendingDailyChecklistFocus({ index: result.focusIndex, caretOffset: result.caretOffset })
      return { ...previous, checklist: result.items }
    })
    setDailyDirty(true)
  }, [])

  // Enter inside an item's notes always adds a new item below it, unsplit — see
  // insertBlankChecklistItemAfter's doc comment.
  const insertBlankDailyChecklistItemAfter = useCallback((index: number) => {
    setDailyUpdateForm((previous) => {
      const result = insertBlankChecklistItemAfter(previous.checklist, index)
      if (!result) return previous
      setPendingDailyChecklistFocus({ index: result.focusIndex, caretOffset: 0 })
      return { ...previous, checklist: result.items }
    })
    setDailyDirty(true)
  }, [])

  const updateDailyChecklistItemNotes = useCallback((index: number, notes: string) => {
    const nextNotes = notes.trim()

    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: previous.checklist.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...(nextNotes ? { notes: nextNotes } : { notes: undefined }) } : item
      )),
    }))
    setDailyDirty(true)
  }, [])

  const updateDailyChecklistItemCompletion = useCallback((index: number, completed: boolean) => {
    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: setChecklistItemCompletion(previous.checklist, index, completed),
    }))
    setDailyDirty(true)
  }, [])

  const removeDailyChecklistItem = useCallback((index: number) => {
    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: previous.checklist.filter((_, itemIndex) => itemIndex !== index),
    }))
    setDailyDirty(true)
  }, [])

  const updateDailyChecklistItemText = useCallback((index: number, text: string) => {
    const nextText = text.trim()

    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: previous.checklist.map((item, itemIndex) => (
        itemIndex === index ? { ...item, text: nextText } : item
      )),
    }))
    setDailyDirty(true)
  }, [])

  const reorderDailyChecklistItem = useCallback((sourceIndex: number, targetIndex: number) => {
    setDailyUpdateForm((previous) => {
      return {
        ...previous,
        checklist: reorderChecklistItems(previous.checklist, sourceIndex, targetIndex),
      }
    })
    setDailyDirty(true)
  }, [])

  const startDailyChecklistDrag = useCallback((event: DragEvent<HTMLButtonElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    setDraggingDailyChecklistItemIndex(index)
  }, [])

  const resetDailyChecklistDragState = useCallback(() => {
    setDraggingDailyChecklistItemIndex(null)
    setTouchDailyChecklistTargetIndex(null)
  }, [])

  const endDailyChecklistDrag = useCallback(() => {
    resetDailyChecklistDragState()
  }, [resetDailyChecklistDragState])

  const startDailyChecklistTouchDrag = useCallback((event: TouchEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    setDraggingDailyChecklistItemIndex(index)
    setTouchDailyChecklistTargetIndex(index)
  }, [])

  const updateDailyChecklistTouchTarget = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    if (draggingDailyChecklistItemIndex === null) return

    const touchPoint = event.touches[0]
    if (!touchPoint) return

    const targetElement = document.elementFromPoint(touchPoint.clientX, touchPoint.clientY)
    const checklistItemContainer = targetElement?.closest('[data-daily-checklist-index]')
    if (!(checklistItemContainer instanceof HTMLElement)) {
      setTouchDailyChecklistTargetIndex(null)
      return
    }

    const parsedTargetIndex = Number.parseInt(checklistItemContainer.dataset.dailyChecklistIndex ?? '', 10)
    if (!Number.isInteger(parsedTargetIndex)) {
      setTouchDailyChecklistTargetIndex(null)
      return
    }

    const sourceItem = dailyUpdateForm.checklist[draggingDailyChecklistItemIndex]
    const targetItem = dailyUpdateForm.checklist[parsedTargetIndex]
    if (!sourceItem || !targetItem) {
      setTouchDailyChecklistTargetIndex(null)
      return
    }

    event.preventDefault()
    setTouchDailyChecklistTargetIndex(parsedTargetIndex)
  }, [dailyUpdateForm.checklist, draggingDailyChecklistItemIndex])

  const endDailyChecklistTouchDrag = useCallback(() => {
    if (
      draggingDailyChecklistItemIndex !== null
      && touchDailyChecklistTargetIndex !== null
      && draggingDailyChecklistItemIndex !== touchDailyChecklistTargetIndex
    ) {
      reorderDailyChecklistItem(draggingDailyChecklistItemIndex, touchDailyChecklistTargetIndex)
    }

    resetDailyChecklistDragState()
  }, [draggingDailyChecklistItemIndex, reorderDailyChecklistItem, resetDailyChecklistDragState, touchDailyChecklistTargetIndex])

  const cancelDailyChecklistTouchDrag = useCallback(() => {
    resetDailyChecklistDragState()
  }, [resetDailyChecklistDragState])

  const allowDailyChecklistDrop = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    if (draggingDailyChecklistItemIndex === null || draggingDailyChecklistItemIndex === targetIndex) return

    const sourceItem = dailyUpdateForm.checklist[draggingDailyChecklistItemIndex]
    const targetItem = dailyUpdateForm.checklist[targetIndex]
    if (!sourceItem || !targetItem) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [dailyUpdateForm.checklist, draggingDailyChecklistItemIndex])

  const dropDailyChecklistItem = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault()
    if (draggingDailyChecklistItemIndex === null || draggingDailyChecklistItemIndex === targetIndex) {
      resetDailyChecklistDragState()
      return
    }

    reorderDailyChecklistItem(draggingDailyChecklistItemIndex, targetIndex)
    resetDailyChecklistDragState()
  }, [draggingDailyChecklistItemIndex, reorderDailyChecklistItem, resetDailyChecklistDragState])

  const moveDailyChecklistItemByDirection = useCallback((index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= dailyUpdateForm.checklist.length) return
    reorderDailyChecklistItem(index, targetIndex)
  }, [dailyUpdateForm.checklist, reorderDailyChecklistItem])

  // The blank draft line at the end of the list (see withTrailingBlankChecklistItem) commits
  // by appending — never sorted/inserted at a default position, since it's typed exactly where
  // it visually sits.
  const appendDailyChecklistItemAtEnd = useCallback((text: string) => {
    const nextText = text.trim()
    if (!nextText) return

    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: [...previous.checklist, { text: nextText, completed: false }],
    }))
    setDailyDirty(true)
  }, [])

  const renderDailyChecklistItem = useCallback((item: DailyChecklistItem, index: number, isDraftRow: boolean) => (
    <div
      key={`checklist-${index}`}
      data-daily-checklist-index={index}
      className={`flex flex-col gap-0.5 rounded-md px-2 py-1.5 ${item.completed ? 'border border-clay/20 bg-warm-ivory/70' : 'border border-clay/30 bg-warm-ivory'} ${draggingDailyChecklistItemIndex === index ? 'opacity-60' : ''} ${touchDailyChecklistTargetIndex === index && draggingDailyChecklistItemIndex !== null ? 'ring-2 ring-action-primary/40 ring-offset-1 ring-offset-transparent' : ''}`}
      onDragOver={(event) => allowDailyChecklistDrop(event, index)}
      onDrop={(event) => dropDailyChecklistItem(event, index)}
      // Deferred to a macrotask: firing this synchronously (as focus/blur normally do) can land
      // this row's re-render right between a DIFFERENT item's checkbox native click-toggle and its
      // change event, causing React to reset that checkbox back to its stale value — the click
      // gesture's mousedown/blur/focus/mouseup/click/change are all dispatched synchronously by the
      // browser, so pushing the state update past them with setTimeout(0) keeps it out of that
      // window entirely (issue #122).
      onFocus={() => {
        window.setTimeout(() => setActiveDailyChecklistIndex(index), 0)
      }}
      onBlur={(event) => {
        const nextFocusTarget = event.relatedTarget
        if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) return
        window.setTimeout(() => {
          setActiveDailyChecklistIndex((current) => (current === index ? null : current))
        }, 0)
      }}
    >
      <div className='flex items-start gap-2'>
        <input
          type='checkbox'
          className='mt-1 h-4 w-4 accent-action-primary disabled:opacity-40'
          checked={item.completed}
          disabled={isDraftRow}
          onChange={(event) => updateDailyChecklistItemCompletion(index, event.target.checked)}
          // Stops the row's onFocus (which reveals its notes field) from firing when the
          // checkbox itself is what's being focused — letting that focus-triggered re-render
          // land between the browser's native toggle and React's own change detection was
          // silently swallowing the very click that focused it, needing a second click to
          // actually register (issue #122).
          onFocus={(event) => event.stopPropagation()}
          aria-label={item.completed ? 'Mark checklist item pending' : 'Mark checklist item complete'}
        />
        <div className='min-w-0 flex-1'>
          <TapToEditField
            className='px-1.5 py-0.5 text-sm'
            ariaLabel='Checklist item text'
            emptyText={isDraftRow ? 'Add checklist item' : 'Tap to edit'}
            value={item.text}
            onCommit={(nextText) => (isDraftRow ? appendDailyChecklistItemAtEnd(nextText) : updateDailyChecklistItemText(index, nextText))}
            onEditorKeyDown={(event, { fieldValue, caretOffset, forceExit }) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                forceExit()
                splitDailyChecklistItem(index, fieldValue, caretOffset)
              } else if (event.key === 'Backspace' && !isDraftRow && index > 0 && caretOffset === 0) {
                event.preventDefault()
                forceExit()
                mergeDailyChecklistItemWithPrevious(index, fieldValue)
              }
            }}
            autoEnter={pendingDailyChecklistFocus?.index === index ? { caretOffset: pendingDailyChecklistFocus.caretOffset } : null}
            onAutoEnterHandled={() => setPendingDailyChecklistFocus(null)}
            renderView={(text) => (
              <span className={item.completed ? 'text-clay line-through' : 'text-espresso'}>{text}</span>
            )}
            renderEditor={({ value, onChange }) => (
              <AutoGrowTextField
                aria-label='Checklist item text'
                value={value}
                onChange={onChange}
              />
            )}
          />
          {!isDraftRow && ((item.notes ?? '').trim().length > 0 || activeDailyChecklistIndex === index) ? (
            <TapToEditField
              className='px-1.5 py-0 text-xs text-clay/80'
              ariaLabel='Checklist item notes'
              emptyText='Add note'
              value={item.notes ?? ''}
              onCommit={(nextNotes) => updateDailyChecklistItemNotes(index, nextNotes)}
              onEditorKeyDown={(event, { fieldValue, forceExit }) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                updateDailyChecklistItemNotes(index, fieldValue)
                forceExit()
                insertBlankDailyChecklistItemAfter(index)
              }}
              renderView={(text) => <span>{text}</span>}
              renderEditor={({ value, onChange }) => (
                <AutoGrowTextField
                  aria-label='Checklist item notes'
                  value={value}
                  onChange={onChange}
                />
              )}
            />
          ) : null}
        </div>
        {!isDraftRow ? (
          <Button
            type='button'
            variant='ghost'
            className='h-6 w-6 shrink-0 p-0 text-clay cursor-grab active:cursor-grabbing touch-none'
            aria-label='Drag checklist item to reorder'
            draggable
            onDragStart={(event) => startDailyChecklistDrag(event, index)}
            onDragEnd={endDailyChecklistDrag}
            onTouchStart={(event) => startDailyChecklistTouchDrag(event, index)}
            onTouchMove={updateDailyChecklistTouchTarget}
            onTouchEnd={endDailyChecklistTouchDrag}
            onTouchCancel={cancelDailyChecklistTouchDrag}
            onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
              event.preventDefault()
              moveDailyChecklistItemByDirection(index, event.key === 'ArrowUp' ? 'up' : 'down')
            }}
          >
            <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
        ) : null}
        {!isDraftRow ? (
          <Button
            type='button'
            variant='ghost'
            className='h-6 w-6 shrink-0 p-0 text-action-danger'
            aria-label='Remove checklist item'
            onClick={() => requestDeleteConfirmation({
              title: 'Delete checklist item?',
              message: `Remove "${item.text || 'this item'}" from the checklist?`,
              onConfirm: () => removeDailyChecklistItem(index),
            })}
          >
            <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
        ) : null}
      </div>
    </div>
  ), [activeDailyChecklistIndex, allowDailyChecklistDrop, appendDailyChecklistItemAtEnd, cancelDailyChecklistTouchDrag, draggingDailyChecklistItemIndex, dropDailyChecklistItem, endDailyChecklistDrag, endDailyChecklistTouchDrag, insertBlankDailyChecklistItemAfter, mergeDailyChecklistItemWithPrevious, moveDailyChecklistItemByDirection, pendingDailyChecklistFocus, removeDailyChecklistItem, requestDeleteConfirmation, splitDailyChecklistItem, startDailyChecklistDrag, startDailyChecklistTouchDrag, touchDailyChecklistTargetIndex, updateDailyChecklistItemCompletion, updateDailyChecklistItemNotes, updateDailyChecklistItemText, updateDailyChecklistTouchTarget])

  const addMasterChecklistItem = useCallback((patientId: number, text: string) => {
    const nextText = text.trim()
    if (!nextText) return

    void updateMasterChecklist(patientId, (previous) => insertNewChecklistItem(previous, { text: nextText, completed: false }))
  }, [updateMasterChecklist])

  const updateMasterChecklistItemCompletion = useCallback((patientId: number, index: number, completed: boolean) => {
    void updateMasterChecklist(patientId, (previous) => setChecklistItemCompletion(previous, index, completed))
  }, [updateMasterChecklist])

  const removeMasterChecklistItem = useCallback((patientId: number, index: number) => {
    void updateMasterChecklist(patientId, (previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }, [updateMasterChecklist])

  const updateMasterChecklistItemText = useCallback((patientId: number, index: number, text: string) => {
    const nextText = text.trim()

    // Committing an item's text as blank removes it outright — since updateMasterChecklist no
    // longer strips blanks on write (that would also strip a split's not-yet-typed-into new
    // item), a deliberate clear-to-empty has to delete the item explicitly instead.
    void updateMasterChecklist(patientId, (previous) => (
      nextText
        ? previous.map((item, itemIndex) => (itemIndex === index ? { ...item, text: nextText } : item))
        : previous.filter((_, itemIndex) => itemIndex !== index)
    ))
  }, [updateMasterChecklist])

  const updateMasterChecklistItemNotes = useCallback((patientId: number, index: number, notes: string) => {
    const nextNotes = notes.trim()

    void updateMasterChecklist(patientId, (previous) => previous.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...(nextNotes ? { notes: nextNotes } : { notes: undefined }) } : item
    )))
  }, [updateMasterChecklist])

  // Same split-at-cursor / merge-into-previous / notes-Enter behavior as the per-patient tab
  // (issue #78). The focus request is set right away (inside the updater, using the post-edit
  // items it already computed) rather than waiting on updateMasterChecklist's returned promise
  // — that write lands in IndexedDB and the list only re-renders once the live query re-derives
  // masterChecklistItems from it, which isn't guaranteed to have happened by the time the write
  // "completes" from this function's point of view. pendingMasterChecklistFocus's expectedText
  // is what actually makes this race-proof: autoEnter only fires once the target row's real text
  // matches it, so it naturally waits out however many extra renders the live query needs.
  const splitMasterChecklistItem = useCallback((patientId: number, index: number, fieldValue: string, caretOffset: number) => {
    void updateMasterChecklist(patientId, (previous) => {
      const result = splitChecklistItemAtCursor(previous, index, fieldValue, caretOffset)
      if (result.focusIndex !== null) {
        setPendingMasterChecklistFocus({ patientId, index: result.focusIndex, caretOffset: 0, expectedText: result.items[result.focusIndex]?.text ?? '' })
      }
      return result.items
    })
  }, [updateMasterChecklist])

  // Takes the item's live field value rather than reading its (possibly stale, still-debounced)
  // committed text — see mergeChecklistItemIntoPrevious's doc comment.
  const mergeMasterChecklistItemWithPrevious = useCallback((patientId: number, index: number, fieldValue: string) => {
    void updateMasterChecklist(patientId, (previous) => {
      const result = mergeChecklistItemIntoPrevious(previous, index, fieldValue)
      if (!result) return previous
      setPendingMasterChecklistFocus({
        patientId,
        index: result.focusIndex,
        caretOffset: result.caretOffset,
        expectedText: result.items[result.focusIndex]?.text ?? '',
      })
      return result.items
    })
  }, [updateMasterChecklist])

  // Commits the notes text and inserts the new blank item in a single read-modify-write cycle.
  // Calling updateMasterChecklistItemNotes and a separate insert as two independent
  // updateMasterChecklist calls raced each other — both start from IndexedDB independently, so
  // the second one's read could grab the pre-notes-update snapshot and overwrite the first
  // write, silently discarding the just-typed notes.
  const commitMasterChecklistItemNotesAndInsertBlankAfter = useCallback((patientId: number, index: number, notes: string) => {
    const nextNotes = notes.trim()
    void updateMasterChecklist(patientId, (previous) => {
      const withNotes = previous.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...(nextNotes ? { notes: nextNotes } : { notes: undefined }) } : item
      ))
      const result = insertBlankChecklistItemAfter(withNotes, index)
      if (!result) return withNotes
      setPendingMasterChecklistFocus({ patientId, index: result.focusIndex, caretOffset: 0, expectedText: '' })
      return result.items
    })
  }, [updateMasterChecklist])

  // Custom Actions (issue #75) append checklist items to a specific patient+date. When that's the
  // patient/date already open in the Checklist tab, updating local form state (and letting the
  // existing autosave persist it) avoids clobbering any other unsaved edits on the same daily
  // entry; otherwise it writes straight to IndexedDB the same way updateMasterChecklist does.
  // Skips any text already listed on the target date's checklist (exact match, regardless of
  // completed state or notes) so a Custom Action can be re-run any number of times without
  // duplicating items it already added (issue #121) — the once-per-day CustomActionRun gate this
  // used to lean on is gone; text-based dedup is what makes repeat runs safe now.
  const appendCustomActionChecklistItems = useCallback(async (patientId: number, date: string, items: string[]) => {
    if (items.length === 0) return

    if (selectedPatientId === patientId && dailyDate === date) {
      setDailyUpdateForm((previous) => ({
        ...previous,
        checklist: insertMissingChecklistItems(previous.checklist, items),
      }))
      setDailyDirty(true)
      return
    }

    await appendChecklistItemsForPatientDate(patientId, date, items)
    await touchPatientLastModified(patientId)
  }, [dailyDate, selectedPatientId, touchPatientLastModified])

  // Fires every "Automatic on tag added" Custom Action whose trigger tag is in `addedTagIds`,
  // regardless of how the tag(s) got added (single Profile-tab toggle or bulk Add Tag). Runs
  // silently in the background with no per-patient prompt — a patient matching none of an
  // action's conditions is simply left unaffected and named in a notice afterward.
  const runAutomaticCustomActionsForTagAddition = useCallback(async (patientAfterAdd: Patient, addedTagIds: number[]) => {
    if (patientAfterAdd.id === undefined || addedTagIds.length === 0) return
    const addedTagIdSet = new Set(addedTagIds)
    const matchingActions = (customActions ?? []).filter(
      (action) => action.triggerType === 'automatic' && action.triggerTagId !== undefined && addedTagIdSet.has(action.triggerTagId),
    )
    if (matchingActions.length === 0) return

    const today = toLocalISODate()
    const unaffectedMessages: string[] = []
    for (const action of matchingActions) {
      const matched = resolveMatchingConditions(patientAfterAdd, action)
      if (!actionHasApplicableEffect(action, matched)) {
        unaffectedMessages.push(`"${action.name}" did not affect ${formatPatientLabelForNotice(patientAfterAdd)} — no condition was met.`)
        continue
      }
      await applyCustomActionEffects(
        patientAfterAdd,
        action,
        matched,
        tagsById,
        (items) => appendCustomActionChecklistItems(patientAfterAdd.id as number, today, items),
      )
    }
    if (unaffectedMessages.length > 0) setNotice(unaffectedMessages.join(' '))
  }, [appendCustomActionChecklistItems, customActions, tagsById])

  // Manual trigger button on a single patient's Checklist tab. If at least one condition matches,
  // every matched condition's checklist items and tag effects run. No once-per-day limit (issue
  // #121) — safe to re-run any number of times, since tag effects are already idempotent and
  // checklist items skip any text already listed (see appendCustomActionChecklistItems). If zero
  // conditions match, nothing runs yet — instead this opens the interactive resolve dialog so the
  // user can skip this patient or add the missing tag(s) for a specific condition on the spot.
  const triggerCustomActionForSelectedPatient = useCallback(async (action: CustomAction) => {
    if (!selectedPatient || selectedPatient.id === undefined || action.id === undefined) return
    const patientId = selectedPatient.id

    const matched = resolveMatchingConditions(selectedPatient, action)
    if (!actionHasApplicableEffect(action, matched)) {
      setCustomActionResolveState({ action, patient: selectedPatient })
      return
    }

    await applyCustomActionEffects(selectedPatient, action, matched, tagsById, (items) => appendCustomActionChecklistItems(patientId, dailyDate, items))
    setNotice(`Ran "${action.name}".`)
  }, [appendCustomActionChecklistItems, dailyDate, selectedPatient, tagsById])

  // General-scope counterpart (issue #120), fired from the Master Checklist's General section.
  // No patient/tags involved, so there's no "didn't match" resolve dialog to fall back to — a
  // day-of-week/month condition that doesn't match today simply isn't offered by the button being
  // disabled-free (it always runs whatever currently applies), and an action with nothing
  // applicable today just reports that in a notice instead.
  const triggerGeneralCustomAction = useCallback(async (action: CustomAction) => {
    if (action.id === undefined) return

    const matched = resolveMatchingGeneralConditions(action)
    if (!actionHasApplicableGeneralEffect(action, matched)) {
      setNotice(`"${action.name}" has nothing to add today.`)
      return
    }

    await applyGeneralCustomActionEffects(action, matched, (items) => appendCustomActionChecklistItems(GENERAL_CHECKLIST_PATIENT_ID, masterChecklistDate, items))
    setNotice(`Ran "${action.name}".`)
  }, [appendCustomActionChecklistItems, masterChecklistDate])

  // Resolves the "zero conditions matched" dialog opened above: skip does nothing (the button
  // stays enabled so the patient can be retried later), while picking a condition adds just its
  // missing tags, then re-resolves and runs every condition that now matches (which may be more
  // than just the one the user picked, if the added tag(s) also satisfy another).
  const resolveCustomActionByAddingTags = useCallback(async (condition: CustomActionCondition) => {
    const state = customActionResolveState
    if (!state || state.patient.id === undefined || state.action.id === undefined) return
    const patientId = state.patient.id

    const missingTagIds = getMissingTagsForCondition(state.patient, condition)
    if (missingTagIds.length > 0) await addTagsToPatientDirectly(state.patient, missingTagIds, tagsById)

    const patientAfterAdd: Patient = { ...state.patient, tagIds: [...new Set([...(state.patient.tagIds ?? []), ...missingTagIds])] }
    const matched = resolveMatchingConditions(patientAfterAdd, state.action)
    if (actionHasApplicableEffect(state.action, matched)) {
      await applyCustomActionEffects(patientAfterAdd, state.action, matched, tagsById, (items) => appendCustomActionChecklistItems(patientId, dailyDate, items))
      setNotice(`Ran "${state.action.name}".`)
    }
    setCustomActionResolveState(null)
  }, [appendCustomActionChecklistItems, customActionResolveState, dailyDate, tagsById])

  const moveMasterChecklistItem = useCallback((patientId: number, index: number, direction: 'up' | 'down') => {
    void updateMasterChecklist(patientId, (previous) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= previous.length) return previous
      return reorderChecklistItems(previous, index, targetIndex)
    })
  }, [updateMasterChecklist])

  const reorderMasterChecklistItem = useCallback((patientId: number, sourceIndex: number, targetIndex: number) => {
    void updateMasterChecklist(patientId, (previous) => reorderChecklistItems(previous, sourceIndex, targetIndex))
  }, [updateMasterChecklist])

  const resetMasterChecklistDragState = useCallback(() => {
    setDraggingMasterChecklistItem(null)
    setTouchMasterChecklistTarget(null)
  }, [])

  const startMasterChecklistDrag = useCallback((event: DragEvent<HTMLButtonElement>, patientId: number, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    setDraggingMasterChecklistItem({ patientId, index })
  }, [])

  const endMasterChecklistDrag = useCallback(() => {
    resetMasterChecklistDragState()
  }, [resetMasterChecklistDragState])

  const startMasterChecklistTouchDrag = useCallback((event: TouchEvent<HTMLButtonElement>, patientId: number, index: number) => {
    event.preventDefault()
    setDraggingMasterChecklistItem({ patientId, index })
    setTouchMasterChecklistTarget({ patientId, index })
  }, [])

  const updateMasterChecklistTouchTarget = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    if (!draggingMasterChecklistItem) return

    const touchPoint = event.touches[0]
    if (!touchPoint) return

    const targetElement = document.elementFromPoint(touchPoint.clientX, touchPoint.clientY)
    const checklistItemContainer = targetElement?.closest('[data-master-checklist-patient-id][data-master-checklist-index]')
    if (!(checklistItemContainer instanceof HTMLElement)) {
      setTouchMasterChecklistTarget(null)
      return
    }

    const parsedPatientId = Number.parseInt(checklistItemContainer.dataset.masterChecklistPatientId ?? '', 10)
    const parsedTargetIndex = Number.parseInt(checklistItemContainer.dataset.masterChecklistIndex ?? '', 10)
    if (!Number.isInteger(parsedPatientId) || !Number.isInteger(parsedTargetIndex)) {
      setTouchMasterChecklistTarget(null)
      return
    }

    const sourceItem = masterChecklistItems.find((item) => (
      item.patientId === draggingMasterChecklistItem.patientId && item.index === draggingMasterChecklistItem.index
    ))
    const targetItem = masterChecklistItems.find((item) => item.patientId === parsedPatientId && item.index === parsedTargetIndex)
    if (!sourceItem || !targetItem || sourceItem.patientId !== targetItem.patientId) {
      setTouchMasterChecklistTarget(null)
      return
    }

    event.preventDefault()
    setTouchMasterChecklistTarget({ patientId: parsedPatientId, index: parsedTargetIndex })
  }, [draggingMasterChecklistItem, masterChecklistItems])

  const endMasterChecklistTouchDrag = useCallback(() => {
    if (
      draggingMasterChecklistItem
      && touchMasterChecklistTarget
      && (
        draggingMasterChecklistItem.patientId !== touchMasterChecklistTarget.patientId
        || draggingMasterChecklistItem.index !== touchMasterChecklistTarget.index
      )
    ) {
      reorderMasterChecklistItem(
        draggingMasterChecklistItem.patientId,
        draggingMasterChecklistItem.index,
        touchMasterChecklistTarget.index,
      )
    }

    resetMasterChecklistDragState()
  }, [draggingMasterChecklistItem, reorderMasterChecklistItem, resetMasterChecklistDragState, touchMasterChecklistTarget])

  const cancelMasterChecklistTouchDrag = useCallback(() => {
    resetMasterChecklistDragState()
  }, [resetMasterChecklistDragState])

  const allowMasterChecklistDrop = useCallback((event: DragEvent<HTMLDivElement>, patientId: number, targetIndex: number) => {
    if (
      !draggingMasterChecklistItem
      || draggingMasterChecklistItem.patientId !== patientId
      || draggingMasterChecklistItem.index === targetIndex
    ) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [draggingMasterChecklistItem])

  const dropMasterChecklistItem = useCallback((event: DragEvent<HTMLDivElement>, patientId: number, targetIndex: number) => {
    event.preventDefault()
    if (
      !draggingMasterChecklistItem
      || draggingMasterChecklistItem.patientId !== patientId
      || draggingMasterChecklistItem.index === targetIndex
    ) {
      resetMasterChecklistDragState()
      return
    }

    reorderMasterChecklistItem(patientId, draggingMasterChecklistItem.index, targetIndex)
    resetMasterChecklistDragState()
  }, [draggingMasterChecklistItem, reorderMasterChecklistItem, resetMasterChecklistDragState])

  const renderMasterChecklistItem = useCallback((item: MasterChecklistItem, key: string) => (
    <div
      key={key}
      data-master-checklist-patient-id={item.patientId}
      data-master-checklist-index={item.index}
      className={`space-y-1 rounded-md px-2 py-1.5 ${item.completed ? 'border border-clay/20 bg-warm-ivory/70' : 'border border-clay/30 bg-warm-ivory'} ${draggingMasterChecklistItem?.patientId === item.patientId && draggingMasterChecklistItem.index === item.index ? 'opacity-60' : ''} ${touchMasterChecklistTarget?.patientId === item.patientId && touchMasterChecklistTarget.index === item.index && draggingMasterChecklistItem !== null ? 'ring-2 ring-action-primary/40 ring-offset-1 ring-offset-transparent' : ''}`}
      onDragOver={(event) => allowMasterChecklistDrop(event, item.patientId, item.index)}
      onDrop={(event) => dropMasterChecklistItem(event, item.patientId, item.index)}
      // Deferred to a macrotask: see the matching comment on the per-patient row (issue #122) —
      // firing this synchronously can re-render mid-click and cause a DIFFERENT item's checkbox
      // to have its native toggle reverted by React before its change event lands.
      onFocus={() => {
        window.setTimeout(() => setActiveMasterChecklistRow({ patientId: item.patientId, index: item.index }), 0)
      }}
      onBlur={(event) => {
        const nextFocusTarget = event.relatedTarget
        if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) return
        // Safety net for a split/inserted blank item that's never actually typed into: the text
        // field's own commit is skipped in that case (its draft never changed from the initial
        // empty value), so nothing else would otherwise clean it up. Reads the text field's live
        // DOM value rather than `item.text` — if a real edit just committed on this same blur,
        // React hasn't re-rendered yet, so `item.text` here could still be the stale pre-commit
        // snapshot, which would otherwise risk deleting an item the user just typed into. Read
        // synchronously (before the deferred setTimeout below) since `event.currentTarget` is only
        // guaranteed valid while this handler is running.
        const liveTextField = event.currentTarget.querySelector('textarea[aria-label="Checklist item text"]')
        const liveText = liveTextField instanceof HTMLTextAreaElement ? liveTextField.value : item.text
        window.setTimeout(() => {
          setActiveMasterChecklistRow((current) => (
            current?.patientId === item.patientId && current.index === item.index ? null : current
          ))
          if (liveText.trim().length === 0) {
            removeMasterChecklistItem(item.patientId, item.index)
          }
        }, 0)
      }}
    >
      <div className='flex items-start gap-2'>
        <input
          type='checkbox'
          className='self-center h-4 w-4 accent-action-primary'
          checked={item.completed}
          onChange={(event) => updateMasterChecklistItemCompletion(item.patientId, item.index, event.target.checked)}
          // See the matching comment on the per-patient checkbox (issue #122) — stops the row's
          // onFocus (notes reveal) from firing off the checkbox's own focus and racing its click.
          onFocus={(event) => event.stopPropagation()}
          aria-label={item.completed ? 'Mark checklist item pending' : 'Mark checklist item complete'}
        />
        <div className='min-w-0 flex-1'>
          <TapToEditField
            className='px-1.5 py-0.5 text-sm'
            ariaLabel='Checklist item text'
            emptyText='Tap to edit'
            value={item.text}
            onCommit={(nextText) => updateMasterChecklistItemText(item.patientId, item.index, nextText)}
            onEditorKeyDown={(event, { fieldValue, caretOffset, forceExit }) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                forceExit()
                splitMasterChecklistItem(item.patientId, item.index, fieldValue, caretOffset)
              } else if (event.key === 'Backspace' && item.index > 0 && caretOffset === 0) {
                event.preventDefault()
                forceExit()
                mergeMasterChecklistItemWithPrevious(item.patientId, item.index, fieldValue)
              }
            }}
            autoEnter={
              pendingMasterChecklistFocus?.patientId === item.patientId
              && pendingMasterChecklistFocus.index === item.index
              && pendingMasterChecklistFocus.expectedText === item.text
                ? { caretOffset: pendingMasterChecklistFocus.caretOffset }
                : null
            }
            onAutoEnterHandled={() => setPendingMasterChecklistFocus(null)}
            renderView={(text) => (
              <span className={item.completed ? 'text-clay line-through' : 'text-espresso'}>{text}</span>
            )}
            renderEditor={({ value, onChange }) => (
              <AutoGrowTextField
                aria-label='Checklist item text'
                value={value}
                onChange={onChange}
              />
            )}
          />
          {item.notes.trim().length > 0 || (activeMasterChecklistRow?.patientId === item.patientId && activeMasterChecklistRow.index === item.index) ? (
            <TapToEditField
              className='px-1.5 py-0 text-xs text-clay/80'
              ariaLabel='Checklist item notes'
              emptyText='Add note'
              value={item.notes}
              onCommit={(nextNotes) => updateMasterChecklistItemNotes(item.patientId, item.index, nextNotes)}
              onEditorKeyDown={(event, { fieldValue, forceExit }) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                forceExit()
                commitMasterChecklistItemNotesAndInsertBlankAfter(item.patientId, item.index, fieldValue)
              }}
              renderView={(text) => <span>{text}</span>}
              renderEditor={({ value, onChange }) => (
                <AutoGrowTextField
                  aria-label='Checklist item notes'
                  value={value}
                  onChange={onChange}
                />
              )}
            />
          ) : null}
        </div>
        <Button
          type='button'
          variant='ghost'
          className='self-center h-6 w-6 shrink-0 p-0 text-clay cursor-grab active:cursor-grabbing touch-none'
          aria-label='Drag checklist item to reorder'
          draggable
          onDragStart={(event) => startMasterChecklistDrag(event, item.patientId, item.index)}
          onDragEnd={endMasterChecklistDrag}
          onTouchStart={(event) => startMasterChecklistTouchDrag(event, item.patientId, item.index)}
          onTouchMove={updateMasterChecklistTouchTarget}
          onTouchEnd={endMasterChecklistTouchDrag}
          onTouchCancel={cancelMasterChecklistTouchDrag}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
            event.preventDefault()
            moveMasterChecklistItem(item.patientId, item.index, event.key === 'ArrowUp' ? 'up' : 'down')
          }}
        >
          <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          className='self-center h-6 w-6 shrink-0 p-0 text-action-danger'
          aria-label='Remove checklist item'
          onClick={() => requestDeleteConfirmation({
            title: 'Delete checklist item?',
            message: `Remove "${item.text || 'this item'}" from ${item.patientId === GENERAL_CHECKLIST_PATIENT_ID ? 'General' : item.patientIdentifier}'s checklist?`,
            onConfirm: () => removeMasterChecklistItem(item.patientId, item.index),
          })}
        >
          <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
        </Button>
      </div>
    </div>
    ), [activeMasterChecklistRow, allowMasterChecklistDrop, cancelMasterChecklistTouchDrag, commitMasterChecklistItemNotesAndInsertBlankAfter, draggingMasterChecklistItem, dropMasterChecklistItem, endMasterChecklistDrag, endMasterChecklistTouchDrag, mergeMasterChecklistItemWithPrevious, moveMasterChecklistItem, pendingMasterChecklistFocus, removeMasterChecklistItem, requestDeleteConfirmation, splitMasterChecklistItem, startMasterChecklistDrag, startMasterChecklistTouchDrag, touchMasterChecklistTarget, updateMasterChecklistItemCompletion, updateMasterChecklistItemNotes, updateMasterChecklistItemText, updateMasterChecklistTouchTarget])

  const updateLabTemplateValue = useCallback((testKey: string, value: string) => {
    setLabTemplateValues((previous) => ({ ...previous, [testKey]: value }))
  }, [])

  const isOthersLabTemplate = useCallback((templateId: string) => templateId === OTHERS_LAB_TEMPLATE_ID, [])

  const buildLabEntryPayload = useCallback(() => {
    if (isOthersLabTemplate(selectedLabTemplate.id)) {
      const customLabel = (labTemplateValues[OTHERS_LABEL_KEY] ?? '').trim()
      const freeformResult = (labTemplateValues[OTHERS_RESULT_KEY] ?? '').trim()
      if (!customLabel || !freeformResult) {
        return null
      }

      return {
        [OTHERS_LABEL_KEY]: customLabel,
        [OTHERS_RESULT_KEY]: freeformResult,
      }
    }

    let hasPrimaryResult = false
    const filteredResults = selectedLabTemplate.tests.reduce<Record<string, string>>((accumulator, test) => {
      const value = (labTemplateValues[test.key] ?? '').trim()
      if (value) {
        accumulator[test.key] = value
        hasPrimaryResult = true
      }

      if (test.requiresUln) {
        const ulnKey = getUlnFieldKey(test.key)
        const ulnValue = (labTemplateValues[ulnKey] ?? '').trim()
        if (ulnValue) {
          accumulator[ulnKey] = ulnValue
        }
      }

      if (test.requiresNormalRange) {
        const normalRangeKey = getNormalRangeFieldKey(test.key)
        const normalRangeValue = (labTemplateValues[normalRangeKey] ?? '').trim()
        if (normalRangeValue) {
          accumulator[normalRangeKey] = normalRangeValue
        }
      }

      return accumulator
    }, {})

    if (!hasPrimaryResult) {
      return null
    }

    return filteredResults
  }, [isOthersLabTemplate, labTemplateValues, selectedLabTemplate.id, selectedLabTemplate.tests])

  const addPhotoAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0 || selectedPatientId === null) {
      event.target.value = ''
      return
    }

    setIsPhotoSaving(true)
    setNotice(files.length === 1 ? 'Saving photo...' : `Saving ${files.length} photos...`)

    try {
      const now = new Date()
      const trimmedTitle = attachmentTitle.trim()
      const usingDefaultTitle = isAttachmentTitleDefault || trimmedTitle.length === 0
      const uploadGroupId = buildPhotoUploadGroupId()

      let title: string
      let isDefaultTitle: boolean
      if (usingDefaultTitle) {
        const baseTitle = buildDefaultPhotoTitle(attachmentCategory, now)
        const today = toLocalISODate(now)
        const sameDayDefaultBatches = new Map<string, DefaultTitledPhotoBatch>()
        ;(photoAttachments ?? []).forEach((entry) => {
          if (
            entry.patientId !== selectedPatientId ||
            entry.category !== attachmentCategory ||
            !entry.isDefaultTitle ||
            !entry.uploadGroupId ||
            toLocalISODate(new Date(entry.createdAt)) !== today
          ) {
            return
          }
          sameDayDefaultBatches.set(entry.uploadGroupId, { groupId: entry.uploadGroupId, title: entry.title })
        })

        const assignment = resolveDefaultPhotoBatchTitle(baseTitle, Array.from(sameDayDefaultBatches.values()))
        await Promise.all(
          assignment.retitledBatches.map((batch) =>
            db.photoAttachments.where('uploadGroupId').equals(batch.groupId).modify({ title: batch.title }),
          ),
        )

        title = assignment.title
        isDefaultTitle = true
      } else {
        title = trimmedTitle
        isDefaultTitle = false
      }

      const preparedAttachments = await Promise.all(
        files.map(async (file, selectionOrderInGroup) => {
          const compressed = await compressImageFile(file)
          return {
            patientId: selectedPatientId,
            category: attachmentCategory,
            title,
            isDefaultTitle,
            uploadGroupId,
            selectionOrderInGroup,
            mimeType: compressed.mimeType,
            width: compressed.width,
            height: compressed.height,
            byteSize: compressed.blob.size,
            imageBlob: compressed.blob,
            createdAt: now.toISOString(),
          }
        }),
      )

      await db.photoAttachments.bulkAdd(preparedAttachments)
      await touchPatientLastModified(selectedPatientId)

      setAttachmentTitle(buildDefaultPhotoTitle(attachmentCategory))
      setIsAttachmentTitleDefault(true)
      setNotice(files.length === 1 ? 'Photo attached.' : `${files.length} photos attached in one block.`)
    } catch {
      setNotice('Unable to attach photos.')
    } finally {
      setIsPhotoSaving(false)
      event.target.value = ''
    }
  }

  const deletePhotoAttachment = async (attachmentId?: number) => {
    if (attachmentId === undefined) return
    const removedAttachment = photoAttachments?.find((attachment) => attachment.id === attachmentId)
    await db.photoAttachments.delete(attachmentId)
    await touchPatientLastModified(removedAttachment?.patientId)
    if (selectedAttachmentId === attachmentId) {
      setSelectedAttachmentId(null)
    }
    setNotice('Photo removed from app record.')
  }

  const exportPhotoAttachment = useCallback((attachment: ReviewablePhotoAttachment) => {
    const extensionByMimeType: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
    }

    const inferredExtension = extensionByMimeType[attachment.mimeType] ?? 'bin'
    const title = attachment.title.trim().length > 0 ? attachment.title.trim() : `photo-${attachment.id}`
    const safeTitle = title.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || `photo-${attachment.id}`
    const fileName = `${safeTitle}.${inferredExtension}`
    const url = URL.createObjectURL(attachment.imageBlob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Photo exported.')
  }, [])

  const setPhotoReassignTarget = useCallback((attachmentId: number, patientId: string) => {
    setReassignTargetsByAttachmentId((previous) => ({
      ...previous,
      [attachmentId]: patientId,
    }))
  }, [])

  const reassignPhotoAttachment = useCallback(async (attachment: ReviewablePhotoAttachment) => {
    const selectedTarget = reassignTargetsByAttachmentId[attachment.id]
    if (!selectedTarget || selectedTarget === 'none') {
      setNotice('Choose a patient first.')
      return
    }

    const nextPatientId = Number.parseInt(selectedTarget, 10)
    if (!Number.isFinite(nextPatientId)) {
      setNotice('Invalid patient selection.')
      return
    }

    const targetPatientExists = patientsById.has(nextPatientId)
    if (!targetPatientExists) {
      setNotice('Selected patient no longer exists.')
      return
    }

    await db.photoAttachments.update(attachment.id, { patientId: nextPatientId })
    await touchPatientLastModified(attachment.patientId)
    await touchPatientLastModified(nextPatientId)

    if (selectedAttachmentId === attachment.id && selectedPatientId !== null && selectedPatientId !== nextPatientId) {
      setSelectedAttachmentId(null)
    }

    setNotice('Photo reassigned.')
  }, [patientsById, reassignTargetsByAttachmentId, selectedAttachmentId, selectedPatientId, touchPatientLastModified])

  const deletePhotoAttachmentGroup = async (group: PhotoAttachmentGroup) => {
    const attachmentIds = group.entries.map((entry) => entry.id)
    const affectedPatientIds = Array.from(new Set(group.entries.map((entry) => entry.patientId)))
    if (attachmentIds.length === 0) return

    await db.photoAttachments.bulkDelete(attachmentIds)
    await Promise.all(affectedPatientIds.map((patientId) => touchPatientLastModified(patientId)))
    if (selectedAttachmentId !== null && attachmentIds.includes(selectedAttachmentId)) {
      setSelectedAttachmentId(null)
    }

    setNotice(
      attachmentIds.length === 1
        ? 'Photo removed from app record.'
        : `${attachmentIds.length} photos removed from app record.`,
    )
  }

  const hasUnsavedChanges = profileDirty || dailyDirty || vitalDirty || orderDirty

  const saveDailyUpdate = useCallback(
    async () => {
      if (selectedPatientId === null) return false

      setIsSaving(true)

      try {
        const nextId = await db.dailyUpdates.put({
          id: dailyUpdateId,
          patientId: selectedPatientId,
          date: dailyDate,
          ...dailyUpdateForm,
          problems: normalizeProblemBlocks(dailyUpdateForm.problems),
          checklist: normalizeChecklistItems(dailyUpdateForm.checklist),
          lastUpdated: new Date().toISOString(),
        })
        await touchPatientLastModified(selectedPatientId)

        setDailyUpdateId(typeof nextId === 'number' ? nextId : undefined)
        setDailyDirty(false)
        setLastSavedAt(new Date().toISOString())
        return true
      } catch {
        setNotice('Unable to save. Please try again.')
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [dailyDate, dailyUpdateForm, dailyUpdateId, selectedPatientId, touchPatientLastModified],
  )

  useEffect(() => {
    if (selectedPatientId === null || !dailyDirty) return

    const timeoutId = window.setTimeout(() => {
      void saveDailyUpdate()
    }, AUTOSAVE_FLUSH_MS)

    return () => window.clearTimeout(timeoutId)
  }, [dailyDirty, saveDailyUpdate, selectedPatientId])

  // Shared by the Problems and Checklist tabs — both edit the same per-date DailyUpdate record,
  // so each tab gets its own self-contained date/copy/delete controls bound to the same state.
  const renderDailyDateHeader = useCallback((context: 'problems' | 'checklist') => (
    <>
      <div className='flex flex-wrap items-end gap-2'>
        <div className='space-y-1 max-w-60'>
          <Label htmlFor={`daily-date-${context}`}>Date</Label>
          <FlexibleDateInput
            id={`daily-date-${context}`}
            ariaLabel='Daily update date'
            value={dailyDate}
            onChange={(nextDate) => {
              if (dailyDirty) {
                void saveDailyUpdate()
              }
              setDailyDate(nextDate)
              if (selectedPatient?.id) {
                void loadDailyUpdate(selectedPatient.id, nextDate)
              }
            }}
          />
        </div>
        <Button
          type='button'
          variant='secondary'
          onClick={() => void copyLatestDailyUpdateToForm()}
          disabled={selectedPatientId === null}
        >
          Copy latest entry
        </Button>
        <Button
          type='button'
          variant='destructive'
          onClick={() => void requestDeleteDailyUpdate()}
          disabled={selectedPatientId === null}
        >
          Delete day entry
        </Button>
      </div>
      <div className='space-y-1'>
        <p className='text-xs text-clay'>Saved entry dates</p>
        {(savedDailyEntryDates ?? []).length > 0 ? (
          <div className='flex flex-wrap gap-1'>
            {(savedDailyEntryDates ?? []).map((entryDate) => (
              <Button
                key={entryDate}
                type='button'
                variant={entryDate === dailyDate ? 'default' : 'outline'}
                className='h-7 px-2 text-xs'
                onClick={() => {
                  if (dailyDirty) {
                    void saveDailyUpdate()
                  }
                  setDailyDate(entryDate)
                  if (selectedPatient?.id) {
                    void loadDailyUpdate(selectedPatient.id, entryDate)
                  }
                }}
              >
                {entryDate}
              </Button>
            ))}
          </div>
        ) : (
          <p className='text-xs text-clay'>No saved daily entries yet.</p>
        )}
      </div>
    </>
  ), [copyLatestDailyUpdateToForm, dailyDate, dailyDirty, loadDailyUpdate, requestDeleteDailyUpdate, saveDailyUpdate, savedDailyEntryDates, selectedPatient?.id, selectedPatientId])

  const openCopyModal = (text: string, title: string) => {
    setOutputPreview(text)
    setOutputPreviewTitle(title)
    setNotice('Text ready. Select any section or copy everything.')
  }

  const copyPreviewToClipboard = async () => {
    if (!outputPreview) return
    if (!navigator.clipboard?.writeText) {
      setNotice('Clipboard is unavailable. Select and copy from the popup.')
      return
    }
    await navigator.clipboard.writeText(outputPreview)
    setClipboardCopied(true)
    setNotice('Copied full text to clipboard.')
    window.setTimeout(() => setClipboardCopied(false), 2200)
  }

  const sharePreviewText = async () => {
    if (!outputPreview) return
    if (!canUseWebShare) {
      setNotice('Web Share is unavailable on this device/browser.')
      return
    }

    try {
      await navigator.share({ title: outputPreviewTitle, text: outputPreview })
      setNotice('Shared.')
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'AbortError') return
      setNotice('Unable to share text.')
    }
  }

  const closeCopyModal = () => {
    setOutputPreview('')
    setOutputPreviewTitle('Generated text')
    setClipboardCopied(false)
    setIsOutputPreviewExpanded(false)
    setShowOutputPreviewExpand(false)
  }

  const toggleOutputPreviewExpanded = () => {
    const textarea = outputPreviewTextareaRef.current
    if (!textarea) return

    if (isOutputPreviewExpanded) {
      textarea.style.height = '100px'
      setIsOutputPreviewExpanded(false)
      return
    }

    textarea.style.height = 'auto'
    requestAnimationFrame(() => {
      textarea.style.height = `${textarea.scrollHeight}px`
      setIsOutputPreviewExpanded(true)
    })
  }

  useEffect(() => {
    const textarea = outputPreviewTextareaRef.current
    if (!textarea) return

    const hasOverflowAtDefaultHeight = textarea.scrollHeight > 101

    if (isOutputPreviewExpanded) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
      setShowOutputPreviewExpand(true)
      return
    }

    textarea.style.height = '100px'
    setShowOutputPreviewExpand(hasOverflowAtDefaultHeight)
  }, [isOutputPreviewExpanded, outputPreview])

  const addStructuredVital = async () => {
    if (selectedPatientId === null) return

    const saved = await saveVitalDraft()
    if (!saved) return
    setVitalForm(initialVitalForm())
    setVitalDraftId(null)
    setVitalDirty(false)
    setEditingVitalId(null)
    setNotice('Vital added.')
  }

  const deleteStructuredVital = async (vitalId?: number) => {
    if (vitalId === undefined) return
    await db.vitals.delete(vitalId)
    await touchPatientLastModified(selectedPatientId)
    if (editingVitalId === vitalId) {
      setEditingVitalId(null)
      setVitalForm(initialVitalForm())
      setVitalDirty(false)
    }
    if (vitalDraftId === vitalId) {
      setVitalDraftId(null)
      setVitalDirty(false)
    }
    setNotice('Vital removed.')
  }

  const startEditingVital = (entry: VitalEntry) => {
    if (entry.id === undefined) return
    setEditingVitalId(entry.id)
    setVitalDraftId(null)
    setVitalDirty(false)
    setVitalForm({
      date: entry.date,
      time: entry.time,
      bp: entry.bp,
      hr: entry.hr,
      rr: entry.rr,
      temp: entry.temp,
      spo2: entry.spo2,
      note: entry.note,
    })
  }

  const saveEditingVital = async () => {
    if (editingVitalId === null) return

    const saved = await saveVitalDraft()
    if (!saved) return

    setEditingVitalId(null)
    setVitalDirty(false)
    setVitalForm(initialVitalForm())
    setNotice('Vital updated.')
  }

  const cancelEditingVital = () => {
    setEditingVitalId(null)
    setVitalDirty(false)
    setVitalForm(initialVitalForm())
  }

  const getNextMedicationSortOrder = useCallback(async (patientId: number) => {
    const patientMedications = await db.medications.where('patientId').equals(patientId).toArray()
    const maxSortOrder = patientMedications.reduce((currentMax, entry, index) => {
      return Math.max(currentMax, entry.sortOrder ?? index)
    }, -1)
    return maxSortOrder + 1
  }, [])

  const addStructuredMedication = async () => {
    if (selectedPatientId === null || !medicationForm.medication.trim()) return

    const nextSortOrder = await getNextMedicationSortOrder(selectedPatientId)

    await db.medications.add({
      patientId: selectedPatientId,
      sortOrder: nextSortOrder,
      medication: medicationForm.medication.trim(),
      dose: medicationForm.dose.trim(),
      route: medicationForm.route.trim(),
      frequency: medicationForm.frequency.trim(),
      note: medicationForm.note.trim(),
      status: medicationForm.status,
      createdAt: new Date().toISOString(),
    })
    await touchPatientLastModified(selectedPatientId)

    setMedicationForm(initialMedicationForm())
    setNotice('Medication added.')
  }

  const addOrder = async () => {
    if (selectedPatientId === null || !orderForm.orderText.trim()) return

    const saved = await saveOrderDraft()
    if (!saved) return
    setEditingOrderId(null)
    setOrderForm(initialOrderForm())
    setOrderDraftId(null)
    setOrderDirty(false)
    setNotice('Order added.')
  }

  const startEditingOrder = (entry: OrderEntry) => {
    if (entry.id === undefined) return
    setEditingOrderId(entry.id)
    setOrderDraftId(null)
    setOrderDirty(false)
    setOrderForm({
      orderDate: entry.orderDate,
      orderTime: entry.orderTime,
      service: entry.service,
      orderText: entry.orderText,
      note: entry.note,
      status: entry.status,
    })
  }

  const saveEditingOrder = async () => {
    if (editingOrderId === null || !orderForm.orderText.trim()) return

    const saved = await saveOrderDraft()
    if (!saved) return

    setEditingOrderId(null)
    setOrderDirty(false)
    setOrderForm(initialOrderForm())
    setNotice('Order updated.')
  }

  const cancelEditingOrder = () => {
    setEditingOrderId(null)
    setOrderDirty(false)
    setOrderForm(initialOrderForm())
  }

  const deleteOrder = async (orderId?: number) => {
    if (orderId === undefined) return
    await db.orders.delete(orderId)
    await touchPatientLastModified(selectedPatientId)
    if (editingOrderId === orderId) {
      setEditingOrderId(null)
      setOrderForm(initialOrderForm())
      setOrderDirty(false)
    }
    if (orderDraftId === orderId) {
      setOrderDraftId(null)
      setOrderDirty(false)
    }
    setNotice('Order removed.')
  }

  const saveVitalDraft = useCallback(
    async () => {
      if (selectedPatientId === null) return false

      setIsSaving(true)

      const payload = {
        date: vitalForm.date || toLocalISODate(),
        time: vitalForm.time || toLocalTime(),
        bp: vitalForm.bp.trim(),
        hr: vitalForm.hr.trim(),
        rr: vitalForm.rr.trim(),
        temp: vitalForm.temp.trim(),
        spo2: vitalForm.spo2.trim(),
        note: vitalForm.note.trim(),
      }

      try {
        if (editingVitalId !== null) {
          await db.vitals.update(editingVitalId, payload)
        } else if (vitalDraftId !== null) {
          const updatedCount = await db.vitals.update(vitalDraftId, payload)
          if (updatedCount === 0) {
            const nextId = await db.vitals.add({
              patientId: selectedPatientId,
              ...payload,
              createdAt: new Date().toISOString(),
            })
            setVitalDraftId(typeof nextId === 'number' ? nextId : null)
          }
        } else {
          const nextId = await db.vitals.add({
            patientId: selectedPatientId,
            ...payload,
            createdAt: new Date().toISOString(),
          })
          setVitalDraftId(typeof nextId === 'number' ? nextId : null)
        }
        await touchPatientLastModified(selectedPatientId)

        setVitalDirty(false)
        setLastSavedAt(new Date().toISOString())
        return true
      } catch {
        setNotice('Unable to save. Please try again.')
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [editingVitalId, selectedPatientId, touchPatientLastModified, vitalDraftId, vitalForm],
  )

  const saveOrderDraft = useCallback(
    async () => {
      if (selectedPatientId === null || !orderForm.orderText.trim()) return false

      setIsSaving(true)

      const payload = {
        orderDate: orderForm.orderDate || toLocalISODate(),
        orderTime: orderForm.orderTime || toLocalTime(),
        service: orderForm.service.trim(),
        orderText: orderForm.orderText.trim(),
        note: orderForm.note.trim(),
        status: orderForm.status,
      }

      try {
        if (editingOrderId !== null) {
          await db.orders.update(editingOrderId, payload)
        } else if (orderDraftId !== null) {
          const updatedCount = await db.orders.update(orderDraftId, payload)
          if (updatedCount === 0) {
            const nextId = await db.orders.add({
              patientId: selectedPatientId,
              ...payload,
              createdAt: new Date().toISOString(),
            })
            setOrderDraftId(typeof nextId === 'number' ? nextId : null)
          }
        } else {
          const nextId = await db.orders.add({
            patientId: selectedPatientId,
            ...payload,
            createdAt: new Date().toISOString(),
          })
          setOrderDraftId(typeof nextId === 'number' ? nextId : null)
        }
        await touchPatientLastModified(selectedPatientId)

        setOrderDirty(false)
        setLastSavedAt(new Date().toISOString())
        return true
      } catch {
        setNotice('Unable to save. Please try again.')
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [editingOrderId, orderDraftId, orderForm, selectedPatientId, touchPatientLastModified],
  )

  const saveAllChanges = useCallback(async () => {
    if (selectedPatientId === null || isSaving) return
    if (!hasUnsavedChanges) return

    let hasFailure = false

    if (profileDirty) {
      const saved = await saveProfile()
      if (!saved) hasFailure = true
    }
    if (dailyDirty) {
      const saved = await saveDailyUpdate()
      if (!saved) hasFailure = true
    }
    if (vitalDirty) {
      const saved = await saveVitalDraft()
      if (!saved) hasFailure = true
    }
    if (orderDirty) {
      const saved = await saveOrderDraft()
      if (!saved) hasFailure = true
    }

    if (!hasFailure) return
  }, [dailyDirty, hasUnsavedChanges, isSaving, orderDirty, profileDirty, saveDailyUpdate, saveOrderDraft, saveProfile, saveVitalDraft, selectedPatientId, vitalDirty])

  useEffect(() => {
    if (selectedPatientId === null || !vitalDirty || isSaving) return

    const timeoutId = window.setTimeout(() => {
      void saveVitalDraft()
    }, AUTOSAVE_FLUSH_MS)

    return () => window.clearTimeout(timeoutId)
  }, [isSaving, saveVitalDraft, selectedPatientId, vitalDirty])

  useEffect(() => {
    if (selectedPatientId === null || !orderDirty || isSaving || !orderForm.orderText.trim()) return

    const timeoutId = window.setTimeout(() => {
      void saveOrderDraft()
    }, AUTOSAVE_FLUSH_MS)

    return () => window.clearTimeout(timeoutId)
  }, [isSaving, orderDirty, orderForm.orderText, saveOrderDraft, selectedPatientId])

  const deleteStructuredMedication = async (medicationId?: number) => {
    if (medicationId === undefined) return
    await db.medications.delete(medicationId)
    await touchPatientLastModified(selectedPatientId)
    if (editingMedicationId === medicationId) {
      setEditingMedicationId(null)
      setMedicationForm(initialMedicationForm())
    }
    setNotice('Medication removed.')
  }

  const startEditingMedication = (entry: MedicationEntry) => {
    if (entry.id === undefined) return
    setEditingMedicationId(entry.id)
    setMedicationForm({
      medication: entry.medication,
      dose: entry.dose,
      route: entry.route,
      frequency: entry.frequency,
      note: entry.note,
      status: entry.status,
    })
  }

  const saveEditingMedication = async () => {
    if (editingMedicationId === null) return
    
    await db.medications.update(editingMedicationId, {
      medication: medicationForm.medication.trim(),
      dose: medicationForm.dose.trim(),
      route: medicationForm.route.trim(),
      frequency: medicationForm.frequency.trim(),
      note: medicationForm.note.trim(),
      status: medicationForm.status,
    })
    await touchPatientLastModified(selectedPatientId)

    setEditingMedicationId(null)
    setMedicationForm(initialMedicationForm())
    setNotice('Medication updated.')
  }

  const cancelEditingMedication = () => {
    setEditingMedicationId(null)
    setMedicationForm(initialMedicationForm())
  }

  const reorderStructuredMedication = useCallback(async (sourceIndex: number, targetIndex: number) => {
    if (selectedPatientId === null || sourceIndex === targetIndex) return

    const sourceEntry = selectedPatientStructuredMeds[sourceIndex]
    const targetEntry = selectedPatientStructuredMeds[targetIndex]
    if (!sourceEntry || !targetEntry) return

    const reorderedEntries = [...selectedPatientStructuredMeds]
    const [movedEntry] = reorderedEntries.splice(sourceIndex, 1)
    reorderedEntries.splice(targetIndex, 0, movedEntry)

    await db.transaction('rw', [db.medications], async () => {
      await Promise.all(reorderedEntries.map((entry, index) => {
        if (entry.id === undefined) return Promise.resolve(0)
        return db.medications.update(entry.id, { sortOrder: index })
      }))
    })

    await touchPatientLastModified(selectedPatientId)
  }, [selectedPatientId, selectedPatientStructuredMeds, touchPatientLastModified])

  const startMedicationDrag = useCallback((event: DragEvent<HTMLButtonElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    setDraggingMedicationIndex(index)
  }, [])

  const resetMedicationDragState = useCallback(() => {
    setDraggingMedicationIndex(null)
    setTouchMedicationTargetIndex(null)
  }, [])

  const endMedicationDrag = useCallback(() => {
    resetMedicationDragState()
  }, [resetMedicationDragState])

  const startMedicationTouchDrag = useCallback((event: TouchEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    setDraggingMedicationIndex(index)
    setTouchMedicationTargetIndex(index)
  }, [])

  const updateMedicationTouchTarget = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    if (draggingMedicationIndex === null) return

    const touchPoint = event.touches[0]
    if (!touchPoint) return

    const targetElement = document.elementFromPoint(touchPoint.clientX, touchPoint.clientY)
    const medicationItemContainer = targetElement?.closest('[data-medication-index]')
    if (!(medicationItemContainer instanceof HTMLElement)) {
      setTouchMedicationTargetIndex(null)
      return
    }

    const parsedTargetIndex = Number.parseInt(medicationItemContainer.dataset.medicationIndex ?? '', 10)
    if (!Number.isInteger(parsedTargetIndex)) {
      setTouchMedicationTargetIndex(null)
      return
    }

    event.preventDefault()
    setTouchMedicationTargetIndex(parsedTargetIndex)
  }, [draggingMedicationIndex])

  const endMedicationTouchDrag = useCallback(() => {
    if (
      draggingMedicationIndex !== null
      && touchMedicationTargetIndex !== null
      && draggingMedicationIndex !== touchMedicationTargetIndex
    ) {
      void reorderStructuredMedication(draggingMedicationIndex, touchMedicationTargetIndex)
    }

    resetMedicationDragState()
  }, [draggingMedicationIndex, reorderStructuredMedication, resetMedicationDragState, touchMedicationTargetIndex])

  const cancelMedicationTouchDrag = useCallback(() => {
    resetMedicationDragState()
  }, [resetMedicationDragState])

  const allowMedicationDrop = useCallback((event: DragEvent<HTMLLIElement>, targetIndex: number) => {
    if (draggingMedicationIndex === null || draggingMedicationIndex === targetIndex) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [draggingMedicationIndex])

  const dropMedicationItem = useCallback((event: DragEvent<HTMLLIElement>, targetIndex: number) => {
    event.preventDefault()
    if (draggingMedicationIndex === null || draggingMedicationIndex === targetIndex) {
      resetMedicationDragState()
      return
    }

    void reorderStructuredMedication(draggingMedicationIndex, targetIndex)
    resetMedicationDragState()
  }, [draggingMedicationIndex, reorderStructuredMedication, resetMedicationDragState])

  const moveMedicationByDirection = useCallback((index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= selectedPatientStructuredMeds.length) return

    void reorderStructuredMedication(index, targetIndex)
  }, [reorderStructuredMedication, selectedPatientStructuredMeds.length])

  const addStructuredLab = async () => {
    if (selectedPatientId === null) return

    const entryDate = labTemplateDate || toLocalISODate()
    const resultsPayload = buildLabEntryPayload()

    if (!resultsPayload) {
      if (isOthersLabTemplate(selectedLabTemplate.id)) {
        setNotice('Enter both Label and Lab Result for Others.')
      } else {
        setNotice('Enter at least one lab value.')
      }
      return
    }

    await db.labs.add({
      patientId: selectedPatientId,
      date: entryDate,
      time: labTemplateTime || toLocalTime(),
      templateId: selectedLabTemplate.id,
      results: resultsPayload,
      note: labTemplateNote.trim(),
      createdAt: new Date().toISOString(),
    })
    await touchPatientLastModified(selectedPatientId)

    setLabTemplateValues({})
    setLabTemplateNote('')
    setLabTemplateTime('')
    setNotice(`Lab added from ${selectedLabTemplate.name}.`)
  }

  const deleteStructuredLab = async (labId?: number) => {
    if (labId === undefined) return
    await db.labs.delete(labId)
    await touchPatientLastModified(selectedPatientId)
    if (editingLabId === labId) {
      setEditingLabId(null)
      setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
      setLabTemplateDate('')
      setLabTemplateTime('')
      setLabTemplateValues({})
      setLabTemplateNote('')
    }
    setNotice('Lab removed.')
  }

  const startEditingLab = (entry: LabEntry) => {
    if (entry.id === undefined) return
    if (!labTemplatesById.has(entry.templateId)) return

    setEditingLabId(entry.id)
    setSelectedLabTemplateId(entry.templateId)
    setLabTemplateDate(entry.date)
    setLabTemplateTime(entry.time ?? '')
    setLabTemplateValues(entry.results ?? {})
    setLabTemplateNote(entry.note ?? '')
  }

  const saveEditingLab = async () => {
    if (editingLabId === null) return

    const resultsPayload = buildLabEntryPayload()

    if (!resultsPayload) {
      if (isOthersLabTemplate(selectedLabTemplate.id)) {
        setNotice('Enter both Label and Lab Result for Others.')
      } else {
        setNotice('Enter at least one lab value.')
      }
      return
    }

    await db.labs.update(editingLabId, {
      date: labTemplateDate || toLocalISODate(),
      time: labTemplateTime || toLocalTime(),
      templateId: selectedLabTemplate.id,
      results: resultsPayload,
      note: labTemplateNote.trim(),
    })
    await touchPatientLastModified(selectedPatientId)

    setEditingLabId(null)
    setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
    setLabTemplateDate('')
    setLabTemplateTime('')
    setLabTemplateValues({})
    setLabTemplateNote('')
    setNotice('Lab updated.')
  }

  const cancelEditingLab = () => {
    setEditingLabId(null)
    setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
    setLabTemplateDate('')
    setLabTemplateTime('')
    setLabTemplateValues({})
    setLabTemplateNote('')
  }

  const resetFocusedEditorState = useCallback(() => {
    setSelectedPatientId(null)
    setView('patients')
    setDailyUpdateId(undefined)
    setDailyUpdateForm(initialDailyUpdateForm)
    setVitalForm(initialVitalForm())
    setEditingVitalId(null)
    setVitalDraftId(null)
    setVitalDirty(false)
    setMedicationForm(initialMedicationForm())
    setEditingMedicationId(null)
    setOrderForm(initialOrderForm())
    setEditingOrderId(null)
    setOrderDraftId(null)
    setOrderDirty(false)
    setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
    setLabTemplateDate('')
    setLabTemplateTime('')
    setLabTemplateValues({})
    setLabTemplateNote('')
    setEditingLabId(null)
    setAttachmentCategory('profile')
    setAttachmentFilter('all')
    setAttachmentTitle(buildDefaultPhotoTitle('profile'))
    setIsAttachmentTitleDefault(true)
    setSelectedAttachmentId(null)
    setProfileForm(initialProfileForm)
    setLastSavedAt(null)
  }, [])

  const applySyncResult = useCallback((nextConfig: SyncConfig, message: string) => {
    saveSyncConfig(nextConfig)
    setSyncConfig(nextConfig)
    setSyncStatus('success')
    setNotice(message)
    resetFocusedEditorState()
    void refreshSyncInsight(nextConfig)
    window.setTimeout(() => {
      setSyncStatus((currentStatus) => (currentStatus === 'success' ? 'idle' : currentStatus))
    }, 3000)
  }, [refreshSyncInsight, resetFocusedEditorState])

  const runSyncNow = useCallback(async () => {
    if (!syncConfig) {
      setSyncSetupMode('setup')
      setSyncSetupOpen(true)
      return
    }

    if (isSyncBusy) return

    setIsSyncBusy(true)
    setSyncStatus('syncing')

    try {
      const result = await syncNow(syncConfig)

      if (isConflictSyncResult(result)) {
        let nextLocalConflictVersionMeta: LocalSyncVersionMeta | null = null
        try {
          nextLocalConflictVersionMeta = await getLocalSyncVersionMeta(result.config)
        } catch {
          nextLocalConflictVersionMeta = null
        }

        setSyncConfig(result.config)
        setConflictVersions(result.versions)
        setSelectedConflictVersion('local')
        setSyncConflictMode(result.kind)
        setLocalConflictVersionMeta(nextLocalConflictVersionMeta)
        setSyncConflictOpen(true)
        setSyncStatus('conflict')
        setNotice(result.kind === 'first-sync'
          ? 'First sync: choose upload or download before continuing.'
          : 'Sync conflict detected. Pick a version to keep.')
        void refreshSyncInsight(result.config)
        return
      }

      applySyncResult(result.config, result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.'
      setSyncStatus('error')
      setNotice(message)
      void refreshSyncInsight(syncConfig)
    } finally {
      setIsSyncBusy(false)
    }
  }, [applySyncResult, isSyncBusy, refreshSyncInsight, syncConfig])

  const handleSyncSetupSubmit = useCallback(async ({ roomCode, deviceName, username }: { roomCode: string; deviceName: SetupDeviceName; username: SetupUsername }) => {
    const nextConfig = await buildSyncConfig(roomCode, deviceName, username, getDefaultSyncEndpoint())
    saveSyncConfig(nextConfig)
    setSyncConfig(nextConfig)
    setSyncStatus('idle')
    setNotice(`Sync configured for ${nextConfig.username} (${nextConfig.deviceTag}).`)

    setIsSyncBusy(true)
    setSyncStatus('syncing')
    try {
      const result = await syncNow(nextConfig)
      if (isConflictSyncResult(result)) {
        let nextLocalConflictVersionMeta: LocalSyncVersionMeta | null = null
        try {
          nextLocalConflictVersionMeta = await getLocalSyncVersionMeta(result.config)
        } catch {
          nextLocalConflictVersionMeta = null
        }

        setSyncConfig(result.config)
        setConflictVersions(result.versions)
        setSelectedConflictVersion('local')
        setSyncConflictMode(result.kind)
        setLocalConflictVersionMeta(nextLocalConflictVersionMeta)
        setSyncConflictOpen(true)
        setSyncStatus('conflict')
        setNotice(result.kind === 'first-sync'
          ? 'First sync: choose upload or download before continuing.'
          : 'Sync conflict detected. Pick a version to keep.')
        void refreshSyncInsight(result.config)
        return
      }

      applySyncResult(result.config, result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to set up sync.'
      setSyncStatus('error')
      setNotice(message)
      void refreshSyncInsight(nextConfig)
    } finally {
      setIsSyncBusy(false)
    }
  }, [applySyncResult, refreshSyncInsight])

  const resolveSyncConflict = useCallback(async () => {
    if (!syncConfig || isSyncBusy) return

    setIsSyncBusy(true)
    setSyncStatus('syncing')

    try {
      const result = selectedConflictVersion === 'local'
        ? await resolveConflictKeepLocal(syncConfig)
        : await resolveConflictWithVersion(syncConfig, selectedConflictVersion)

      setSyncConflictOpen(false)
      setConflictVersions([])
      setSyncConflictMode('conflict')
      setSelectedConflictVersion('local')
      setLocalConflictVersionMeta(null)
      applySyncResult(result.config, result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to resolve conflict.'
      setSyncStatus('error')
      setNotice(message)
      void refreshSyncInsight(syncConfig)
    } finally {
      setIsSyncBusy(false)
    }
  }, [applySyncResult, isSyncBusy, refreshSyncInsight, selectedConflictVersion, syncConfig])

  const exportBackup = async () => {
    const payload: BackupPayload = {
      patients: await db.patients.toArray(),
      dailyUpdates: await db.dailyUpdates.toArray(),
      vitals: await db.vitals.toArray(),
      medications: await db.medications.toArray(),
      labs: await db.labs.toArray(),
      orders: await db.orders.toArray(),
      tagGroups: await db.tagGroups.toArray(),
      tagDefinitions: await db.tagDefinitions.toArray(),
      tagEvents: await db.tagEvents.toArray(),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `puhrr-backup-${toLocalISODate()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Backup exported (photos excluded).')
  }

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const rawText = await file.text()
      const parsed = JSON.parse(rawText) as unknown
      if (!isBackupPayload(parsed)) {
        setNotice('Invalid backup format.')
        event.target.value = ''
        return
      }

      await db.transaction(
        'rw',
        [db.patients, db.dailyUpdates, db.vitals, db.medications, db.labs, db.orders, db.tagGroups, db.tagDefinitions, db.tagEvents],
        async () => {
        await db.labs.clear()
        await db.medications.clear()
        await db.orders.clear()
        await db.vitals.clear()
        await db.dailyUpdates.clear()
        await db.patients.clear()
        await db.tagGroups.clear()
        await db.tagDefinitions.clear()
        await db.tagEvents.clear()
        if (parsed.patients.length > 0) {
          await db.patients.bulkPut(parsed.patients.map((patient) => ensurePatientLastModified(patient)))
        }
        if (parsed.dailyUpdates.length > 0) {
          await db.dailyUpdates.bulkPut(parsed.dailyUpdates.map((update) => normalizeDailyUpdate(update)))
        }
        if ((parsed.vitals ?? []).length > 0) {
          await db.vitals.bulkPut(parsed.vitals ?? [])
        }
        if ((parsed.medications ?? []).length > 0) {
          await db.medications.bulkPut(parsed.medications ?? [])
        }
        if ((parsed.labs ?? []).length > 0) {
          await db.labs.bulkPut(parsed.labs ?? [])
        }
        if ((parsed.orders ?? []).length > 0) {
          await db.orders.bulkPut(parsed.orders ?? [])
        }
        if ((parsed.tagGroups ?? []).length > 0) {
          await db.tagGroups.bulkPut(parsed.tagGroups ?? [])
        }
        if ((parsed.tagDefinitions ?? []).length > 0) {
          await db.tagDefinitions.bulkPut(parsed.tagDefinitions ?? [])
        }
        if ((parsed.tagEvents ?? []).length > 0) {
          await db.tagEvents.bulkPut(parsed.tagEvents ?? [])
        }
      },
      )

      setSelectedPatientId(null)
      setDailyUpdateId(undefined)
      setDailyUpdateForm(initialDailyUpdateForm)
      setVitalForm(initialVitalForm())
      setEditingVitalId(null)
      setVitalDraftId(null)
      setVitalDirty(false)
      setMedicationForm(initialMedicationForm())
      setEditingMedicationId(null)
      setOrderForm(initialOrderForm())
      setEditingOrderId(null)
      setOrderDraftId(null)
      setOrderDirty(false)
      setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
      setLabTemplateDate(toLocalISODate())
      setLabTemplateTime(toLocalTime())
      setLabTemplateValues({})
      setLabTemplateNote('')
      setEditingLabId(null)
      setAttachmentCategory('profile')
      setAttachmentFilter('all')
      setAttachmentTitle(buildDefaultPhotoTitle('profile'))
      setIsAttachmentTitleDefault(true)
      setSelectedAttachmentId(null)
      setProfileForm(initialProfileForm)
      setLastSavedAt(null)
      setNotice('Backup imported. Text data was replaced; existing photos were kept.')
    } catch {
      setNotice('Unable to import backup.')
    } finally {
      event.target.value = ''
    }
  }

  // Shared by both "Clear inactive patients" (Settings) and the Patients-list selection-mode
  // Delete button: removes the patient rows plus everything keyed to those patientIds across
  // every other table, and resets the open Profile/Vitals/etc. workspace if the currently open
  // patient was among those deleted.
  const deletePatientsAndRelatedData = async (patientIds: number[]) => {
    if (patientIds.length === 0) return

    await db.transaction(
      'rw',
      [db.patients, db.dailyUpdates, db.vitals, db.medications, db.labs, db.orders, db.photoAttachments, db.tagEvents, db.customActionRuns],
      async () => {
      await db.patients.bulkDelete(patientIds)
      await db.dailyUpdates.where('patientId').anyOf(patientIds).delete()
      await db.vitals.where('patientId').anyOf(patientIds).delete()
      await db.medications.where('patientId').anyOf(patientIds).delete()
      await db.labs.where('patientId').anyOf(patientIds).delete()
      await db.orders.where('patientId').anyOf(patientIds).delete()
      await db.photoAttachments.where('patientId').anyOf(patientIds).delete()
      await db.tagEvents.where('patientId').anyOf(patientIds).delete()
      await db.customActionRuns.where('patientId').anyOf(patientIds).delete()
    },
    )

    if (selectedPatientId !== null && patientIds.includes(selectedPatientId)) {
      setSelectedPatientId(null)
      setDailyUpdateForm(initialDailyUpdateForm)
      setVitalForm(initialVitalForm())
      setEditingVitalId(null)
      setVitalDraftId(null)
      setVitalDirty(false)
      setMedicationForm(initialMedicationForm())
      setEditingMedicationId(null)
      setOrderForm(initialOrderForm())
      setEditingOrderId(null)
      setOrderDraftId(null)
      setOrderDirty(false)
      setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
      setLabTemplateDate(toLocalISODate())
      setLabTemplateTime(toLocalTime())
      setLabTemplateValues({})
      setLabTemplateNote('')
      setEditingLabId(null)
      setAttachmentCategory('profile')
      setAttachmentFilter('all')
      setAttachmentTitle(buildDefaultPhotoTitle('profile'))
      setIsAttachmentTitleDefault(true)
      setSelectedAttachmentId(null)
      setProfileForm(initialProfileForm)
      setDailyUpdateId(undefined)
      setLastSavedAt(null)
    }
  }

  const clearDischargedPatients = async () => {
    const allPatients = await db.patients.toArray()
    const inactivePatients = allPatients.filter((patient) => !isPatientActive(patient, tagsById))
    const dischargedIds = inactivePatients.map((patient) => patient.id).filter((id): id is number => id !== undefined)

    if (dischargedIds.length === 0) {
      setNotice('No inactive patients to clear.')
      return
    }

    await deletePatientsAndRelatedData(dischargedIds)
    setNotice('Cleared inactive patients.')
  }

  // Delete via the Patients-list selection mode (single or multiple patients) — always routed
  // through requestDeleteConfirmation by the caller, never fired directly from a selection change.
  const deleteSelectedPatients = async () => {
    const patientIds = [...selectedPatientIdsForTagging]
    if (patientIds.length === 0) return

    await deletePatientsAndRelatedData(patientIds)
    setNotice(`Deleted ${patientIds.length} patient${patientIds.length === 1 ? '' : 's'}.`)
    exitPatientTaggingSelectionMode()
  }

  const addSamplePatient = async () => {
    const today = toLocalISODate()
    const now = new Date().toISOString()
    let samplePatientId = 0

    await db.transaction('rw', [db.patients, db.dailyUpdates, db.vitals, db.medications, db.labs, db.orders], async () => {
      samplePatientId = await db.patients.add({
        lastModified: now,
        createdAt: now,
        roomNumber: '512A',
        ward: '',
        lastName: 'DELA CRUZ',
        firstName: 'Juan',
        middleName: 'Santos',
        age: 57,
        sex: 'M',
        admitDate: today,
        referralDate: today,
        mainServiceTagIds: [],
        referralServiceTagIds: [],
        attendingPhysician: 'Dr. Maria C. Garcia',
        diagnosis: 'Community-acquired pneumonia (RLL), improving',
        clinicalSummary: 'CAP improving on empiric antibiotics with stable hemodynamics and improving respiratory symptoms. Continue monitoring trends and prepare for oral step-down when afebrile and clinically stable.',
        database: [
          'Chief Complaint:\n5 days cough, fever, and dyspnea',
          'History of Present Illness:\n57-year-old male with productive cough and intermittent fever for 5 days, associated with mild dyspnea on exertion. No chest pain. Symptoms improved after IV antibiotics.',
          'Past Medical History:\nHypertension (8 years), Type 2 Diabetes Mellitus (5 years), ex-smoker',
          'Physical Examination:\nAwake and coherent, speaks in full sentences.\nVS: BP 128/76, HR 84, RR 18, Temp 37.3°C, SpO2 96% room air.\nChest: bibasal crackles right greater than left, no retractions.\nCVS: adynamic precordium, regular rhythm.\nAbdomen: soft, non-tender.',
          'Clerk Notes:\nPatient reports better appetite and less cough overnight.',
        ].join('\n\n'),
        plans: 'Continue IV to oral antibiotic step-down tomorrow if afebrile.\nPulmonary hygiene and ambulation as tolerated.\nRepeat CBC and electrolytes in AM.',
        medications: 'Nebulization PRN for dyspnea episodes.',
        labs: 'Follow-up trends: CBC improving, renal panel stable.',
        pendings: 'Sputum culture and sensitivity result.\nRepeat chest x-ray in 48-72 hours.',
        tagIds: [],
      }) as number

      await db.medications.bulkAdd([
        {
          patientId: samplePatientId,
          sortOrder: 0,
          medication: 'Ceftriaxone',
          dose: '2 g',
          route: 'IV',
          frequency: 'q24h',
          note: 'Empiric CAP coverage, day 3',
          status: 'active',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          sortOrder: 1,
          medication: 'Azithromycin',
          dose: '500 mg',
          route: 'PO',
          frequency: 'OD',
          note: 'Adjunct atypical coverage',
          status: 'active',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          sortOrder: 2,
          medication: 'Amlodipine',
          dose: '10 mg',
          route: 'PO',
          frequency: 'OD',
          note: 'Home antihypertensive',
          status: 'active',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          sortOrder: 3,
          medication: 'Metformin',
          dose: '500 mg',
          route: 'PO',
          frequency: 'BID',
          note: 'Home antidiabetic',
          status: 'active',
          createdAt: now,
        },
      ])

      await db.vitals.bulkAdd([
        {
          patientId: samplePatientId,
          date: today,
          time: '09:00',
          bp: '126/78',
          hr: '86',
          rr: '20',
          temp: '37.6',
          spo2: '95',
          note: 'room air',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          date: today,
          time: '13:00',
          bp: '128/76',
          hr: '84',
          rr: '18',
          temp: '37.3',
          spo2: '96',
          note: 'room air, ambulatory',
          createdAt: now,
        },
      ])

      await db.dailyUpdates.add({
        patientId: samplePatientId,
        date: today,
        problems: [
          {
            id: `sample-cap-${samplePatientId}`,
            title: 'Community-acquired pneumonia, moderate risk',
            notes: 'Cough less frequent, afebrile for >24h, no accessory muscle use, and saturating well on room air. Continue antibiotics and monitor culture results.',
            completed: false,
          },
          {
            id: `sample-hypertension-${samplePatientId}`,
            title: 'Hypertension',
            notes: 'Hemodynamically stable on Amlodipine 10 mg PO OD. No chest pain or palpitations.',
            completed: false,
          },
          {
            id: `sample-diabetes-${samplePatientId}`,
            title: 'Type 2 diabetes mellitus',
            notes: 'Capillary glucose acceptable on Metformin 500 mg PO BID.',
            completed: false,
          },
        ],
        assessment: 'CAP, clinically improving with stable cardiorespiratory parameters.',
        plans: 'Continue current antibiotics today then reassess de-escalation.\nRepeat CBC/electrolytes tomorrow.\nCoordinate discharge planning once clinically stable.',
        checklist: [
          { text: 'Repeat CBC/electrolytes tomorrow morning.', completed: false },
          { text: 'Chest CT with contrast', completed: true },
        ],
        lastUpdated: now,
      })

      await db.labs.bulkAdd([
        {
          patientId: samplePatientId,
          date: today,
          templateId: 'ust-cbc',
          results: {
            RBC: '4.58',
            Hgb: '136',
            Hct: '0.41',
            MCV: '89.5',
            MCH: '29.7',
            MCHC: '33.2',
            RDW: '13.4',
            Plt: '302',
            MPV: '9.8',
            WBC: '11.2',
            N: '0',
            Metamyelocytes: '0',
            Bands: '2',
            S: '78',
            L: '14',
            M: '5',
            E: '1',
            B: '0',
            Blasts: '0',
            Myelocytes: '0',
            MDW: '21.5',
          },
          note: 'Mild leukocytosis with neutrophilic predominance, downtrending.',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          date: today,
          templateId: 'ust-urinalysis',
          results: {
            Color: 'yellow',
            Transparency: 'slightly hazy',
            pH: '6.0',
            'Specific Gravity': '1.020',
            Albumin: 'neg',
            Sugar: 'neg',
            Leukocytes: '1+',
            Erythrocytes: 'neg',
            Bilirubin: 'neg',
            Nitrite: 'neg',
            Ketone: 'neg',
            Urobilinogen: 'normal',
            RBC: '0-1/hpf',
            Pus: '2-4/hpf',
            Yeast: 'neg',
            Squamous: 'few',
            Renal: 'neg',
            TEC: 'neg',
            Bacteria: 'few',
            Mucus: 'few',
            'Amorphous Urates': 'neg',
            'Uric Acid': 'neg',
            'Calcium Oxalate': 'few',
            'Amorphous Phosphates': 'neg',
            'Triple Phosphate': 'neg',
            Hyaline: '0-1/lpf',
            Granular: 'neg',
            Waxy: 'neg',
            'RBC Cast': 'neg',
            'WBC Cast': 'neg',
          },
          note: 'No significant proteinuria or glycosuria; minimal pyuria.',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          date: today,
          time: '09:00',
          templateId: UST_BLOOD_CHEM_TEMPLATE_ID,
          results: {
            Sodium: '138',
            Potassium: '4.1',
            Chloride: '102',
            Magnesium: '2.0',
            'Ionized Calcium': '1.12',
            BUN: '16',
            Creatinine: '1.0',
            eGFR: '86',
            AST: '20',
            ALT: '41.5',
            '__uln:AST': '35',
            '__uln:ALT': '41.1',
          },
          note: 'Blood chemistry with liver enzyme comparison vs ULN.',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          date: today,
          time: '13:00',
          templateId: UST_BLOOD_CHEM_TEMPLATE_ID,
          results: {
            Sodium: '136',
            Potassium: '3.9',
            Chloride: '101',
            Magnesium: '1.9',
            'Ionized Calcium': '1.10',
            BUN: '15',
            Creatinine: '0.9',
            eGFR: '92',
            AST: '18',
            ALT: '38.9',
            '__uln:AST': '35',
            '__uln:ALT': '41.1',
          },
          note: 'Repeat blood chemistry for same-day trend comparison.',
          createdAt: now,
        },
      ])

      await db.orders.bulkAdd([
        {
          patientId: samplePatientId,
          orderDate: today,
          orderTime: '09:00',
          service: 'Internal Medicine',
          orderText: 'Repeat chest x-ray PA/Lateral on hospital day 3',
          note: 'Assess interval resolution of infiltrates',
          status: 'active',
          createdAt: now,
        },
        {
          patientId: samplePatientId,
          orderDate: today,
          orderTime: '11:00',
          service: 'Internal Medicine',
          orderText: 'CBC and electrolytes tomorrow 6 AM',
          note: 'Monitor response to treatment',
          status: 'active',
          createdAt: now,
        },
      ])
    })

    setNotice('Sample patient "Juan Dela Cruz" added successfully.')
  }

  const reportingSections: ReportingSection[] = selectedPatient
    ? [
        {
          id: 'patient-reporting',
          title: 'Current patient exports',
          description: 'Generate and format text output for the currently opened patient.',
          actions: [
            {
              id: 'profile-summary',
              label: 'Profile',
              outputTitle: 'Profile summary',
              buildText: () => toProfileSummary(
                selectedPatient,
                profileForm,
                getVisiblePatientTags(selectedPatient, tagsById, tagGroups ?? []).map(renderTagDisplayText),
                resolveServiceTagNames(selectedPatient.mainServiceTagIds, tagsById),
                resolveServiceTagNames(selectedPatient.referralServiceTagIds, tagsById),
              ),
            },
            {
              id: 'daily-summary',
              label: 'Problems',
              outputTitle: 'Problems List',
              buildText: () => toProblemsSummary(selectedPatient, dailyUpdateForm, patientVitals ?? [], dailyDate),
            },
            {
              id: 'vitals-log',
              label: 'Vitals',
              outputTitle: 'Vitals log',
              buildText: () =>
                toVitalsLogSummary(selectedPatient, patientVitals ?? [], {
                  dateFrom: reportVitalsDateFrom,
                  dateTo: reportVitalsDateTo,
                  timeFrom: reportVitalsTimeFrom,
                  timeTo: reportVitalsTimeTo,
                }),
            },
            {
              id: 'labs-summary',
              label: 'Labs',
              outputTitle: 'Labs',
              buildText: () => toLabsSummary(selectedPatient, selectedPatientStructuredLabs, selectedPatientLabReportIds),
            },
            {
              id: 'medications-summary',
              label: 'Meds',
              outputTitle: 'Medications',
              buildText: () => toMedicationsSummary(selectedPatient, selectedPatientStructuredMeds),
            },
            {
              id: 'orders-summary',
              label: 'Orders',
              outputTitle: 'Orders',
              buildText: () =>
                toOrdersSummary(selectedPatient, selectedPatientOrders, {
                  dateFrom: reportOrdersDateFrom,
                  dateTo: reportOrdersDateTo,
                  timeFrom: reportOrdersTimeFrom,
                  timeTo: reportOrdersTimeTo,
                }),
            },
            {
              id: 'census-entry',
              label: 'Census',
              outputTitle: 'Census entry',
              buildText: () =>
                toSelectedPatientCensusReport(
                  selectedPatient,
                  profileForm.diagnosis,
                  patientVitals ?? [],
                  selectedPatientStructuredLabs,
                  selectedPatientLabReportIds,
                  selectedPatientOrders,
                  {
                    dateFrom: reportVitalsDateFrom,
                    dateTo: reportVitalsDateTo,
                    timeFrom: reportVitalsTimeFrom,
                    timeTo: reportVitalsTimeTo,
                  },
                  {
                    dateFrom: reportOrdersDateFrom,
                    dateTo: reportOrdersDateTo,
                    timeFrom: reportOrdersTimeFrom,
                    timeTo: reportOrdersTimeTo,
                  },
                ),
            },
          ],
        },
        {
          id: 'census-reporting',
          title: 'All patient exports',
          description: 'Generate census text for selected active patients in your chosen order.',
          actions: [
            {
              id: 'all-vitals',
              label: 'Multiple Vitals',
              outputTitle: 'Selected Vitals',
              buildText: () =>
                toSelectedPatientsVitalsSummary(selectedCensusPatients, structuredVitalsByPatient, {
                  dateFrom: reportVitalsDateFrom,
                  dateTo: reportVitalsDateTo,
                  timeFrom: reportVitalsTimeFrom,
                  timeTo: reportVitalsTimeTo,
                }),
            },
            {
              id: 'all-census',
              label: 'Multiple Census',
              outputTitle: 'Selected Census',
              buildText: () =>
                selectedCensusPatients
                  .map((patient) =>
                    toCensusEntry(
                      patient,
                      structuredMedsByPatient.get(patient.id ?? -1) ?? [],
                      structuredLabsByPatient.get(patient.id ?? -1) ?? [],
                      structuredOrdersByPatient.get(patient.id ?? -1) ?? [],
                      getVisiblePatientTags(patient, tagsById, tagGroups ?? []).map(renderTagDisplayText),
                    ),
                  )
                  .join('\n\n'),
            },
          ],
        },
      ]
    : []

  const focusedPatientNavLabel = selectedPatient
    ? `${selectedPatient.roomNumber} - ${selectedPatient.lastName}`
    : 'Patient'
  const canShowFocusedPatientNavButton = selectedPatient ? isPatientActive(selectedPatient, tagsById) : false
  const masterChecklistGroupedByPatient = useMemo(() => {
    const grouped = new Map<number, { patientIdentifier: string; items: MasterChecklistItem[] }>()

    masterChecklistItems.forEach((item) => {
      const existing = grouped.get(item.patientId)
      if (existing) {
        existing.items.push(item)
        return
      }

      grouped.set(item.patientId, {
        patientIdentifier: item.patientIdentifier,
        items: [item],
      })
    })

    // The General checklist is a permanent fixture of this view (issue #79), not one-of-many
    // like patients — shown even with zero items so it's always discoverable, unlike a patient
    // section which simply doesn't render until they have checklist history.
    if (!grouped.has(GENERAL_CHECKLIST_PATIENT_ID)) {
      grouped.set(GENERAL_CHECKLIST_PATIENT_ID, { patientIdentifier: GENERAL_CHECKLIST_LABEL, items: [] })
    }

    return Array.from(grouped.entries())
      .map(([patientId, value]) => ({ patientId, ...value }))
      .sort((a, b) => {
        if (a.patientId === GENERAL_CHECKLIST_PATIENT_ID) return -1
        if (b.patientId === GENERAL_CHECKLIST_PATIENT_ID) return 1
        return a.patientIdentifier.localeCompare(b.patientIdentifier, undefined, { numeric: true, sensitivity: 'base' })
      })
  }, [masterChecklistItems])

  // Issue #81: Tag+Ward filter for the Master Checklist, independent of the Patients list and
  // census filters. General always stays visible — it has no ward/tags for the facets to match.
  const filteredMasterChecklistGroupedByPatient = useMemo(
    () => masterChecklistGroupedByPatient.filter((group) => {
      if (group.patientId === GENERAL_CHECKLIST_PATIENT_ID) return true
      const groupPatient = patientsById.get(group.patientId)
      return groupPatient ? matchesTagWardFilter(groupPatient, checklistFilter) : true
    }),
    [masterChecklistGroupedByPatient, patientsById, checklistFilter],
  )

  return (
    <div className='min-h-screen pb-20 sm:pb-0'>
      {/* Brand accent bar */}
      <div className='fixed inset-x-0 top-0 z-60 h-0.75 bg-linear-to-r from-action-primary/40 via-action-primary to-orange-400/70 pointer-events-none' aria-hidden='true' />
      {notice ? (
        <div className='fixed top-3 left-1/2 z-50 w-[min(92vw,38rem)] -translate-x-1/2 px-1 pointer-events-none'>
          <Alert
            className={cn(
              'border-action-primary/25 bg-white/95 shadow-lg shadow-espresso/8 pointer-events-auto transition-opacity duration-5000 ease-linear backdrop-blur-sm',
              noticeIsDecaying ? 'opacity-0' : 'opacity-100',
            )}
          >
            <Info className='h-4 w-4 text-action-primary shrink-0' />
            <AlertDescription className='text-espresso font-semibold'>{notice}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <main>
        <div className='mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-3'>
            <div className='relative shrink-0'>
              <div className='absolute -inset-2 rounded-2xl bg-action-primary/10 blur-lg pointer-events-none' aria-hidden='true' />
              <img src="/assets/puhr-v1/puhr-v1.svg" alt="PUHRR logo" className='relative h-10 w-10 sm:h-12 sm:w-12 drop-shadow-sm' />
            </div>
            <div>
              <div className='flex items-baseline gap-2'>
                <h1 className='text-2xl sm:text-3xl font-extrabold tracking-tight text-espresso leading-none'>PUHRR</h1>
                <span className='hidden sm:inline-block text-[10px] font-bold uppercase tracking-widest text-clay/55 bg-blush-sand px-2 py-0.5 rounded-full border border-clay/20'>Beta</span>
              </div>
              <p className='text-xs text-clay/65 mt-0.5 font-medium'>Portable Unofficial Health Record, Really!</p>
            </div>
          </div>
          <div className='hidden sm:flex items-center justify-end gap-2'>
            <SyncButton
              status={syncButtonStatus}
              onClick={() => void runSyncNow()}
              disabled={isSyncBusy}
              lastSyncedAt={syncConfig?.lastSyncedAt ?? null}
            />
            <div className='flex gap-0.5 bg-blush-sand/60 rounded-xl p-1 border border-clay/15 shadow-sm'>
              <Button variant={view === 'patients' ? 'default' : 'ghost'} size='sm' onClick={() => setView('patients')}>Patients</Button>
              {canShowFocusedPatientNavButton ? (
                <Button
                  variant={view === 'patient' ? 'default' : 'ghost'}
                  size='sm'
                  onClick={() => {
                    if (view !== 'patient' && selectedPatientId !== null) {
                      void loadDailyUpdate(selectedPatientId, dailyDate)
                    }
                    setView('patient')
                  }}
                >
                  {focusedPatientNavLabel}
                </Button>
              ) : null}
              <Button variant={view === 'checklist' ? 'default' : 'ghost'} size='sm' onClick={() => setView('checklist')}>Checklist</Button>
              <Button variant={view === 'settings' || view === 'manageTags' || view === 'tabSettings' || view === 'manageCustomActions' ? 'default' : 'ghost'} size='sm' onClick={() => setView('settings')}>Settings</Button>
            </div>
          </div>
        </div>

        {view === 'patient' && selectedPatient ? (
          <div className='mb-3 h-px bg-linear-to-r from-transparent via-clay/20 to-transparent sm:hidden' aria-hidden='true' />
        ) : null}

        {view === 'manageTags' ? (
          <ManageTagsScreen
            tags={tagDefinitions ?? []}
            groups={tagGroups ?? []}
            patients={patients ?? []}
            onBack={() => setView('settings')}
          />
        ) : view === 'tabSettings' ? (
          <TabSettingsScreen
            settings={patientTabSettings}
            onChange={updatePatientTabSettings}
            onBack={() => setView('settings')}
          />
        ) : view === 'manageCustomActions' ? (
          <ManageCustomActionsScreen
            customActions={customActions ?? []}
            tags={tagDefinitions ?? []}
            groups={tagGroups ?? []}
            onBack={() => setView('settings')}
          />
        ) : view !== 'settings' ? (
          <>
            {view === 'patients' ? (
              <>
            <Card className='bg-white/80 border-clay/30 mb-4 shadow-sm'>
              <CardHeader className='py-2.5 px-3 pb-0'>
                <button
                  type='button'
                  className='w-full flex items-center justify-between gap-2'
                  onClick={toggleAddPatientCollapsed}
                  aria-expanded={!isAddPatientCollapsed}
                >
                  <CardTitle className='text-sm font-semibold text-espresso'>Add patient</CardTitle>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-clay transition-transform', isAddPatientCollapsed && '-rotate-90')} aria-hidden='true' />
                </button>
              </CardHeader>
              {!isAddPatientCollapsed ? (
              <CardContent className='px-3 pb-3'>
                <form className='grid grid-cols-2 gap-2 sm:grid-cols-3' onSubmit={handleSubmit}>
                  <Input aria-label='Room Number' placeholder='Room Number' value={form.roomNumber} onChange={(event) => setForm({ ...form, roomNumber: event.target.value })} />
                  <Input aria-label='Ward/Location' placeholder='Ward/Location' value={form.ward} onChange={(event) => setForm({ ...form, ward: event.target.value })} />
                  <Input aria-label='Last name' placeholder='Last name' value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value.toUpperCase() })} required />
                  <Input aria-label='First name' placeholder='First name' value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
                  <Input aria-label='Age' placeholder='Age' type='number' min='0' value={form.age} onChange={(event) => setForm({ ...form, age: event.target.value })} />
                  <Select value={form.sex} onValueChange={(v) => setForm({ ...form, sex: v as 'M' | 'F' | 'O' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='M'>M</SelectItem>
                      <SelectItem value='F'>F</SelectItem>
                      <SelectItem value='O'>O</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className='col-span-2 sm:col-span-3'>
                    <ServiceTagMultiSelect
                      ariaLabel='Main Service'
                      placeholder='Main Service'
                      role='main'
                      selectedTags={resolveServiceTags(pendingMainServiceTagIds, tagsById)}
                      availableTags={serviceTags}
                      {...makePendingServiceTagHandlers(setPendingMainServiceTagIds)}
                    />
                  </div>
                  <Button type='submit' className='col-span-2 sm:col-span-3'>Add patient</Button>
                </form>
              </CardContent>
              ) : null}
            </Card>

            <Card className='bg-white/80 border-clay/30 mb-4 shadow-sm'>
              <CardContent className='px-3 py-2'>
                <div className='flex flex-col gap-2'>
                  <Input
                    aria-label='Search patients'
                    placeholder='Search by room, name, or service…'
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className='w-full'
                  />
                  <div className='flex gap-2'>
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'active' | 'inactive' | 'all')}>
                      <SelectTrigger className='flex-1'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='active'>Active</SelectItem>
                        <SelectItem value='inactive'>Inactive</SelectItem>
                        <SelectItem value='all'>All</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'room' | 'name' | 'admitDate')}>
                      <SelectTrigger className='flex-1'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='room'>Sort: Room</SelectItem>
                        <SelectItem value='name'>Sort: Name</SelectItem>
                        <SelectItem value='admitDate'>Sort: Admit date</SelectItem>
                      </SelectContent>
                    </Select>
                    <FilterButton
                      activeCount={countTagWardSelections(patientListFilter)}
                      onClick={() => setPatientListFilterDialogOpen(true)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className='flex items-center justify-between px-1 mb-2 gap-2'>
              <p className='text-xs font-medium text-clay'>
                {visiblePatients.length} patient{visiblePatients.length === 1 ? '' : 's'}
              </p>
              {!patientTagSelectionMode ? (
                <Button
                  variant='outline'
                  size='sm'
                  className='hidden sm:inline-flex h-7 text-xs'
                  onClick={() => setPatientTagSelectionMode(true)}
                >
                  Select
                </Button>
              ) : null}
            </div>

            {patientTagSelectionMode ? (
              <div className='mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-action-primary/40 bg-action-primary/5 p-2.5'>
                <p className='text-xs font-semibold text-espresso'>
                  {selectedPatientIdsForTagging.size} patient{selectedPatientIdsForTagging.size === 1 ? '' : 's'} selected
                </p>
                <div className='flex flex-wrap items-center gap-1.5 ml-auto'>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7 text-xs'
                    disabled={selectedPatientIdsForTagging.size === 0}
                    onClick={() => openBulkTagDialog('add')}
                  >
                    Add Tag
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7 text-xs'
                    disabled={selectedPatientIdsForTagging.size === 0}
                    onClick={() => openBulkTagDialog('remove')}
                  >
                    Remove Tag
                  </Button>
                  {manualCustomActions.map((action) => (
                    <Button
                      key={action.id}
                      size='sm'
                      variant='outline'
                      className='h-7 text-xs'
                      disabled={selectedPatientIdsForTagging.size === 0}
                      onClick={() => setBulkCustomActionTarget(action)}
                    >
                      {action.name}
                    </Button>
                  ))}
                  <Button
                    size='sm'
                    variant='destructive'
                    className='h-7 text-xs'
                    disabled={selectedPatientIdsForTagging.size === 0}
                    onClick={() => requestDeleteConfirmation({
                      title: 'Delete patients?',
                      message: `Permanently delete ${selectedPatientIdsForTagging.size} patient${selectedPatientIdsForTagging.size === 1 ? '' : 's'} and all of their daily updates, vitals, medications, labs, orders, photos, tag events, and custom action run history? This cannot be undone.`,
                      confirmLabel: 'Yes, delete permanently',
                      onConfirm: () => deleteSelectedPatients(),
                    })}
                  >
                    Delete
                  </Button>
                  <Button size='sm' variant='ghost' className='h-7 text-xs' onClick={exitPatientTaggingSelectionMode}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            <div className='flex flex-col gap-2'>
              {visiblePatients.map((patient) => {
                const patientActive = isPatientActive(patient, tagsById)
                const visibleTags = getVisiblePatientTags(patient, tagsById, tagGroups ?? [])
                const ambiguity = findTagAmbiguities(patient, tagsById)
                const cardMainServiceTags = resolveServiceTags(patient.mainServiceTagIds, tagsById)
                const cardReferralServiceTags = resolveServiceTags(patient.referralServiceTagIds, tagsById)
                const visibleMainServiceTags = cardMainServiceTags.filter((tag) => tag.visibleOnPatientCard)
                const visibleReferralServiceTags = cardReferralServiceTags.filter((tag) => tag.visibleOnPatientCard)
                const hasAnyServiceTags = cardMainServiceTags.length > 0 || cardReferralServiceTags.length > 0
                const hasVisibleServiceTags = visibleMainServiceTags.length > 0 || visibleReferralServiceTags.length > 0
                const isPatientSelectedForTagging = patient.id !== undefined && selectedPatientIdsForTagging.has(patient.id)
                return (
                <Card key={patient.id} className={cn(
                  'border-clay/20 hover:shadow-md hover:border-clay/35 transition-all duration-200 overflow-hidden bg-white/75',
                  patientActive
                    ? 'border-l-[3px] border-l-action-primary shadow-sm'
                    : 'border-l-[3px] border-l-clay/25 opacity-70',
                  isPatientSelectedForTagging && 'ring-2 ring-action-primary/50',
                )}>
                  <CardContent
                    className='flex items-center gap-3 py-3 px-4 cursor-pointer'
                    onTouchStart={() => handlePatientCardTouchStart(patient.id)}
                    onTouchEnd={handlePatientCardTouchEnd}
                    onTouchMove={cancelPatientCardLongPress}
                    onTouchCancel={cancelPatientCardLongPress}
                    onClick={() => {
                      if (patientTagSelectionMode) togglePatientTaggingSelection(patient.id)
                      else selectPatient(patient)
                    }}
                  >
                    {patientTagSelectionMode ? (
                      <input
                        type='checkbox'
                        className='h-4 w-4 shrink-0 accent-action-primary'
                        checked={isPatientSelectedForTagging}
                        onChange={() => togglePatientTaggingSelection(patient.id)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select ${patient.lastName}, ${patient.firstName}`}
                      />
                    ) : null}
                    <div className='flex-1 min-w-0'>
                      <p className='flex items-baseline gap-1.5 text-sm leading-snug'>
                        <span className={cn(
                          'shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold leading-none',
                          patientActive
                            ? 'bg-action-primary/10 text-action-primary'
                            : 'bg-clay/10 text-clay'
                        )}>
                          {patient.roomNumber}
                        </span>
                        <span className='truncate font-semibold text-espresso'>{patient.lastName}, {patient.firstName}</span>
                      </p>
                      <p className='flex items-center flex-wrap gap-x-1 gap-y-0.5 text-xs text-clay mt-0.5'>
                        {patient.ward ? (
                          <>
                            <span>{patient.ward}</span>
                            <span>·</span>
                          </>
                        ) : null}
                        <span>{patient.age}/{patient.sex}</span>
                        {hasVisibleServiceTags || !hasAnyServiceTags ? (
                          <>
                            <span>·</span>
                            {hasVisibleServiceTags ? (
                              <span className='flex items-center flex-wrap gap-1'>
                                {visibleMainServiceTags.map((tag) => <TagChip key={`main-${tag.id}`} tag={tag} roleMarker='M' />)}
                                {visibleReferralServiceTags.map((tag) => <TagChip key={`referral-${tag.id}`} tag={tag} roleMarker='R' />)}
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                          </>
                        ) : null}
                      </p>
                      {patient.diagnosis && (
                        <p className='text-xs text-espresso/50 truncate mt-0.5'>
                          {patient.diagnosis.split('\n')[0]}
                        </p>
                      )}
                    </div>
                    <div className='flex flex-col items-end gap-1.5 shrink-0'>
                      <div className='flex items-center gap-1'>
                        <AmbiguityBadge ambiguity={ambiguity} />
                        <TagChipRow tags={visibleTags} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                )
              })}
            </div>

            <Dialog
              open={bulkTagDialogMode !== null && !bulkTagConfirmOpen}
              onOpenChange={(open) => { if (!open) setBulkTagDialogMode(null) }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {bulkTagDialogMode === 'add' ? 'Add tags to' : 'Remove tags from'}{' '}
                    {selectedPatientIdsForTagging.size} patient{selectedPatientIdsForTagging.size === 1 ? '' : 's'}
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className='max-h-[60vh] pr-3'>
                  <BulkTagPicker
                    tags={nonServiceTagDefinitions}
                    groups={tagGroups ?? []}
                    selectedTagIds={bulkTagPickerSelectedIds}
                    onToggle={toggleBulkTagPickerTag}
                  />
                </ScrollArea>
                <div className='flex justify-end gap-2 pt-2'>
                  <Button variant='ghost' onClick={() => setBulkTagDialogMode(null)}>Cancel</Button>
                  <Button disabled={bulkTagPickerSelectedIds.size === 0} onClick={() => setBulkTagConfirmOpen(true)}>Next</Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={bulkTagConfirmOpen} onOpenChange={setBulkTagConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm bulk {bulkTagDialogMode === 'add' ? 'tag addition' : 'tag removal'}</DialogTitle>
                </DialogHeader>
                <p className='text-sm text-espresso'>
                  {bulkTagDialogMode === 'add' ? 'Add' : 'Remove'} the following tag
                  {bulkTagPickerSelectedTags.length === 1 ? '' : 's'} {bulkTagDialogMode === 'add' ? 'to' : 'from'}{' '}
                  {selectedPatientIdsForTagging.size} patient{selectedPatientIdsForTagging.size === 1 ? '' : 's'}:
                </p>
                <p className='text-sm font-semibold text-espresso'>
                  {bulkTagPickerSelectedTags.map((tag) => tag.name).join(', ')}
                </p>
                <div className='flex justify-end gap-2 pt-2'>
                  <Button variant='ghost' onClick={() => setBulkTagConfirmOpen(false)} disabled={isBulkTagApplying}>Back</Button>
                  <Button onClick={() => void confirmBulkTagAction()} disabled={isBulkTagApplying}>
                    {isBulkTagApplying ? 'Applying…' : 'Confirm'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={bulkCustomActionTarget !== null} onOpenChange={(open) => { if (!open) setBulkCustomActionTarget(null) }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Run "{bulkCustomActionTarget?.name}"?</DialogTitle>
                </DialogHeader>
                <p className='text-sm text-espresso'>
                  Run "{bulkCustomActionTarget?.name}" for {selectedPatientIdsForTagging.size} patient{selectedPatientIdsForTagging.size === 1 ? '' : 's'}?
                  Each patient's checklist items and tag effects are resolved independently.
                </p>
                <div className='flex justify-end gap-2 pt-2'>
                  <Button variant='ghost' onClick={() => setBulkCustomActionTarget(null)} disabled={isBulkCustomActionApplying}>Cancel</Button>
                  <Button onClick={() => void confirmBulkCustomAction()} disabled={isBulkCustomActionApplying}>
                    {isBulkCustomActionApplying ? 'Running…' : 'Confirm'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
              </>
            ) : null}

            {view === 'checklist' ? (
              <Card className='bg-warm-ivory border-clay shadow-sm'>
                <CardHeader className='pb-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <CardTitle className='text-base text-espresso'>Master Checklist</CardTitle>
                    <FilterButton
                      activeCount={countTagWardSelections(checklistFilter)}
                      onClick={() => setChecklistFilterDialogOpen(true)}
                    />
                  </div>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='space-y-1 max-w-60'>
                    <Label htmlFor='master-checklist-date'>Date</Label>
                    <FlexibleDateInput
                      id='master-checklist-date'
                      ariaLabel='Master checklist date'
                      value={masterChecklistDate}
                      onChange={setMasterChecklistDate}
                    />
                  </div>
                  <p className='text-xs text-clay'>
                    Viewing checklist state for {formatDateShortMonthDay(masterChecklistDate)}. Pending items carry forward to future dates; completed items stay on their original completion date.
                  </p>
                  <MasterChecklistQuickAdd options={masterChecklistQuickAddOptions} onAdd={addMasterChecklistItem} />
                  <div className='space-y-3'>
                    {filteredMasterChecklistGroupedByPatient.map((group) => {
                      const isGeneral = group.patientId === GENERAL_CHECKLIST_PATIENT_ID
                      const groupPatient = isGeneral ? undefined : patientsById.get(group.patientId)
                      const groupVisibleTags = groupPatient ? getVisiblePatientTags(groupPatient, tagsById, tagGroups ?? []) : []
                      return (
                      <div
                        key={`master-patient-${group.patientId}`}
                        className={cn('space-y-2', isGeneral && 'rounded-lg border border-clay/30 bg-blush-sand/40 p-2.5')}
                      >
                        <div>
                          <p className='text-sm font-semibold text-espresso'>{isGeneral ? 'General' : group.patientIdentifier}</p>
                          {groupVisibleTags.length > 0 ? <TagChipRow tags={groupVisibleTags} className='justify-start mt-0.5' /> : null}
                        </div>
                        {isGeneral && generalCustomActions.length > 0 ? (
                          <div className='flex flex-wrap gap-1.5'>
                            {generalCustomActions.map((action) => (
                              <Button
                                key={action.id}
                                type='button'
                                size='sm'
                                variant='outline'
                                className='h-7 text-xs gap-1'
                                onClick={() => void triggerGeneralCustomAction(action)}
                              >
                                <Zap className='h-3.5 w-3.5' aria-hidden='true' />
                                {action.name}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                        <div className='space-y-2'>
                          {group.items.map((item) => renderMasterChecklistItem(item, `master-${item.patientId}-${item.viewDate}-${item.index}`))}
                          {isGeneral && group.items.length === 0 ? (
                            <p className='text-xs text-clay'>No general items yet — use "Add item" above.</p>
                          ) : null}
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {view === 'patient' ? (
              selectedPatient ? (
              <>
              <div
                className={cn(
                  'sm:hidden fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 flex justify-center pointer-events-none transition-all duration-150 ease-out',
                  patientSwipePreviewPatient ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
                )}
              >
                {patientSwipePreviewPatient ? (
                  <div className='flex items-center gap-1.5 rounded-full bg-espresso text-warm-ivory px-3 py-1.5 text-sm font-semibold shadow-lg'>
                    {patientSwipeDirection === 'prev' ? <ChevronLeft className='h-4 w-4 shrink-0' /> : null}
                    <span className='whitespace-nowrap'>{patientSwipePreviewPatient.roomNumber} - {patientSwipePreviewPatient.lastName}, {patientSwipePreviewPatient.firstName}</span>
                    {patientSwipeDirection === 'next' ? <ChevronRight className='h-4 w-4 shrink-0' /> : null}
                  </div>
                ) : null}
              </div>
              <Card
                ref={patientSwipeCardRef}
                className={cn(
                  'border-0 bg-transparent shadow-none sm:bg-white/80 sm:border-clay/25 sm:shadow-md sm:ring-1 sm:ring-clay/10',
                  patientSwipeTransitionOn && 'transition-transform duration-200 ease-out',
                )}
                style={patientSwipeReleaseActive ? { transform: `translateX(${patientSwipeOffsetX}px)`, opacity: patientSwipeOpacityForOffset(patientSwipeOffsetX) } : undefined}
                onTouchStart={handlePatientSwipeTouchStart}
                onTouchMove={handlePatientSwipeTouchMove}
                onTouchEnd={handlePatientSwipeTouchEnd}
                onTouchCancel={resetPatientSwipe}
              >
                <CardHeader className='sticky top-0 z-20 py-2 px-0 pb-2 bg-warm-ivory/97 backdrop-blur-sm border-b border-clay/15 mx-0 sm:static sm:py-3 sm:px-4 sm:pb-0 sm:bg-transparent sm:backdrop-blur-none sm:border-b-0'>
                  <Select
                    value={isPatientActive(selectedPatient, tagsById) ? (selectedPatient.id?.toString() ?? '') : ''}
                    onValueChange={(value) => {
                      const nextId = Number.parseInt(value, 10)
                      if (!Number.isFinite(nextId) || selectedPatient.id === nextId) return
                      const nextPatient = quickSwitchPatients.find((patient) => patient.id === nextId)
                      if (!nextPatient) return
                      void selectPatient(nextPatient, { preserveSelectedTab: true })
                    }}
                  >
                    <SelectTrigger
                        className='h-auto w-full sm:w-fit max-w-full border-0 bg-transparent px-0 py-0 text-xl font-bold tracking-tight text-espresso shadow-none ring-0 focus:ring-0 focus:ring-offset-0 sm:text-base sm:font-semibold [&>svg]:text-espresso/70'
                    >
                      <SelectValue placeholder='Switch focused patient' />
                    </SelectTrigger>
                    <SelectContent position='item-aligned' className='max-h-[70vh]'>
                      {quickSwitchPatients.map((patient) => {
                        if (patient.id === undefined) return null

                        return (
                          <SelectItem key={patient.id} value={patient.id.toString()}>
                            {patient.roomNumber} - {patient.lastName}, {patient.firstName}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </CardHeader>
                <CardContent className='px-0 pb-5 sm:px-4 sm:pb-4'>
                <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as typeof selectedTab)}>
                  <TabsList className='hidden sm:flex h-auto w-full items-stretch gap-0.5 overflow-x-auto px-1 mb-4 mt-2'>
                    {visiblePatientTabs.map((tab) => (
                      <TabsTrigger key={tab} className='shrink-0 text-xs px-2.5' value={tab}>{PATIENT_TAB_LABELS[tab]}</TabsTrigger>
                    ))}
                  </TabsList>

                <TabsContent value='profile'>
                  <div className='space-y-3'>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-room' className={fieldLabelClassName(Boolean(profileForm.roomNumber.trim()))}>Room Number</Label>
                        <TapToEditField
                          ariaLabel='Room Number'
                          emptyText='Tap to add a room number'
                          value={profileForm.roomNumber}
                          onCommit={(nextValue) => updateProfileField('roomNumber', nextValue)}
                          renderEditor={({ value, onChange }) => (
                            <AutoGrowTextField id='profile-room' value={value} onChange={onChange} />
                          )}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-ward' className={fieldLabelClassName(Boolean(profileForm.ward.trim()))}>Ward/Location</Label>
                        <TapToEditField
                          ariaLabel='Ward/Location'
                          emptyText='Tap to add a ward/location'
                          value={profileForm.ward}
                          onCommit={(nextValue) => updateProfileField('ward', nextValue)}
                          renderEditor={({ value, onChange }) => (
                            <AutoGrowTextField id='profile-ward' value={value} onChange={onChange} />
                          )}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-lastname' className={fieldLabelClassName(Boolean(profileForm.lastName.trim()))}>Last name</Label>
                        <TapToEditField
                          ariaLabel='Last name'
                          emptyText='Tap to add a last name'
                          value={profileForm.lastName}
                          onCommit={(nextValue) => updateProfileField('lastName', nextValue.toUpperCase())}
                          renderEditor={({ value, onChange }) => (
                            <AutoGrowTextField id='profile-lastname' value={value} onChange={(nextValue) => onChange(nextValue.toUpperCase())} />
                          )}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-firstname' className={fieldLabelClassName(Boolean(profileForm.firstName.trim()))}>First name</Label>
                        <TapToEditField
                          ariaLabel='First name'
                          emptyText='Tap to add a first name'
                          value={profileForm.firstName}
                          onCommit={(nextValue) => updateProfileField('firstName', nextValue)}
                          renderEditor={({ value, onChange }) => (
                            <AutoGrowTextField id='profile-firstname' value={value} onChange={onChange} />
                          )}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-age' className={fieldLabelClassName(Boolean(profileForm.age.trim()))}>Age</Label>
                        <TapToEditField
                          ariaLabel='Age'
                          emptyText='Tap to add an age'
                          value={profileForm.age}
                          onCommit={(nextValue) => updateProfileField('age', nextValue)}
                          renderEditor={({ value, onChange }) => (
                            <AutoGrowTextField id='profile-age' value={value} onChange={onChange} />
                          )}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-sex' className={fieldLabelClassName(Boolean(profileForm.sex))}>Sex</Label>
                        <Select
                          value={profileForm.sex}
                          onValueChange={(v) => updateProfileField('sex', v as 'M' | 'F' | 'O')}
                        >
                          <SelectTrigger
                            id='profile-sex'
                            className='h-auto rounded-lg border border-transparent bg-transparent px-3 py-2 text-[15px] shadow-none transition-colors hover:border-clay/25 hover:bg-white/60 focus:ring-2 focus:ring-ring focus:ring-offset-2'
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='M'>M</SelectItem>
                            <SelectItem value='F'>F</SelectItem>
                            <SelectItem value='O'>O</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {profileForm.roomLegacyRaw ? (
                      <p className='text-xs text-action-danger'>
                        Unresolved combined room value: "{profileForm.roomLegacyRaw}" — split it into Room Number and Ward/Location above to clear this note.
                      </p>
                    ) : null}
                    <div className='grid grid-cols-2 gap-2'>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-admitdate'>Admission Date</Label>
                        <FlexibleDateInput
                          id='profile-admitdate'
                          ariaLabel='Admission Date'
                          value={profileForm.admitDate}
                          onChange={(isoDate) => updateProfileField('admitDate', isoDate)}
                          defaultIso={defaultCreatedDateIso}
                          emitEmptyOnClear
                        />
                      </div>
                      {hasReferralTag ? (
                        <div className='space-y-1'>
                          <Label htmlFor='profile-referraldate'>Referral Date</Label>
                          <FlexibleDateInput
                            id='profile-referraldate'
                            ariaLabel='Referral Date'
                            value={profileForm.referralDate}
                            onChange={(isoDate) => updateProfileField('referralDate', isoDate)}
                            defaultIso={defaultCreatedDateIso}
                            emitEmptyOnClear
                          />
                        </div>
                      ) : null}
                    </div>
                    {!isPatientActive(selectedPatient, tagsById) ? (
                      <div className='space-y-1'>
                        <Label htmlFor='profile-dischargedate'>Discharge Date</Label>
                        <FlexibleDateInput
                          id='profile-dischargedate'
                          ariaLabel='Discharge Date'
                          value={profileForm.dischargeDate}
                          onChange={(isoDate) => updateProfileField('dischargeDate', isoDate)}
                          defaultIso={defaultDischargeDateIso}
                          emitEmptyOnClear
                        />
                      </div>
                    ) : null}
                    <div className='space-y-1.5'>
                      {isEditingTags ? (
                        <div className='flex items-center gap-1.5'>
                          <Label>Tags</Label>
                          <AmbiguityBadge ambiguity={findTagAmbiguities(selectedPatient, tagsById)} />
                          {appliedPatientTags.length > 0 ? (
                            <Button
                              type='button'
                              variant='ghost'
                              className='h-6 w-6 shrink-0 p-0 text-clay ml-auto'
                              aria-label='Done editing tags'
                              onClick={() => {
                                const patientId = selectedPatient.id
                                if (patientId === undefined) return
                                setTagsEditOverrideByPatientId((previous) => {
                                  const next = new Map(previous)
                                  next.set(patientId, !isEditingTags)
                                  return next
                                })
                              }}
                            >
                              <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {isEditingTags ? (
                        <TagPicker
                          patient={selectedPatient}
                          tags={nonServiceTagDefinitions}
                          groups={tagGroups ?? []}
                          onToggle={(tag) => {
                            const wasApplied = tag.id !== undefined && (selectedPatient.tagIds ?? []).includes(tag.id)
                            void (async () => {
                              await toggleTagOnPatient(selectedPatient, tag)
                              if (!wasApplied && tag.id !== undefined) {
                                const patientAfterAdd: Patient = { ...selectedPatient, tagIds: [...(selectedPatient.tagIds ?? []), tag.id] }
                                await runAutomaticCustomActionsForTagAddition(patientAfterAdd, [tag.id])
                              }
                            })()
                          }}
                        />
                      ) : (
                        <div className='flex items-center gap-1.5'>
                          <TagChipRow
                            tags={appliedPatientTags.filter((tag) => tag.groupId === undefined || tag.groupId !== serviceGroupId)}
                            className='justify-start'
                          />
                          {appliedPatientTags.length > 0 ? (
                            <Button
                              type='button'
                              variant='ghost'
                              className='h-6 w-6 shrink-0 p-0 text-clay ml-auto'
                              aria-label='Edit tags'
                              onClick={() => {
                                const patientId = selectedPatient.id
                                if (patientId === undefined) return
                                setTagsEditOverrideByPatientId((previous) => {
                                  const next = new Map(previous)
                                  next.set(patientId, !isEditingTags)
                                  return next
                                })
                              }}
                            >
                              <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className='space-y-1'>
                      <Label>Main Service</Label>
                      {selectedPatient ? (
                        <ServiceTagMultiSelect
                          ariaLabel='Main Service'
                          placeholder='Add a main service…'
                          role='main'
                          selectedTags={resolveServiceTags(selectedPatient.mainServiceTagIds, tagsById)}
                          availableTags={serviceTags}
                          {...makePatientServiceTagHandlers(selectedPatient, addMainServiceTagToPatient, removeMainServiceTagFromPatient)}
                        />
                      ) : null}
                    </div>
                    <div className='space-y-1'>
                      <Label>Referrals</Label>
                      {selectedPatient ? (
                        <ServiceTagMultiSelect
                          ariaLabel='Referrals'
                          placeholder='Add a referral service…'
                          role='referral'
                          selectedTags={resolveServiceTags(selectedPatient.referralServiceTagIds, tagsById)}
                          availableTags={serviceTags}
                          {...makePatientServiceTagHandlers(selectedPatient, addReferralServiceTagToPatient, removeReferralServiceTagFromPatient)}
                        />
                      ) : null}
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-diagnosis' className={fieldLabelClassName(Boolean(profileForm.diagnosis.trim()))}>Diagnosis</Label>
                      <TapToEditField
                        ariaLabel='Diagnosis'
                        emptyText='Tap to add a diagnosis'
                        value={profileForm.diagnosis}
                        onCommit={(nextValue) => updateProfileField('diagnosis', nextValue)}
                        renderView={(text) => (
                          <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                        )}
                        renderEditor={({ value, onChange }) => (
                          <PhotoMentionField
                            ariaLabel='Diagnosis'
                            placeholder='Diagnosis'
                            className='min-h-24'
                            value={value}
                            onChange={onChange}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        )}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-clinicalsummary' className={fieldLabelClassName(Boolean(profileForm.clinicalSummary.trim()))}>Clinical Summary</Label>
                      <TapToEditField
                        ariaLabel='Clinical Summary'
                        emptyText='Tap to add a clinical summary'
                        value={profileForm.clinicalSummary}
                        onCommit={(nextValue) => updateProfileField('clinicalSummary', nextValue)}
                        renderView={(text) => (
                          <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                        )}
                        renderEditor={({ value, onChange }) => (
                          <PhotoMentionField
                            ariaLabel='Clinical Summary'
                            placeholder='Clinical Summary'
                            className='min-h-32'
                            value={value}
                            onChange={onChange}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        )}
                      />
                    </div>
                    <div className='flex gap-2 flex-wrap'>
                      <Button
                        variant={isPatientActive(selectedPatient, tagsById) ? 'destructive' : 'secondary'}
                        onClick={() => void toggleDischarge(selectedPatient)}
                        disabled={isPatientActive(selectedPatient, tagsById) && !dischargedTag}
                      >
                        {isPatientActive(selectedPatient, tagsById) ? 'Discharge' : 'Re-activate'}
                      </Button>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value='database'>
                  <div className='space-y-1'>
                    <Label htmlFor='profile-database'>Database</Label>
                    <p className='text-xs text-clay'>Unstructured scratch pad — chief complaint, history, exam findings, clerk notes, or anything else that doesn't need its own field.</p>
                    <TapToEditField
                      ariaLabel='Database'
                      emptyText='Tap to add chief complaint, HPI, PMH, PE, clerk notes…'
                      value={profileForm.database}
                      onCommit={(nextValue) => updateProfileField('database', nextValue)}
                      renderView={(text) => (
                        <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                      )}
                      renderEditor={({ value, onChange }) => (
                        <PhotoMentionField
                          ariaLabel='Database'
                          placeholder='Chief complaint, HPI, PMH, PE, clerk notes…'
                          className='min-h-72'
                          value={value}
                          onChange={onChange}
                          attachments={mentionableAttachments}
                          attachmentByTitle={mentionableAttachmentByTitle}
                          onOpenPhotoById={openPhotoById}
                        />
                      )}
                    />
                  </div>
                </TabsContent>
                <TabsContent value='problems'>
                  <div className='space-y-3'>
                    {renderDailyDateHeader('problems')}
                    <p className='text-xs text-clay'>Copies all problem blocks in their current order, assessment, and plan. Only pending checklist items carry over from the source date. Unresolved problems also carry forward automatically when you move to a new date.</p>
                    <ProblemListEditor
                      problems={dailyUpdateForm.problems}
                      onChange={(problems) => {
                        setDailyUpdateForm((previous) => ({ ...previous, problems }))
                        setDailyDirty(true)
                      }}
                      attachments={mentionableAttachments}
                      attachmentByTitle={mentionableAttachmentByTitle}
                      onOpenPhotoById={openPhotoById}
                    />
                    <div className='space-y-1'>
                      <Label>Assessment</Label>
                      <TapToEditField
                        ariaLabel='Assessment'
                        emptyText='Tap to add an assessment'
                        value={dailyUpdateForm.assessment}
                        onCommit={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, assessment: nextValue })
                          setDailyDirty(true)
                        }}
                        renderView={(text) => (
                          <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                        )}
                        renderEditor={({ value, onChange }) => (
                          <PhotoMentionField
                            ariaLabel='Assessment'
                            placeholder='Assessment'
                            value={value}
                            onChange={onChange}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        )}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Plan</Label>
                      <TapToEditField
                        ariaLabel='Daily plan'
                        emptyText='Tap to add a plan'
                        value={dailyUpdateForm.plans}
                        onCommit={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, plans: nextValue })
                          setDailyDirty(true)
                        }}
                        renderView={(text) => (
                          <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                        )}
                        renderEditor={({ value, onChange }) => (
                          <PhotoMentionField
                            ariaLabel='Daily plan'
                            placeholder='Plan'
                            value={value}
                            onChange={onChange}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        )}
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value='checklist'>
                  <div className='space-y-3'>
                    {renderDailyDateHeader('checklist')}
                    {manualCustomActions.length > 0 && selectedPatient ? (
                      <div className='space-y-1'>
                        <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Custom Actions</p>
                        <div className='flex flex-wrap gap-1.5'>
                          {manualCustomActions.map((action) => (
                            <Button
                              key={action.id}
                              type='button'
                              size='sm'
                              variant='outline'
                              className='h-7 text-xs gap-1'
                              onClick={() => void triggerCustomActionForSelectedPatient(action)}
                            >
                              <Zap className='h-3.5 w-3.5' aria-hidden='true' />
                              {action.name}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className='space-y-2'>
                      <p className='text-xs text-clay'>Tap any line to edit it, or the blank line at the end to add a new one. Press Enter to split at the cursor into a new item; Backspace at the start of a line merges it back into the one above (undoes a split). Completed items move to the bottom automatically. Drag any item to set a different order. On mobile, press and hold the handle then drag. Keyboard: focus the handle then press Ctrl/⌘ + ↑/↓.</p>
                      <div className='space-y-2'>
                        {withTrailingBlankChecklistItem(dailyUpdateForm.checklist).map((item, index) => (
                          renderDailyChecklistItem(item, index, index >= dailyUpdateForm.checklist.length)
                        ))}
                      </div>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value='vitals'>
                  <div className='space-y-3'>
                    <Card className='border-0 bg-transparent shadow-none sm:bg-blush-sand sm:border-clay sm:shadow-md'>
                      <CardHeader className='py-2 px-0 pb-0 sm:px-3'>
                        <CardTitle className='text-sm text-espresso'>Structured vitals log</CardTitle>
                      </CardHeader>
                      <CardContent className='px-0 pb-3 space-y-3 sm:px-3'>
                        <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
                          <div className='space-y-1'>
                            <Label>Date</Label>
                            <FlexibleDateInput ariaLabel='Vital date' value={vitalForm.date} onChange={(isoDate) => updateVitalField('date', isoDate)} defaultIso={toLocalISODate()} emitEmptyOnClear />
                          </div>
                          <div className='space-y-1'>
                            <Label>Time</Label>
                            <FlexibleTimeInput ariaLabel='Vital time' value={vitalForm.time} onChange={(hhmm) => updateVitalField('time', hhmm)} defaultHhmm={toLocalTime()} emitEmptyOnClear />
                          </div>
                          <div className='space-y-1'>
                            <Label>BP</Label>
                            <TapToEditField
                              ariaLabel='Vital blood pressure'
                              emptyText='120/80'
                              value={vitalForm.bp}
                              onCommit={(nextValue) => updateVitalField('bp', nextValue)}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField className='placeholder:text-clay/60' aria-label='Vital blood pressure' placeholder='120/80' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>HR</Label>
                            <TapToEditField
                              ariaLabel='Vital heart rate'
                              emptyText='80'
                              value={vitalForm.hr}
                              onCommit={(nextValue) => updateVitalField('hr', nextValue)}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField className='placeholder:text-clay/60' aria-label='Vital heart rate' placeholder='80' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>RR</Label>
                            <TapToEditField
                              ariaLabel='Vital respiratory rate'
                              emptyText='18'
                              value={vitalForm.rr}
                              onCommit={(nextValue) => updateVitalField('rr', nextValue)}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField className='placeholder:text-clay/60' aria-label='Vital respiratory rate' placeholder='18' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Temp</Label>
                            <TapToEditField
                              ariaLabel='Vital temperature'
                              emptyText='37.0'
                              value={vitalForm.temp}
                              onCommit={(nextValue) => updateVitalField('temp', nextValue)}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField className='placeholder:text-clay/60' aria-label='Vital temperature' placeholder='37.0' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>SpO2</Label>
                            <TapToEditField
                              ariaLabel='Vital oxygen saturation'
                              emptyText='99'
                              value={vitalForm.spo2}
                              onCommit={(nextValue) => updateVitalField('spo2', nextValue)}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField className='placeholder:text-clay/60' aria-label='Vital oxygen saturation' placeholder='99' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Note</Label>
                            <TapToEditField
                              ariaLabel='Vital note'
                              emptyText='Tap to add a note'
                              value={vitalForm.note}
                              onCommit={(nextValue) => updateVitalField('note', nextValue)}
                              renderView={(text) => (
                                <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                              )}
                              renderEditor={({ value, onChange }) => (
                                <PhotoMentionField
                                  ariaLabel='Vital note'
                                  placeholder='Note'
                                  value={value}
                                  onChange={onChange}
                                  attachments={mentionableAttachments}
                                  attachmentByTitle={mentionableAttachmentByTitle}
                                  onOpenPhotoById={openPhotoById}
                                />
                              )}
                            />
                          </div>
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                          {editingVitalId === null ? (
                            <Button size='sm' onClick={() => void addStructuredVital()}>Add vital</Button>
                          ) : (
                            <>
                              <Button size='sm' onClick={() => void saveEditingVital()}>Save</Button>
                              <Button size='sm' variant='destructive' onClick={() => requestDeleteConfirmation({
                                title: 'Delete vital?',
                                message: 'Are you sure you want to remove this vital entry?',
                                onConfirm: () => deleteStructuredVital(editingVitalId ?? undefined),
                              })}>Remove</Button>
                              <Button size='sm' variant='secondary' onClick={cancelEditingVital}>Cancel</Button>
                            </>
                          )}
                        </div>
                        {patientVitals && patientVitals.length > 0 ? (
                          <ul className='space-y-1'>
                            {[...patientVitals].reverse().map((entry) => (
                              <li key={entry.id} className='flex items-center justify-between gap-2 text-sm py-1 border-b border-clay/30 last:border-0'>
                                {editingVitalId === entry.id ? (
                                  <span className='text-clay italic'>(Editing above...)</span>
                                ) : (
                                  <>
                                    <span className='whitespace-pre-wrap'>
                                      <MentionText
                                        text={`${entry.date} ${entry.time} • BP ${entry.bp || '-'} • HR ${entry.hr || '-'} • RR ${entry.rr || '-'} • T ${entry.temp || '-'} • O2 ${entry.spo2 || '-'}${entry.note ? ` • ${entry.note}` : ''}`}
                                        attachmentByTitle={mentionableAttachmentByTitle}
                                        onOpenPhotoById={openPhotoById}
                                      />
                                    </span>
                                    <Button size='sm' variant='edit' onClick={() => startEditingVital(entry)}>Edit</Button>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className='flex flex-col items-center justify-center py-8 text-center'>
                            <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                              <HeartPulse className='h-6 w-6 text-clay' />
                            </div>
                            <p className='text-sm font-medium text-espresso'>No vitals recorded yet</p>
                            <p className='text-xs text-clay mt-1'>Add your first vital signs entry above.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
                <TabsContent value='medications'>
                  <div className='space-y-3'>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-medications'>Medications</Label>
                      <TapToEditField
                        ariaLabel='Medications'
                        emptyText='Tap to add medications'
                        value={profileForm.medications}
                        onCommit={(nextValue) => updateProfileField('medications', nextValue)}
                        renderView={(text) => (
                          <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                        )}
                        renderEditor={({ value, onChange }) => (
                          <PhotoMentionField
                            ariaLabel='Medications'
                            placeholder='Medications'
                            value={value}
                            onChange={onChange}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        )}
                      />
                    </div>
                    <Card className='border-0 bg-transparent shadow-none sm:bg-blush-sand sm:border-clay sm:shadow-md'>
                      <CardHeader className='py-2 px-0 pb-0 sm:px-3'>
                        <CardTitle className='text-sm text-espresso'>Structured medications</CardTitle>
                      </CardHeader>
                      <CardContent className='px-0 pb-3 space-y-3 sm:px-3'>
                        <div className='grid grid-cols-2 gap-2'>
                          <div className='space-y-1'>
                            <Label>Medication</Label>
                            <TapToEditField
                              ariaLabel='Medication name'
                              emptyText='Tap to add a medication'
                              value={medicationForm.medication}
                              onCommit={(nextValue) => setMedicationForm({ ...medicationForm, medication: nextValue })}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField
                                  aria-label='Medication name'
                                  placeholder='Medication'
                                  value={value}
                                  onChange={onChange}
                                />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Dose</Label>
                            <TapToEditField
                              ariaLabel='Medication dose'
                              emptyText='Tap to add a dose'
                              value={medicationForm.dose}
                              onCommit={(nextValue) => setMedicationForm({ ...medicationForm, dose: nextValue })}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField aria-label='Medication dose' placeholder='Dose' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Route</Label>
                            <TapToEditField
                              ariaLabel='Medication route'
                              emptyText='Tap to add a route'
                              value={medicationForm.route}
                              onCommit={(nextValue) => setMedicationForm({ ...medicationForm, route: nextValue })}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField aria-label='Medication route' placeholder='Route' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Frequency</Label>
                            <TapToEditField
                              ariaLabel='Medication frequency'
                              emptyText='Tap to add a frequency'
                              value={medicationForm.frequency}
                              onCommit={(nextValue) => setMedicationForm({ ...medicationForm, frequency: nextValue })}
                              renderEditor={({ value, onChange }) => (
                                <AutoGrowTextField aria-label='Medication frequency' placeholder='Frequency' value={value} onChange={onChange} />
                              )}
                            />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Note</Label>
                            <TapToEditField
                              ariaLabel='Medication note'
                              emptyText='Tap to add a note'
                              value={medicationForm.note}
                              onCommit={(nextValue) => setMedicationForm({ ...medicationForm, note: nextValue })}
                              renderView={(text) => (
                                <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                              )}
                              renderEditor={({ value, onChange }) => (
                                <PhotoMentionField
                                  ariaLabel='Medication note'
                                  placeholder='Note'
                                  value={value}
                                  onChange={onChange}
                                  attachments={mentionableAttachments}
                                  attachmentByTitle={mentionableAttachmentByTitle}
                                  onOpenPhotoById={openPhotoById}
                                />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Status</Label>
                            <Select value={medicationForm.status} onValueChange={(v) => setMedicationForm({ ...medicationForm, status: v as 'active' | 'discontinued' | 'completed' })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value='active'>Active</SelectItem>
                                <SelectItem value='discontinued'>Discontinued</SelectItem>
                                <SelectItem value='completed'>Completed</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                          {editingMedicationId === null ? (
                            <Button size='sm' onClick={() => void addStructuredMedication()}>Add medication</Button>
                          ) : (
                            <>
                              <Button size='sm' onClick={() => void saveEditingMedication()}>Save</Button>
                              <Button size='sm' variant='secondary' onClick={cancelEditingMedication}>Cancel</Button>
                              <Button size='sm' variant='destructive' onClick={() => requestDeleteConfirmation({
                                title: 'Delete medication?',
                                message: 'Are you sure you want to remove this medication entry?',
                                onConfirm: () => deleteStructuredMedication(editingMedicationId ?? undefined),
                              })}>Remove</Button>
                            </>
                          )}
                        </div>
                        {selectedPatientStructuredMeds.length > 0 ? (
                          <ul className='space-y-1'>
                            {selectedPatientStructuredMeds.map((entry, index) => (
                              <li
                                key={entry.id}
                                data-medication-index={index}
                                className={cn(
                                  'flex items-center justify-between gap-2 rounded-sm border-b border-clay/30 py-1 text-sm last:border-0',
                                  draggingMedicationIndex === index && 'opacity-60',
                                  touchMedicationTargetIndex === index && draggingMedicationIndex !== null && 'ring-2 ring-action-primary/40 ring-offset-1 ring-offset-transparent',
                                )}
                                onDragOver={(event) => allowMedicationDrop(event, index)}
                                onDrop={(event) => dropMedicationItem(event, index)}
                              >
                                {editingMedicationId === entry.id ? (
                                  <span className='text-clay italic'>(Editing above...)</span>
                                ) : (
                                  <>
                                    <span className='whitespace-pre-wrap flex-1'>
                                      <MentionText
                                        text={`${entry.medication} ${entry.dose} ${entry.route} ${entry.frequency}${entry.note ? ` — ${entry.note}` : ''} • ${entry.status}`}
                                        attachmentByTitle={mentionableAttachmentByTitle}
                                        onOpenPhotoById={openPhotoById}
                                      />
                                    </span>
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      className='h-6 w-6 shrink-0 p-0 text-clay cursor-grab active:cursor-grabbing touch-none'
                                      aria-label='Drag medication to reorder'
                                      draggable
                                      onDragStart={(event) => startMedicationDrag(event, index)}
                                      onDragEnd={endMedicationDrag}
                                      onTouchStart={(event) => startMedicationTouchDrag(event, index)}
                                      onTouchMove={updateMedicationTouchTarget}
                                      onTouchEnd={endMedicationTouchDrag}
                                      onTouchCancel={cancelMedicationTouchDrag}
                                      onKeyDown={(event) => {
                                        if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                                        event.preventDefault()
                                        moveMedicationByDirection(index, event.key === 'ArrowUp' ? 'up' : 'down')
                                      }}
                                    >
                                      <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
                                    </Button>
                                    <Button size='sm' variant='edit' onClick={() => startEditingMedication(entry)}>Edit</Button>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className='flex flex-col items-center justify-center py-8 text-center'>
                            <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                              <Pill className='h-6 w-6 text-clay' />
                            </div>
                            <p className='text-sm font-medium text-espresso'>No medications added yet</p>
                            <p className='text-xs text-clay mt-1'>Add your first medication entry above.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
                <TabsContent value='labs'>
                  <div className='space-y-3'>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-labs'>Labs</Label>
                      <TapToEditField
                        ariaLabel='Labs'
                        emptyText='Tap to add labs'
                        value={profileForm.labs}
                        onCommit={(nextValue) => updateProfileField('labs', nextValue)}
                        renderView={(text) => (
                          <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                        )}
                        renderEditor={({ value, onChange }) => (
                          <PhotoMentionField
                            ariaLabel='Labs'
                            placeholder='Labs'
                            value={value}
                            onChange={onChange}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        )}
                      />
                    </div>
                    <Card className='border-0 bg-transparent shadow-none sm:bg-blush-sand sm:border-clay sm:shadow-md'>
                      <CardHeader className='py-2 px-0 pb-0 sm:px-3'>
                        <CardTitle className='text-sm text-espresso'>Structured labs</CardTitle>
                      </CardHeader>
                      <CardContent className='px-0 pb-3 space-y-3 sm:px-3'>
                        <div className='grid grid-cols-1 sm:grid-cols-3 gap-2'>
                          <div className='space-y-1'>
                            <Label>Date</Label>
                            <FlexibleDateInput
                              ariaLabel='Lab date'
                              value={labTemplateDate}
                              onChange={setLabTemplateDate}
                              defaultIso={toLocalISODate()}
                              emitEmptyOnClear
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Time</Label>
                            <FlexibleTimeInput
                              ariaLabel='Lab time'
                              value={labTemplateTime}
                              onChange={setLabTemplateTime}
                              defaultHhmm={toLocalTime()}
                              emitEmptyOnClear
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Template</Label>
                            <Select
                              value={selectedLabTemplateId}
                              onValueChange={(value) => {
                                setSelectedLabTemplateId(value)
                                setLabTemplateValues({})
                              }}
                            >
                              <SelectTrigger aria-label='Lab template'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {LAB_TEMPLATES.map((template) => (
                                  <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className='space-y-2'>
                          {selectedLabTemplate.id === OTHERS_LAB_TEMPLATE_ID ? (
                            <div className='space-y-2'>
                              <div className='space-y-1'>
                                <Label>Label</Label>
                                <TapToEditField
                                  ariaLabel='Other lab label'
                                  emptyText='Example: ABG, Troponin, Coagulation Profile'
                                  value={labTemplateValues[OTHERS_LABEL_KEY] ?? ''}
                                  onCommit={(nextValue) => updateLabTemplateValue(OTHERS_LABEL_KEY, nextValue)}
                                  renderEditor={({ value, onChange }) => (
                                    <AutoGrowTextField
                                      aria-label='Other lab label'
                                      placeholder='Example: ABG, Troponin, Coagulation Profile'
                                      value={value}
                                      onChange={onChange}
                                    />
                                  )}
                                />
                              </div>
                              <div className='space-y-1'>
                                <Label>Lab Result</Label>
                                <TapToEditField
                                  ariaLabel='Other lab result'
                                  emptyText='Tap to enter the full lab result as freeform text'
                                  value={labTemplateValues[OTHERS_RESULT_KEY] ?? ''}
                                  onCommit={(nextValue) => updateLabTemplateValue(OTHERS_RESULT_KEY, nextValue)}
                                  renderView={(text) => (
                                    <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                                  )}
                                  renderEditor={({ value, onChange }) => (
                                    <PhotoMentionField
                                      ariaLabel='Other lab result'
                                      placeholder='Enter full lab result as freeform text'
                                      value={value}
                                      onChange={onChange}
                                      attachments={mentionableAttachments}
                                      attachmentByTitle={mentionableAttachmentByTitle}
                                      onOpenPhotoById={openPhotoById}
                                    />
                                  )}
                                />
                              </div>
                            </div>
                          ) : (
                            (() => {
                              let lastSection: string | undefined
                              return selectedLabTemplate.tests.map((test) => {
                                const showSection = test.section && test.section !== lastSection
                                lastSection = test.section
                                const isCalculatedAbgField =
                                  isAbgLabTemplate && (test.key === ABG_PF_RATIO_KEY || test.key === ABG_DESIRED_FIO2_KEY)
                                const abgPlaceholder = isAbgLabTemplate
                                  ? (() => {
                                      if (test.key === 'pH') return 'Decimal (e.g., 7.40)'
                                      if (test.key === 'pCO2') return 'Whole or decimal (e.g., 40)'
                                      if (test.key === 'pO2') return 'Whole or decimal (e.g., 80)'
                                      if (test.key === 'HCO3') return 'Whole or decimal (e.g., 24)'
                                      if (test.key === 'a/A') return 'Decimal ratio (e.g., 0.80)'
                                      if (test.key === 'A-aDO2') return 'Whole or decimal (e.g., 15)'
                                      if (test.key === ABG_ACTUAL_FIO2_KEY) return 'Whole % (e.g., 20, not 0.2)'
                                      if (test.key === ABG_PF_RATIO_KEY) return 'pO2 ÷ (Actual FiO2/100)'
                                      if (test.key === ABG_DESIRED_FIO2_KEY) return 'Actual FiO2 × Desired PaO2 ÷ pO2'
                                      return 'Value'
                                    })()
                                  : 'Value'
                                return (
                                  <div key={test.key}>
                                    {showSection && (
                                      <p className='text-xs font-semibold text-clay uppercase tracking-wide mt-2 mb-1'>{test.section}</p>
                                    )}
                                    <div className='grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_16rem] gap-2 items-start'>
                                      <p className='text-sm text-espresso font-medium'>
                                        {test.key}
                                        {test.fullName ? ` - ${test.fullName}` : ''}
                                        {test.unit ? ` (${test.unit})` : ''}
                                      </p>
                                      <div className='space-y-1'>
                                        {isCalculatedAbgField ? (
                                          <Input
                                            aria-label={`${selectedLabTemplate.name} ${test.key} value`}
                                            placeholder={abgPlaceholder}
                                            value={labTemplateValues[test.key] ?? ''}
                                            readOnly
                                            className='bg-warm-ivory text-clay'
                                            onChange={(event) => updateLabTemplateValue(test.key, event.target.value)}
                                          />
                                        ) : (
                                          <TapToEditField
                                            ariaLabel={`${selectedLabTemplate.name} ${test.key} value`}
                                            emptyText={abgPlaceholder}
                                            value={labTemplateValues[test.key] ?? ''}
                                            onCommit={(nextValue) => updateLabTemplateValue(test.key, nextValue)}
                                            renderEditor={({ value, onChange }) => (
                                              <AutoGrowTextField
                                                aria-label={`${selectedLabTemplate.name} ${test.key} value`}
                                                placeholder={abgPlaceholder}
                                                value={value}
                                                onChange={onChange}
                                              />
                                            )}
                                          />
                                        )}
                                        {test.requiresUln ? (
                                          <TapToEditField
                                            ariaLabel={`${selectedLabTemplate.name} ${test.key} upper limit of normal`}
                                            emptyText='ULN (upper limit of normal)'
                                            value={labTemplateValues[getUlnFieldKey(test.key)] ?? ''}
                                            onCommit={(nextValue) => updateLabTemplateValue(getUlnFieldKey(test.key), nextValue)}
                                            renderEditor={({ value, onChange }) => (
                                              <AutoGrowTextField
                                                aria-label={`${selectedLabTemplate.name} ${test.key} upper limit of normal`}
                                                placeholder='ULN (upper limit of normal)'
                                                value={value}
                                                onChange={onChange}
                                              />
                                            )}
                                          />
                                        ) : null}
                                        {test.requiresNormalRange ? (
                                          <TapToEditField
                                            ariaLabel={`${selectedLabTemplate.name} ${test.key} normal range`}
                                            emptyText='Normal range (e.g., 1.71-3.71)'
                                            value={labTemplateValues[getNormalRangeFieldKey(test.key)] ?? ''}
                                            onCommit={(nextValue) => updateLabTemplateValue(getNormalRangeFieldKey(test.key), nextValue)}
                                            renderEditor={({ value, onChange }) => (
                                              <AutoGrowTextField
                                                aria-label={`${selectedLabTemplate.name} ${test.key} normal range`}
                                                placeholder='Normal range (e.g., 1.71-3.71)'
                                                value={value}
                                                onChange={onChange}
                                              />
                                            )}
                                          />
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })
                            })()
                          )}

                          {isAbgLabTemplate ? (
                            <div className='space-y-2 rounded-md border border-clay/40 bg-warm-ivory p-2'>
                              <div className='space-y-1 text-xs text-clay'>
                                <p className='font-semibold text-espresso'>Oxygenation indices reviewer</p>
                                <p>a/AO2 NV: ≥0.75</p>
                                <p>A-aDO2 NV: 15+ [(# of decades above 30) *3]</p>
                                <p>P/F ratio NV: &lt;60 yo: 400; &gt;60 yo: 400 – [(# of yrs above 60) *5]</p>
                                <p>Desired FiO2 target PaO2 is fixed at 60 mmHg.</p>
                                {selectedPatient ? (
                                  <p>
                                    Age {selectedPatient.age}: A-aDO2 NV ≈ {abgNormalAaDo2} mmHg; P/F ratio NV ≈ {abgNormalPfRatio}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className='space-y-1'>
                          <Label>Note</Label>
                          <TapToEditField
                            ariaLabel='Lab note'
                            emptyText='Tap to add a note'
                            value={labTemplateNote}
                            onCommit={(nextValue) => setLabTemplateNote(nextValue)}
                            renderView={(text) => (
                              <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                            )}
                            renderEditor={({ value, onChange }) => (
                              <PhotoMentionField
                                ariaLabel='Lab note'
                                placeholder='Optional note for this lab run'
                                value={value}
                                onChange={onChange}
                                attachments={mentionableAttachments}
                                attachmentByTitle={mentionableAttachmentByTitle}
                                onOpenPhotoById={openPhotoById}
                              />
                            )}
                          />
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                          {editingLabId === null ? (
                            <Button size='sm' onClick={() => void addStructuredLab()}>Add lab</Button>
                          ) : (
                            <>
                              <Button size='sm' onClick={() => void saveEditingLab()}>Save</Button>
                              <Button size='sm' variant='secondary' onClick={cancelEditingLab}>Cancel</Button>
                              <Button size='sm' variant='destructive' onClick={() => requestDeleteConfirmation({
                                title: 'Delete lab?',
                                message: 'Are you sure you want to remove this lab entry?',
                                onConfirm: () => deleteStructuredLab(editingLabId ?? undefined),
                              })}>Remove</Button>
                            </>
                          )}
                        </div>
                        {selectedPatientStructuredLabs.length > 0 ? (
                          <ul className='space-y-1'>
                            {buildStructuredLabLines(selectedPatientStructuredLabs).map((line, index) => {
                              const entry = selectedPatientStructuredLabs[index]
                              return (
                                <li key={entry.id} className='flex items-center justify-between gap-2 text-sm py-1 border-b border-clay/30 last:border-0'>
                                  {editingLabId === entry.id ? (
                                    <span className='text-clay italic'>(Editing above...)</span>
                                  ) : (
                                    <>
                                      <span className='whitespace-pre-wrap'>
                                        <MentionText
                                          text={line}
                                          attachmentByTitle={mentionableAttachmentByTitle}
                                          onOpenPhotoById={openPhotoById}
                                        />
                                      </span>
                                      <Button size='sm' variant='edit' onClick={() => startEditingLab(entry)}>Edit</Button>
                                    </>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <div className='flex flex-col items-center justify-center py-8 text-center'>
                            <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                              <FlaskConical className='h-6 w-6 text-clay' />
                            </div>
                            <p className='text-sm font-medium text-espresso'>No lab results yet</p>
                            <p className='text-xs text-clay mt-1'>Add your first lab entry above.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
                <TabsContent value='orders'>
                  <div className='space-y-3'>
                    <Card className='border-0 bg-transparent shadow-none sm:bg-blush-sand sm:border-clay sm:shadow-md'>
                      <CardHeader className='py-2 px-0 pb-0 sm:px-3'>
                        <CardTitle className='text-sm text-espresso'>Doctor&apos;s orders</CardTitle>
                      </CardHeader>
                      <CardContent className='px-0 pb-3 space-y-3 sm:px-3'>
                        <div className='grid grid-cols-2 gap-2'>
                          <div className='space-y-1'>
                            <Label>Date</Label>
                            <FlexibleDateInput ariaLabel='Order date' value={orderForm.orderDate} onChange={(isoDate) => updateOrderField('orderDate', isoDate)} defaultIso={toLocalISODate()} emitEmptyOnClear />
                          </div>
                          <div className='space-y-1'>
                            <Label>Time</Label>
                            <FlexibleTimeInput ariaLabel='Order time' value={orderForm.orderTime} onChange={(hhmm) => updateOrderField('orderTime', hhmm)} defaultHhmm={toLocalTime()} emitEmptyOnClear />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Service</Label>
                            <ServiceTagSelect
                              ariaLabel='Order service'
                              placeholder='Select a service…'
                              value={orderForm.service}
                              availableTags={serviceTags}
                              onChange={(nextValue) => updateOrderField('service', nextValue)}
                            />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Order</Label>
                            <TapToEditField
                              ariaLabel='Order text'
                              emptyText='Tap to add the order'
                              value={orderForm.orderText}
                              onCommit={(nextValue) => updateOrderField('orderText', nextValue)}
                              renderView={(text) => (
                                <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                              )}
                              renderEditor={({ value, onChange }) => (
                                <PhotoMentionField
                                  ariaLabel='Order text'
                                  placeholder='Order'
                                  value={value}
                                  onChange={onChange}
                                  attachments={mentionableAttachments}
                                  attachmentByTitle={mentionableAttachmentByTitle}
                                  onOpenPhotoById={openPhotoById}
                                />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Note</Label>
                            <TapToEditField
                              ariaLabel='Order note'
                              emptyText='Tap to add a note'
                              value={orderForm.note}
                              onCommit={(nextValue) => updateOrderField('note', nextValue)}
                              renderView={(text) => (
                                <MentionText text={text} attachmentByTitle={mentionableAttachmentByTitle} onOpenPhotoById={openPhotoById} />
                              )}
                              renderEditor={({ value, onChange }) => (
                                <PhotoMentionField
                                  ariaLabel='Order note'
                                  placeholder='Note'
                                  value={value}
                                  onChange={onChange}
                                  attachments={mentionableAttachments}
                                  attachmentByTitle={mentionableAttachmentByTitle}
                                  onOpenPhotoById={openPhotoById}
                                />
                              )}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Status</Label>
                            <Select value={orderForm.status} onValueChange={(v) => updateOrderField('status', v as 'active' | 'carriedOut' | 'discontinued')}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value='active'>Active</SelectItem>
                                <SelectItem value='carriedOut'>Carried out</SelectItem>
                                <SelectItem value='discontinued'>Discontinued</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                          {editingOrderId === null ? (
                            <Button size='sm' onClick={() => void addOrder()}>Add order</Button>
                          ) : (
                            <>
                              <Button size='sm' onClick={() => void saveEditingOrder()}>Save</Button>
                              <Button size='sm' variant='destructive' onClick={() => requestDeleteConfirmation({
                                title: 'Delete order?',
                                message: 'Are you sure you want to remove this order?',
                                onConfirm: () => deleteOrder(editingOrderId ?? undefined),
                              })}>Remove</Button>
                              <Button size='sm' variant='secondary' onClick={cancelEditingOrder}>Cancel</Button>
                            </>
                          )}
                        </div>
                        {selectedPatientOrders.length > 0 ? (
                          <ul className='space-y-1'>
                            {selectedPatientOrders.map((entry) => {
                              const orderServiceTag = findServiceTagByName(entry.service, serviceTags)
                              return (
                              <li key={entry.id} className='flex items-center justify-between gap-2 text-sm py-1 border-b border-clay/30 last:border-0'>
                                {editingOrderId === entry.id ? (
                                  <span className='text-clay italic'>(Editing above...)</span>
                                ) : (
                                  <>
                                    <span className='min-w-0 flex-1 flex items-center gap-1.5 whitespace-pre-wrap text-left'>
                                      {entry.service.trim() ? (
                                        orderServiceTag ? (
                                          <TagChip tag={orderServiceTag} className='shrink-0' />
                                        ) : (
                                          <span className='shrink-0 rounded-full bg-blush-sand px-2 py-0.5 text-[11px] font-semibold text-espresso'>{entry.service}</span>
                                        )
                                      ) : null}
                                      <MentionText
                                        text={formatOrderEntryWithoutService(entry)}
                                        attachmentByTitle={mentionableAttachmentByTitle}
                                        onOpenPhotoById={openPhotoById}
                                      />
                                    </span>
                                    <Button size='sm' variant='edit' onClick={() => startEditingOrder(entry)}>Edit</Button>
                                  </>
                                )}
                              </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <div className='flex flex-col items-center justify-center py-8 text-center'>
                            <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                              <ClipboardList className='h-6 w-6 text-clay' />
                            </div>
                            <p className='text-sm font-medium text-espresso'>No orders yet</p>
                            <p className='text-xs text-clay mt-1'>Add your first order above.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
                <TabsContent value='photos'>
                  <div className='space-y-3'>
                    <Card className='border-0 bg-transparent shadow-none sm:bg-blush-sand sm:border-clay sm:shadow-md'>
                      <CardHeader className='py-2 px-0 pb-0 sm:px-3'>
                        <CardTitle className='text-sm text-espresso'>Photo attachments</CardTitle>
                      </CardHeader>
                      <CardContent className='px-0 pb-3 space-y-3 sm:px-3'>
                        <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                          <div className='space-y-1'>
                            <Label>Category</Label>
                            <Select
                              value={attachmentCategory}
                              onValueChange={(value) => {
                                const nextCategory = value as PhotoCategory
                                setAttachmentCategory(nextCategory)
                                setAttachmentTitle(buildDefaultPhotoTitle(nextCategory))
                                setIsAttachmentTitleDefault(true)
                              }}
                            >
                              <SelectTrigger aria-label='Photo category'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PHOTO_CATEGORY_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className='space-y-1'>
                            <Label htmlFor='attachment-title'>Title</Label>
                            <Input
                              id='attachment-title'
                              aria-label='Photo title'
                              placeholder='Photo title'
                              value={attachmentTitle}
                              onChange={(event) => {
                                setAttachmentTitle(event.target.value)
                                setIsAttachmentTitleDefault(false)
                              }}
                            />
                          </div>
                        </div>
                        <Input
                          ref={cameraPhotoInputRef}
                          type='file'
                          accept='image/*'
                          capture='environment'
                          multiple
                          className='hidden'
                          onChange={(event) => void addPhotoAttachment(event)}
                        />
                        <Input
                          ref={galleryPhotoInputRef}
                          type='file'
                          accept='image/*'
                          multiple
                          className='hidden'
                          onChange={(event) => void addPhotoAttachment(event)}
                        />
                        <div className='flex gap-2 flex-wrap'>
                          <Button size='sm' onClick={() => cameraPhotoInputRef.current?.click()} disabled={isPhotoSaving}>
                            {isPhotoSaving ? 'Saving photos...' : 'Take photo(s)'}
                          </Button>
                          <Button size='sm' variant='secondary' onClick={() => galleryPhotoInputRef.current?.click()} disabled={isPhotoSaving}>
                            Choose existing photo(s)
                          </Button>
                        </div>

                        <div className='flex items-end justify-between gap-2 flex-wrap'>
                          <div className='space-y-1 max-w-56'>
                            <Label>Show photos</Label>
                            <Select
                              value={attachmentFilter}
                              onValueChange={(value) => setAttachmentFilter(value as PhotoCategory | 'all')}
                            >
                              <SelectTrigger aria-label='Photo filter'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='all'>All categories</SelectItem>
                                {PHOTO_CATEGORY_OPTIONS.map((option) => (
                                  <SelectItem key={`filter-${option.value}`} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size='sm'
                            variant='secondary'
                            onClick={togglePatientPhotoViewMode}
                            aria-label={patientPhotoViewMode === 'collapsed' ? 'Switch to expanded photo view' : 'Switch to collapsed photo view'}
                          >
                            {patientPhotoViewMode === 'collapsed' ? (
                              <><LayoutGrid className='h-4 w-4 mr-1.5' />Expanded</>
                            ) : (
                              <><Layers className='h-4 w-4 mr-1.5' />Collapsed</>
                            )}
                          </Button>
                        </div>

                        {selectedPatientAttachmentGroups.length > 0 ? (
                          patientPhotoViewMode === 'collapsed' ? (
                            <div className='grid grid-cols-2 sm:grid-cols-3 gap-2'>
                              {selectedPatientAttachmentGroups.map((group) => {
                                const coverPhoto = group.entries[0]
                                const previewUrl = attachmentPreviewUrls[coverPhoto.id]
                                const createdAt = new Date(group.createdAt).toLocaleString()
                                const photoCount = group.entries.length

                                return (
                                  <div key={group.groupId} className='rounded-md border border-clay/40 bg-white p-1.5 space-y-1'>
                                    <button
                                      type='button'
                                      className='relative w-full overflow-hidden rounded border border-clay/30 bg-warm-ivory'
                                      onClick={() => openPhotoById(coverPhoto.id)}
                                    >
                                      {previewUrl ? (
                                        <img
                                          src={previewUrl}
                                          alt={coverPhoto.title || `Attachment ${formatPhotoCategory(coverPhoto.category)}`}
                                          className='h-28 w-full object-cover'
                                          loading='lazy'
                                        />
                                      ) : (
                                        <div className='h-28 flex items-center justify-center text-xs text-clay'>No preview</div>
                                      )}
                                      <span className='absolute right-1.5 top-1.5 rounded-full bg-espresso/85 px-1.5 py-0.5 text-[11px] font-semibold text-white'>
                                        {photoCount}
                                      </span>
                                    </button>
                                    <p className='text-xs text-espresso line-clamp-2'>
                                      {coverPhoto.title || '(No title)'}
                                    </p>
                                    <p className='text-[11px] text-clay'>
                                      {formatPhotoCategory(coverPhoto.category)} • {createdAt}
                                    </p>
                                    <div className='flex justify-between items-center gap-2'>
                                      <p className='text-[11px] text-clay'>{formatBytes(group.totalByteSize)}</p>
                                      <Button size='sm' variant='destructive' onClick={() => requestDeleteConfirmation({
                                        title: 'Delete photo set?',
                                        message: `Permanently remove ${group.entries.length === 1 ? 'this photo' : `these ${group.entries.length} photos`} from the app record?`,
                                        onConfirm: () => deletePhotoAttachmentGroup(group),
                                      })}>
                                        Remove set
                                      </Button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div className='space-y-4'>
                              {selectedPatientExpandedPhotoSections.map((section) => (
                                <div key={section.category} className='space-y-1.5'>
                                  <p className='text-xs font-semibold text-clay uppercase tracking-wide'>{section.label}</p>
                                  <div className='grid grid-cols-3 sm:grid-cols-4 gap-2'>
                                    {section.entries.map((entry) => {
                                      const previewUrl = attachmentPreviewUrls[entry.id]
                                      return (
                                        <button
                                          key={`expanded-photo-${entry.id}`}
                                          type='button'
                                          className='relative aspect-square overflow-hidden rounded border border-clay/30 bg-warm-ivory'
                                          onClick={() => openPhotoById(entry.id)}
                                        >
                                          {previewUrl ? (
                                            <img
                                              src={previewUrl}
                                              alt={entry.title || `Attachment ${formatPhotoCategory(entry.category)}`}
                                              className='h-full w-full object-cover'
                                              loading='lazy'
                                            />
                                          ) : (
                                            <div className='h-full w-full flex items-center justify-center text-xs text-clay'>No preview</div>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <div className='flex flex-col items-center justify-center py-8 text-center'>
                            <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                              <Camera className='h-6 w-6 text-clay' />
                            </div>
                            <p className='text-sm font-medium text-espresso'>No photos yet</p>
                            <p className='text-xs text-clay mt-1'>Take photo(s) or choose existing photo(s) above.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
                <TabsContent value='reporting'>
                  <div className='space-y-3'>
                    {reportingSections.map((section) => (
                      <Card key={section.id} className='bg-blush-sand border-clay'>
                        <CardHeader className='py-2 px-3 pb-0'>
                          <CardTitle className='text-sm text-espresso'>{section.title}</CardTitle>
                        </CardHeader>
                        <CardContent className='px-3 pb-3 space-y-3'>
                          <p className='text-sm text-clay'>{section.description}</p>
                          {section.id === 'census-reporting' ? (
                            <div className='space-y-2 rounded-md border border-clay/40 bg-white p-2'>
                              <p className='text-xs text-clay'>Selected Vitals uses the Vitals Filter above (same date/time window as Current patient exports).</p>
                              <div className='flex items-center justify-between gap-2 flex-wrap'>
                                <p className='text-xs text-clay'>
                                  Included: {selectedCensusPatients.length} of {censusSelectablePatients.length} matching patients
                                </p>
                                <div className='flex gap-2'>
                                  <FilterButton
                                    activeCount={countTagWardSelections(censusFilter) + (censusPoolCriteria.length !== 1 || censusPoolCriteria[0] !== 'active' ? censusPoolCriteria.length : 0)}
                                    onClick={() => setCensusFilterDialogOpen(true)}
                                  />
                                  <Button size='sm' variant='secondary' onClick={selectAllCensusPatients}>
                                    Select all
                                  </Button>
                                  <Button size='sm' variant='secondary' onClick={clearCensusPatientsSelection}>
                                    Unselect
                                  </Button>
                                </div>
                              </div>
                              {censusSelectablePatients.length > 0 ? (
                                <div className='flex flex-wrap gap-2'>
                                  {censusSelectablePatients.map((patient) => {
                                    if (patient.id === undefined) return null
                                    const patientId = patient.id
                                    const isSelected = selectedCensusPatientIds.includes(patient.id)
                                    return (
                                      <Button
                                        key={patientId}
                                        type='button'
                                        size='sm'
                                        variant={isSelected ? 'default' : 'secondary'}
                                        onClick={() => toggleCensusPatientSelection(patientId)}
                                      >
                                        {patient.roomNumber} — {patient.lastName}, {patient.firstName}
                                      </Button>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className='text-sm text-clay'>No patients match the current filter.</p>
                              )}
                              {selectedCensusPatients.length > 0 ? (
                                <div className='space-y-1'>
                                  <p className='text-xs text-clay'>Export order</p>
                                  <div className='space-y-1'>
                                    {selectedCensusPatients.map((patient, index) => {
                                      const patientId = patient.id
                                      if (patientId === undefined) return null

                                      return (
                                        <div
                                          key={`ordered-${patientId}`}
                                          className={cn(
                                            'flex items-center gap-2 rounded border border-clay/30 bg-warm-ivory px-2 py-1 transition-shadow',
                                            censusPatientDrag.isDragging(patientId) && 'opacity-50',
                                            censusPatientDrag.isDropTarget(patientId) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
                                          )}
                                          {...censusPatientDrag.getItemProps(patientId)}
                                        >
                                          <DragHandle
                                            label={`Drag to reorder ${patient.lastName}, ${patient.firstName}`}
                                            dragProps={censusPatientDrag.getHandleProps(patientId)}
                                          />
                                          <p className='flex-1 text-sm text-espresso'>
                                            {index + 1}. {patient.roomNumber} — {patient.lastName}, {patient.firstName}
                                          </p>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {section.id === 'patient-reporting' ? (
                            <div className='space-y-3 rounded-md border border-clay/40 bg-white p-2'>
                              <div className='space-y-2'>
                                <p className='text-xs font-semibold text-espresso'>Labs</p>
                                <div className='flex items-center gap-2 flex-wrap'>
                                  <Button
                                    size='sm'
                                    variant='secondary'
                                    onClick={() => setSelectedPatientLabReportIds(
                                      selectedPatientStructuredLabs
                                        .map((entry) => entry.id)
                                        .filter((id): id is number => id !== undefined),
                                    )}
                                  >
                                    Select all labs
                                  </Button>
                                  <Button size='sm' variant='secondary' onClick={() => setSelectedPatientLabReportIds([])}>Unselect labs</Button>
                                </div>
                                {selectedPatientLabGroupsForReporting.length > 0 ? (
                                  <div className='space-y-2'>
                                    {selectedPatientLabGroupsForReporting.map((group) => (
                                      <div key={`lab-group-${group.templateId}`} className='space-y-1'>
                                        <p className='text-xs text-clay'>{group.templateName}</p>
                                        <div className='flex gap-1 flex-wrap'>
                                          {group.entries.map((entry) => {
                                            if (entry.id === undefined) return null
                                            const checked = selectedPatientLabReportIds.includes(entry.id)
                                            return (
                                              <Button
                                                key={`lab-pick-${entry.id}`}
                                                size='sm'
                                                variant={checked ? 'default' : 'secondary'}
                                                onClick={() => toggleSelectedPatientLabReportId(entry.id as number)}
                                              >
                                                {formatDateMMDD(entry.date)} {formatClock(entry.time ?? '00:00')}
                                              </Button>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className='text-xs text-clay'>No structured labs for selected patient.</p>
                                )}
                              </div>

                              <div className='space-y-2'>
                                <p className='text-xs font-semibold text-espresso'>Vitals Filter</p>
                                <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From date</Label>
                                    <FlexibleDateInput ariaLabel='Vitals filter from date' value={reportVitalsDateFrom} onChange={setReportVitalsDateFrom} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From time</Label>
                                    <FlexibleTimeInput ariaLabel='Vitals filter from time' value={reportVitalsTimeFrom} onChange={setReportVitalsTimeFrom} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until date</Label>
                                    <FlexibleDateInput ariaLabel='Vitals filter until date' value={reportVitalsDateTo} onChange={setReportVitalsDateTo} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until time</Label>
                                    <FlexibleTimeInput ariaLabel='Vitals filter until time' value={reportVitalsTimeTo} onChange={setReportVitalsTimeTo} />
                                  </div>
                                </div>
                              </div>

                              <div className='space-y-2'>
                                <p className='text-xs font-semibold text-espresso'>Orders Filter</p>
                                <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From date</Label>
                                    <FlexibleDateInput ariaLabel='Orders filter from date' value={reportOrdersDateFrom} onChange={setReportOrdersDateFrom} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From time</Label>
                                    <FlexibleTimeInput ariaLabel='Orders filter from time' value={reportOrdersTimeFrom} onChange={setReportOrdersTimeFrom} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until date</Label>
                                    <FlexibleDateInput ariaLabel='Orders filter until date' value={reportOrdersDateTo} onChange={setReportOrdersDateTo} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until time</Label>
                                    <FlexibleTimeInput ariaLabel='Orders filter until time' value={reportOrdersTimeTo} onChange={setReportOrdersTimeTo} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                          <div className='space-y-1'>
                            <p className='text-xs text-clay'>Generate and open text preview:</p>
                            <div className='flex gap-2 flex-wrap'>
                              {section.actions.map((action) => (
                                <Button
                                  key={action.id}
                                  type='button'
                                  disabled={(action.id === 'all-census' || action.id === 'all-vitals') && selectedCensusPatients.length === 0}
                                  onClick={() => {
                                    try {
                                      openCopyModal(action.buildText(), action.outputTitle)
                                    } catch (error) {
                                      const message = error instanceof Error ? error.message : 'Unable to generate report.'
                                      setNotice(message)
                                    }
                                  }}
                                >
                                  {action.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
                </CardContent>
              </Card>
              </>
              ) : (
                <Card className='bg-white/80 border-clay/25 shadow-sm'>
                  <CardHeader className='py-3 px-4 pb-0'>
                    <CardTitle className='text-base text-espresso'>Focused patient</CardTitle>
                  </CardHeader>
                  <CardContent className='px-4 pb-4'>
                    <p className='text-sm text-clay'>No focused patient selected. Open one from Patients.</p>
                  </CardContent>
                </Card>
              )
            ) : null}
          </>
        ) : (
          <Card className='bg-white/80 border-clay/25 shadow-sm'>
            <CardHeader className='py-3 px-4 pb-2'>
              <CardTitle className='text-base text-espresso flex items-center gap-2'>
                <Settings className='h-4 w-4 text-action-primary' />
                Settings
              </CardTitle>
            </CardHeader>
            <CardContent className='px-4 pb-4 space-y-5'>
              <div className='space-y-2'>
                <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Sync Status</p>
                <div className='rounded-xl border border-clay/25 bg-warm-ivory px-3.5 py-3 space-y-2'>
                  <div className='flex flex-wrap gap-1.5'>
                    <Badge className={hasLocalChangesSinceLastSync ? 'bg-action-primary/15 text-action-primary border-action-primary/30' : 'bg-action-edit/15 text-action-edit border-action-edit/30'}>
                      {hasLocalChangesSinceLastSync ? 'Local changes pending upload' : 'No local pending changes'}
                    </Badge>
                    <Badge className={syncInsight?.remoteHasNewerData ? 'bg-blush-sand text-espresso border-clay/30' : 'bg-action-edit/15 text-action-edit border-action-edit/30'}>
                      {syncInsight?.remoteHasNewerData ? 'Room has newer upload' : 'Room upload is up to date'}
                    </Badge>
                    {isSyncInsightLoading ? (
                      <Badge className='bg-clay/15 text-clay border-clay/30'>Checking room status…</Badge>
                    ) : null}
                  </div>

                  <div className='grid gap-1.5 text-xs text-espresso'>
                    <p><strong>Device:</strong> {syncConfig?.deviceTag ?? 'Not configured'}</p>
                    <p><strong>User:</strong> {syncConfig?.username ?? 'Not configured'}</p>
                    <p><strong>Latest local change:</strong> {formatSyncDateTime(latestLocalChangeAt)}</p>
                    <div className='h-px bg-clay/15 my-1' />
                    <p><strong>Last successful sync:</strong> {formatSyncDateTime(syncConfig?.lastSyncedAt)}</p>
                    <div className='h-px bg-clay/15 my-1' />
                    <p><strong>Last room upload:</strong> {formatSyncDateTime(syncInsight?.remoteLatestPushAt)} by {latestUploadOwnerLabel}</p>
                  </div>
                </div>
              </div>

              {/* Data management */}
              <div className='space-y-2'>
                <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Data Management</p>
                <div className='flex flex-col gap-2'>
                  <button
                    type='button'
                    onClick={() => void exportBackup()}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-edit/10 flex items-center justify-center shrink-0'>
                      <Upload className='h-4 w-4 text-action-edit' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Export backup</p>
                      <p className='text-xs text-clay mt-0.5'>Download all patient data as JSON (photos excluded)</p>
                    </div>
                  </button>
                  <input
                    ref={backupFileInputRef}
                    type='file'
                    accept='application/json'
                    className='hidden'
                    onChange={(event) => void importBackup(event)}
                  />
                  <button
                    type='button'
                    onClick={() => backupFileInputRef.current?.click()}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-primary/10 flex items-center justify-center shrink-0'>
                      <Download className='h-4 w-4 text-action-primary' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Import backup</p>
                      <p className='text-xs text-clay mt-0.5'>Restore from backup JSON — replaces text data, keeps current photos</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => setShowPhotoReviewDialog(true)}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-edit/10 flex items-center justify-center shrink-0'>
                      <Camera className='h-4 w-4 text-action-edit' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Review all photos</p>
                      <p className='text-xs text-clay mt-0.5'>Manage linked or orphan photos across all patients</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => requestDeleteConfirmation({
                      title: 'Clear inactive patients?',
                      message: 'Permanently deletes every patient record with a Terminal tag applied, along with all of their daily updates, vitals, medications, labs, orders, and photos. This cannot be undone.',
                      confirmLabel: 'Yes, delete permanently',
                      onConfirm: () => clearDischargedPatients(),
                    })}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-red-50 hover:bg-red-100 border border-action-danger/25 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-danger/10 flex items-center justify-center shrink-0'>
                      <Trash2 className='h-4 w-4 text-action-danger' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-action-danger'>Clear inactive patients</p>
                      <p className='text-xs text-clay mt-0.5'>Permanently removes all patient records with a Terminal tag applied</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      setSyncSetupMode('edit')
                      setSyncSetupOpen(true)
                    }}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-edit/10 flex items-center justify-center shrink-0'>
                      <Settings className='h-4 w-4 text-action-edit' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Edit sync settings</p>
                      <p className='text-xs text-clay mt-0.5'>Change room code or device name for this device</p>
                    </div>
                  </button>
                </div>
              </div>
              {/* Customize */}
              <div className='space-y-2'>
                <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Customize</p>
                <div className='flex flex-col gap-2'>
                  <button
                    type='button'
                    onClick={() => setView('manageTags')}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-primary/10 flex items-center justify-center shrink-0'>
                      <TagsIcon className='h-4 w-4 text-action-primary' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Manage Tags</p>
                      <p className='text-xs text-clay mt-0.5'>Create, edit, and reorder tags and tag groups</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => setView('manageCustomActions')}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-primary/10 flex items-center justify-center shrink-0'>
                      <Zap className='h-4 w-4 text-action-primary' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Manage Custom Actions</p>
                      <p className='text-xs text-clay mt-0.5'>Configure checklist-generating, tag-effect buttons scoped by Category/Relationship</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => setView('tabSettings')}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-primary/10 flex items-center justify-center shrink-0'>
                      <LayoutGrid className='h-4 w-4 text-action-primary' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Patient Tabs</p>
                      <p className='text-xs text-clay mt-0.5'>Show, hide, and reorder the tabs shown inside a patient</p>
                    </div>
                  </button>
                </div>
              </div>
              {/* App */}
              <div className='space-y-2'>
                <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>App</p>
                <div className='flex flex-col gap-2'>
                  <button
                    type='button'
                    onClick={() => setShowOnboarding(true)}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-blush-sand flex items-center justify-center shrink-0 border border-clay/20'>
                      <Info className='h-4 w-4 text-clay' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Show onboarding / install</p>
                      <p className='text-xs text-clay mt-0.5'>Reopen the welcome screen and app install prompt</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => void addSamplePatient()}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-blush-sand flex items-center justify-center shrink-0 border border-clay/20'>
                      <UserRound className='h-4 w-4 text-clay' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Add sample patient</p>
                      <p className='text-xs text-clay mt-0.5'>Load a demo patient (Juan Dela Cruz) with sample data</p>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => window.open('https://github.com/CSfromCS/PortableEletronicHealthRecord/issues/new/choose', '_blank', 'noopener,noreferrer')}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blush-sand/50 hover:bg-blush-sand border border-clay/20 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-blush-sand flex items-center justify-center shrink-0 border border-clay/20'>
                      <ChevronRight className='h-4 w-4 text-clay' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-espresso'>Send feedback</p>
                      <p className='text-xs text-clay mt-0.5'>Report issues or suggest features on GitHub</p>
                    </div>
                  </button>
                </div>
              </div>

            <section className='rounded-xl border border-clay/25 bg-blush-sand/40 overflow-hidden'>
              {/* Header */}
              <div className='px-4 py-3 border-b border-clay/20 flex items-center gap-2 bg-blush-sand/60'>
                <Info className='h-4 w-4 text-action-primary shrink-0' />
                <h3 className='text-sm font-bold text-espresso'>How to use PUHRR</h3>
              </div>

              {/* Getting started */}
              <div className='px-4 py-3 space-y-2.5 border-b border-clay/15'>
                <p className='text-[10px] font-extrabold uppercase tracking-widest text-clay/55'>Getting started</p>
                <ol className='space-y-2'>
                  {([
                    ['Add a patient', 'Fill in the form on the Patients tab (room, name, age, sex, main service) and tap Add patient.'],
                    ['Open a patient', 'Tap Open on any patient card to enter the patient view with all clinical tabs.'],
                    ['Navigate on mobile', 'The bottom bar shows your visible patient tabs in a scrollable row — swipe or tap to switch. Use ← Back to return to the patient list.'],
                    ['Customize your tabs', 'Go to Settings → Patient Tabs to hide tabs you don\'t use and drag the rest into your preferred order. Hiding a tab only hides it — the data underneath is never deleted.'],
                    ['Switch patients', 'Tap the patient name at the top of any tab to jump to a different active patient while staying on the same section. On mobile, swipe left or right anywhere on the patient view to move to the next or previous patient (by room number order) instead. Discharged patients are hidden from this quick-switch list, and you can scroll through the list when many active patients are present.'],
                    ['Write daily notes', 'Open Problems, pick today\'s date, and add one block per problem with a title and free-text notes. Drag blocks to set their priority. Unresolved problems carry forward to the next date automatically — mark one Resolved once it no longer needs tracking. Tap Copy latest entry to copy the previous problem blocks in order, assessment, and plan.'],
                    ['Track a daily checklist', 'Open Checklist, add short tasks for the date, and check them off as you go. Pending items carry forward automatically to the next date; completed items move to the bottom. Drag any item to override that order.'],
                    ['Review all checklist items', 'Open Checklist from the main navigation to see checklist items for active patients on one date, including pending and completed entries with Created/Completed dates shown in short format (e.g., Feb 10). Completing an item moves it to the bottom; reopening it moves it before the first completed item. Drag any item to override that order.'],
                    ['Generate reports', 'Open Report, configure filters, tap any export button to preview, then Copy full text to paste into a handoff or chart.'],
                    ['Back up your data', 'Go to Settings → Export backup regularly, especially before switching devices or browsers.'],
                  ] as [string, string][]).map(([title, detail], i) => (
                    <li key={i} className='flex gap-2.5 items-start'>
                      <span className='shrink-0 w-5 h-5 rounded-full bg-action-primary/15 text-action-primary text-[10px] font-bold flex items-center justify-center mt-0.5'>{i + 1}</span>
                      <span className='text-xs text-espresso leading-relaxed'><strong>{title}:</strong> {detail}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Patient tabs quick reference */}
              <div className='px-4 py-3 space-y-2.5 border-b border-clay/15'>
                <p className='text-[10px] font-extrabold uppercase tracking-widest text-clay/55'>Patient tabs</p>
                <p className='text-[11px] text-clay'>Shown in your current order — hidden tabs are omitted. Change this in Settings → Patient Tabs.</p>
                <div className='grid grid-cols-2 gap-1.5'>
                  {visiblePatientTabs.map((tab) => (
                    <div key={tab} className='rounded-lg bg-warm-ivory border border-clay/20 px-2.5 py-2'>
                      <p className='text-xs font-bold text-espresso'>{PATIENT_TAB_LABELS[tab]}</p>
                      <p className='text-[11px] text-clay leading-snug mt-0.5'>{PATIENT_TAB_DESCRIPTIONS[tab]}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick tips */}
              <div className='px-4 py-3 space-y-2.5 border-b border-clay/15'>
                <p className='text-[10px] font-extrabold uppercase tracking-widest text-clay/55'>Quick tips</p>
                <ul className='space-y-2'>
                  {([
                    'Install to home screen for offline use and full-screen mode: Android → Chrome ⋮ menu → Install app; iPhone/iPad → Safari Share → Add to Home Screen.',
                    'Blood Chemistry: enter ULN for AST/ALT/bilirubin/LDH/D-Dimer/ESR/CRP to auto-show ×ULN; enter normal range for TSH/FT4/FT3.',
                    'ABG: pO2/FiO2 is auto-calculated from pO2 and Actual FiO2. Desired FiO2 only appears when FiO2 > 21% or pO2 < 60 mmHg.',
                    'Report Labs: two entries from the same lab template are auto-compared, except Others entries which are always shown as separate plain results.',
                    'Type @ in any text field to link a photo by title — tap the highlighted @title to open the photo viewer.',
                    'Large note text boxes include an expand button when content overflows; tap again to collapse back to default height.',
                    'Problems exports preserve problem and checklist order and include a daily vitals range line (BP, HR, RR, Temp, SpO2%) for the selected date.',
                    'All patient exports: select and reorder active patients before generating Multiple Census or Multiple Vitals.',
                    'Photos: upload multiple images at once — they are grouped into one block and keep your picker selection order. Tap the block to open a carousel, then use < / >, keyboard arrows, Home/End, thumbnails, or swipe the thumbnail row on phone to jump quickly in large sets.',
                    'Settings → Review all photos lets you find linked/orphan photos and reassign, delete, or export each photo.',
                    'Meds: use the drag handle to match medication order with the standing order sheet (on mobile, press and hold then drag).',
                    'Orders: use Edit on any order to update its status (active, carried out, discontinued) or remove it.',
                    'The report preview popup supports manual text selection — select only what you need, or use Copy full text.',
                  ] as string[]).map((tip, i) => (
                    <li key={i} className='flex gap-2 items-start text-xs text-espresso'>
                      <span className='text-action-primary font-bold shrink-0 mt-px leading-relaxed'>›</span>
                      <span className='leading-relaxed'>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Sync between devices */}
              <div className='px-4 py-3 space-y-2.5 border-b border-clay/15'>
                <p className='text-[10px] font-extrabold uppercase tracking-widest text-clay/55'>Sync between devices</p>
                <ol className='space-y-2'>
                  {([
                    ['Prepare both devices', 'Open PUHRR on both devices and make sure both are connected to the internet during sync.'],
                    ['Set up sync once', 'Tap the sync button (bottom-right in the mobile footer, top-right on desktop). Enter the same Room key on both devices, then type your Name and a Device name (recommended default: Phone). Keep each device name unique (example: Phone, Clerk-Laptop) so you can identify which device pushed each sync.'],
                    ['Edit sync identity', 'Open Settings → Edit sync settings any time to change this device\'s room code, your name, or device name.'],
                    ['Run first sync', 'After setup, PUHRR runs an initial sync. Wait for the success state before closing the dialog.'],
                    ['Understand first sync choices', 'If a room already has data and this device has never synced, PUHRR asks you to pick Upload this device or Download room data first. It will not auto-overwrite.'],
                    ['Check sync status', 'Open Settings → Sync Status to confirm latest room upload time, which device uploaded it, and whether this device has local unsynced changes.'],
                    ['Sync during rounds', 'Tap Sync from the footer (phone) or header (desktop) whenever you finish key edits or before switching devices. Button states: Synced, ↑ Push ready, ↓ Updates available, ⚠ Conflict, or Syncing.'],
                    ['If conflict appears', 'A version picker opens whenever remote data is newer and this device also changed since the last sync. Choose a room version or keep local. Choosing an older version restores it and uploads it as the room’s latest snapshot.'],
                    ['If sync cannot connect', 'PUHRR stops without uploading when room lookup or conflict checks fail. Check the connection and retry; a failed check is never treated as an empty room.'],
                    ['Keep backup safety', 'Sync includes profile, Problems, vitals, medications, labs, and orders. Photos are excluded. Continue exporting JSON backup regularly from Settings, especially before device/browser changes.'],
                    ['Keep app versions aligned', 'The Problems data format requires the updated app on every linked device. If sync reports an unsupported room version, update PUHRR on both devices before trying again.'],
                  ] as [string, string][]).map(([title, detail], i) => (
                    <li key={i} className='flex gap-2.5 items-start'>
                      <span className='shrink-0 w-5 h-5 rounded-full bg-action-primary/15 text-action-primary text-[10px] font-bold flex items-center justify-center mt-0.5'>{i + 1}</span>
                      <span className='text-xs text-espresso leading-relaxed'><strong>{title}:</strong> {detail}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Data & saving */}
              <div className='px-4 py-3 space-y-2.5'>
                <p className='text-[10px] font-extrabold uppercase tracking-widest text-clay/55'>Data & saving</p>
                <ul className='space-y-2'>
                  {([
                    'All data is stored locally on this device by default. Internet is only needed when you choose to use Sync.',
                    'Profile, daily notes, vitals, and orders auto-save a moment after you stop typing.',
                    'Photos are compressed and stored in the app; they are excluded from JSON backup exports.',
                    'Import backup replaces text tables only and keeps all photos currently stored on this device.',
                    'Use the Save now button in the footer to force-save all pending changes immediately.',
                    'Data persists across page refreshes and browser restarts on the same browser profile.',
                    'Export backup JSON regularly when switching devices or browsers to avoid data loss.',
                  ] as string[]).map((item, i) => (
                    <li key={i} className='flex gap-2 items-start text-xs text-espresso'>
                      <span className='text-action-primary font-bold shrink-0 mt-px leading-relaxed'>›</span>
                      <span className='leading-relaxed'>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <p className='text-sm text-clay'>Version: v{__APP_VERSION__} ({__GIT_SHA__})</p>
            </CardContent>
          </Card>
        )}

        <Dialog open={!!outputPreview} onOpenChange={(open) => { if (!open) closeCopyModal() }}>
          <DialogContent className='flex flex-col gap-3 p-4 w-[95vw] max-w-[95vw] h-[80vh] max-h-[80vh] md:w-[90vw] md:max-w-5xl md:h-[88vh] md:max-h-[88vh]'>
            <DialogHeader>
              <DialogTitle>{outputPreviewTitle}</DialogTitle>
            </DialogHeader>
            <p className='text-sm text-clay'>Select any part manually, or tap Copy full text.</p>
            <div className='flex gap-2 flex-wrap'>
              {canUseWebShare ? (
                <Button variant='secondary' onClick={() => void sharePreviewText()}>Share</Button>
              ) : null}
              <Button
                variant='secondary'
                onClick={() => void copyPreviewToClipboard()}
                style={clipboardCopied ? { backgroundColor: '#16a34a', color: '#ffffff', borderColor: '#16a34a' } : undefined}
                className='transition-all duration-300'
              >
                {clipboardCopied ? (
                  <><CheckCircle2 className='h-4 w-4 mr-1.5' />Copied!</>
                ) : (
                  'Copy full text'
                )}
              </Button>
              {showOutputPreviewExpand ? (
                <Button variant='secondary' onClick={toggleOutputPreviewExpanded}>
                  {isOutputPreviewExpanded ? (
                    <><Minimize2 className='h-4 w-4 mr-1.5' />Collapse</>
                  ) : (
                    <><Expand className='h-4 w-4 mr-1.5' />Expand</>
                  )}
                </Button>
              ) : null}
              <Button variant='destructive' onClick={closeCopyModal}>Close</Button>
            </div>
            <textarea
              ref={outputPreviewTextareaRef}
              className={cn(
                'flex-1 min-h-0 w-full h-25 font-mono bg-white/90 resize-none p-3 rounded-lg border border-clay/30 text-sm overflow-auto leading-relaxed transition-[height] duration-200 ease-in-out',
                isOutputPreviewExpanded && 'output-preview-expanded',
              )}
              aria-label='Generated text preview'
              readOnly
              value={outputPreview}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={selectedAttachmentCarouselEntry !== null} onOpenChange={(open) => { if (!open) setSelectedAttachmentId(null) }}>
          <DialogContent
            showCloseButton={false}
            className='flex flex-col gap-0 p-0 border-0 overflow-hidden bg-black w-[95vw] max-w-3xl h-[95vh] max-h-[95vh] md:h-[92vh] md:max-h-[92vh]'
          >
            {selectedAttachmentCarouselEntry ? (
              <div
                className='relative flex-1 min-h-0 flex items-center justify-center overflow-hidden'
                onClick={() => setIsCarouselChromeVisible((previous) => !previous)}
                onTouchStart={handlePhotoSwipeTouchStart}
                onTouchMove={handlePhotoSwipeTouchMove}
                onTouchEnd={handlePhotoSwipeTouchEnd}
                onTouchCancel={resetPhotoSwipe}
              >
                <div
                  ref={photoSwipeVisualRef}
                  className={cn(
                    'flex h-full w-full items-center justify-center',
                    photoSwipeTransitionOn && 'transition-transform duration-200 ease-out',
                  )}
                  style={photoSwipeReleaseActive ? { transform: `translateX(${photoSwipeOffsetX}px)`, opacity: photoSwipeOpacityForOffset(photoSwipeOffsetX) } : undefined}
                >
                  {carouselPreviewUrls[selectedAttachmentCarouselEntry.id] ? (
                    <img
                      src={carouselPreviewUrls[selectedAttachmentCarouselEntry.id]}
                      alt={selectedAttachmentCarouselEntry.title || 'Attachment preview'}
                      className='max-h-full max-w-full object-contain'
                    />
                  ) : (
                    <p className='text-sm text-white/70'>Preview unavailable.</p>
                  )}
                </div>

                {isCarouselChromeVisible ? (
                  <div
                    className='absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent'
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type='button'
                      aria-label='Close'
                      className='h-9 w-9 shrink-0 rounded-full bg-black/45 text-white flex items-center justify-center'
                      onClick={() => setSelectedAttachmentId(null)}
                    >
                      <ChevronLeft className='h-5 w-5' />
                    </button>
                    <p className='flex-1 min-w-0 truncate text-center text-sm font-medium text-white'>
                      {`[${formatPhotoCategory(selectedAttachmentCarouselEntry.category)}] ${selectedAttachmentCarouselEntry.title || 'Untitled'}`}
                    </p>
                    <button
                      type='button'
                      aria-label='Remove from app'
                      className='h-9 w-9 shrink-0 rounded-full bg-black/45 text-white flex items-center justify-center'
                      onClick={() => requestDeleteConfirmation({
                        title: 'Delete photo?',
                        message: 'Permanently remove this photo from the app record?',
                        onConfirm: () => deletePhotoAttachment(selectedAttachmentCarouselEntry.id),
                      })}
                    >
                      <Trash2 className='h-4.5 w-4.5' />
                    </button>
                  </div>
                ) : null}

                {isCarouselChromeVisible && selectedAttachmentCarousel && selectedAttachmentCarousel.entries.length > 1 ? (
                  <div
                    className='absolute inset-x-0 bottom-0 space-y-2 p-3 bg-gradient-to-t from-black/70 to-transparent'
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <Button
                        variant='secondary'
                        size='sm'
                        onClick={() => moveCarousel('previous')}
                        aria-label='Previous photo'
                      >
                        {'<'}
                      </Button>
                      <p className='text-xs text-white'>
                        {selectedAttachmentCarousel.currentIndex + 1} of {selectedAttachmentCarousel.entries.length}
                      </p>
                      <Button
                        variant='secondary'
                        size='sm'
                        onClick={() => moveCarousel('next')}
                        aria-label='Next photo'
                      >
                        {'>'}
                      </Button>
                    </div>
                    <div className='w-full overflow-x-auto overflow-y-hidden rounded border border-white/20 bg-black/40 touch-pan-x' data-no-swipe>
                      <div className='flex w-max min-w-full gap-1.5 p-1.5'>
                        {selectedAttachmentCarousel.entries.map((entry, index) => {
                          const previewUrl = carouselPreviewUrls[entry.id]
                          const isActive = index === selectedAttachmentCarousel.currentIndex

                          return (
                            <button
                              key={`carousel-thumb-${entry.id}`}
                              type='button'
                              ref={(element) => {
                                if (element) {
                                  carouselThumbnailButtonRefs.current[entry.id] = element
                                  return
                                }

                                delete carouselThumbnailButtonRefs.current[entry.id]
                              }}
                              className={cn(
                                'h-14 w-14 shrink-0 overflow-hidden rounded border transition-colors',
                                isActive ? 'border-action-primary ring-1 ring-action-primary/40' : 'border-white/25 hover:border-white/50',
                              )}
                              aria-label={`Jump to photo ${index + 1}`}
                              onClick={() => jumpToCarouselIndex(index)}
                            >
                              {previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt={entry.title || `Photo ${index + 1}`}
                                  className='h-full w-full object-cover'
                                  loading='lazy'
                                />
                              ) : (
                                <div className='h-full w-full bg-warm-ivory' />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={showPhotoReviewDialog} onOpenChange={setShowPhotoReviewDialog}>
          <DialogContent className='flex flex-col gap-3 p-4 w-[95vw] max-w-5xl h-[85vh] max-h-[85vh]'>
            <DialogHeader>
              <DialogTitle>Review all photos</DialogTitle>
            </DialogHeader>
            <div className='flex items-start justify-between gap-2 flex-wrap'>
              <p className='text-sm text-clay'>Review linked and orphan photos across all patients. Reassign, delete, or export any photo.</p>
              <Button
                size='sm'
                variant='secondary'
                onClick={toggleReviewPhotoViewMode}
                aria-label={reviewPhotoViewMode === 'collapsed' ? 'Switch to expanded photo view' : 'Switch to collapsed photo view'}
              >
                {reviewPhotoViewMode === 'collapsed' ? (
                  <><LayoutGrid className='h-4 w-4 mr-1.5' />Expanded</>
                ) : (
                  <><Layers className='h-4 w-4 mr-1.5' />Collapsed</>
                )}
              </Button>
            </div>
            <ScrollArea className='flex-1 min-h-0 rounded border border-clay/25 bg-warm-ivory p-2'>
              {reviewPhotoViewMode === 'collapsed' ? (
                reviewablePhotoGroups.length > 0 ? (
                  <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2'>
                    {reviewablePhotoGroups.map((group) => {
                      const coverPhoto = group.entries[0]
                      const previewUrl = allAttachmentPreviewUrls[coverPhoto.id]
                      const linkedPatient = patientsById.get(group.patientId)
                      const photoCount = group.entries.length

                      return (
                        <div key={group.groupId} className='rounded-md border border-clay/40 bg-white p-1.5 space-y-1'>
                          <button
                            type='button'
                            className='relative w-full overflow-hidden rounded border border-clay/30 bg-warm-ivory'
                            onClick={() => openReviewPhotoById(coverPhoto.id)}
                          >
                            {previewUrl ? (
                              <img
                                src={previewUrl}
                                alt={coverPhoto.title || `Attachment ${formatPhotoCategory(coverPhoto.category)}`}
                                className='h-28 w-full object-cover'
                                loading='lazy'
                              />
                            ) : (
                              <div className='h-28 flex items-center justify-center text-xs text-clay'>No preview</div>
                            )}
                            <span className='absolute right-1.5 top-1.5 rounded-full bg-espresso/85 px-1.5 py-0.5 text-[11px] font-semibold text-white'>
                              {photoCount}
                            </span>
                          </button>
                          <p className='text-xs text-espresso line-clamp-2'>
                            {coverPhoto.title || '(No title)'}
                          </p>
                          <p className='text-[11px] text-clay'>
                            {formatPhotoCategory(coverPhoto.category)} • {formatBytes(group.totalByteSize)}
                          </p>
                          <p className='text-[11px] text-clay truncate'>
                            {linkedPatient ? `${linkedPatient.roomNumber} — ${linkedPatient.lastName}, ${linkedPatient.firstName}` : 'Orphan (no linked patient)'}
                          </p>
                          <Button size='sm' variant='destructive' className='w-full' onClick={() => requestDeleteConfirmation({
                            title: 'Delete photo set?',
                            message: `Permanently remove ${group.entries.length === 1 ? 'this photo' : `these ${group.entries.length} photos`} from the app record?`,
                            onConfirm: () => deletePhotoAttachmentGroup(group),
                          })}>
                            Remove set
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className='h-full min-h-56 flex flex-col items-center justify-center text-center'>
                    <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                      <Camera className='h-6 w-6 text-clay' />
                    </div>
                    <p className='text-sm font-medium text-espresso'>No photos stored yet</p>
                    <p className='text-xs text-clay mt-1'>Photos added in patient records will appear here.</p>
                  </div>
                )
              ) : reviewablePhotoAttachments.length > 0 ? (
                <div className='space-y-2'>
                  {reviewablePhotoAttachments.map((attachment) => {
                    const linkedPatient = patientsById.get(attachment.patientId)
                    const isOrphan = !linkedPatient
                    const previewUrl = allAttachmentPreviewUrls[attachment.id]
                    const selectedTarget = reassignTargetsByAttachmentId[attachment.id] ?? (linkedPatient ? `${linkedPatient.id}` : 'none')

                    return (
                      <div key={`review-photo-${attachment.id}`} className='rounded-lg border border-clay/30 bg-white p-2.5 space-y-2'>
                        <div className='flex items-start justify-between gap-2'>
                          <div>
                            <p className='text-sm font-semibold text-espresso'>{attachment.title || `(No title) #${attachment.id}`}</p>
                            <p className='text-xs text-clay'>
                              {formatPhotoCategory(attachment.category)} • {formatBytes(attachment.byteSize)} • {new Date(attachment.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <Badge
                            variant={isOrphan ? 'destructive' : 'secondary'}
                            className={isOrphan ? 'bg-action-danger/90 text-white border-action-danger/90' : 'bg-action-edit/15 text-action-edit border-action-edit/30'}
                          >
                            {isOrphan ? 'Orphan' : 'Linked'}
                          </Badge>
                        </div>

                        <div className='grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-2'>
                          <button
                            type='button'
                            className='rounded border border-clay/25 bg-warm-ivory overflow-hidden h-30'
                            onClick={() => openReviewPhotoById(attachment.id)}
                          >
                            {previewUrl ? (
                              <img
                                src={previewUrl}
                                alt={attachment.title || 'Photo preview'}
                                className='h-full w-full object-cover'
                                loading='lazy'
                              />
                            ) : (
                              <div className='h-full w-full flex items-center justify-center text-xs text-clay'>No preview</div>
                            )}
                          </button>
                          <div className='space-y-2'>
                            <p className='text-xs text-espresso'>
                              {linkedPatient
                                ? `Current patient: ${linkedPatient.roomNumber} — ${linkedPatient.lastName}, ${linkedPatient.firstName}`
                                : `Current patient link missing (patientId ${attachment.patientId})`}
                            </p>
                            <div className='grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end'>
                              <div className='space-y-1'>
                                <Label className='text-xs'>Reassign to patient</Label>
                                <Select
                                  value={selectedTarget}
                                  onValueChange={(value) => setPhotoReassignTarget(attachment.id, value)}
                                >
                                  <SelectTrigger aria-label={`Reassign photo ${attachment.id}`}>
                                    <SelectValue placeholder='Select patient' />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value='none'>Select patient</SelectItem>
                                    {(patients ?? [])
                                      .filter((patient): patient is Patient & { id: number } => patient.id !== undefined)
                                      .map((patient) => (
                                        <SelectItem key={`reassign-${attachment.id}-${patient.id}`} value={`${patient.id}`}>
                                          {patient.roomNumber} — {patient.lastName}, {patient.firstName}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                size='sm'
                                variant='edit'
                                disabled={selectedTarget === 'none' || (linkedPatient?.id !== undefined && `${linkedPatient.id}` === selectedTarget)}
                                onClick={() => void reassignPhotoAttachment(attachment)}
                              >
                                Reassign
                              </Button>
                              <Button size='sm' variant='secondary' onClick={() => exportPhotoAttachment(attachment)}>
                                Export
                              </Button>
                              <Button size='sm' variant='destructive' onClick={() => requestDeleteConfirmation({
                                title: 'Delete photo?',
                                message: 'Permanently remove this photo from the app record?',
                                onConfirm: () => deletePhotoAttachment(attachment.id),
                              })}>
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className='h-full min-h-56 flex flex-col items-center justify-center text-center'>
                  <div className='h-12 w-12 rounded-full bg-blush-sand flex items-center justify-center mb-3'>
                    <Camera className='h-6 w-6 text-clay' />
                  </div>
                  <p className='text-sm font-medium text-espresso'>No photos stored yet</p>
                  <p className='text-xs text-clay mt-1'>Photos added in patient records will appear here.</p>
                </div>
              )}
            </ScrollArea>
            <div className='flex justify-end'>
              <Button variant='secondary' onClick={() => setShowPhotoReviewDialog(false)}>Close</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={copyLatestConfirmOpen} onOpenChange={(open) => { if (!open) closeCopyLatestConfirm() }}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle>Confirm copy latest entry</DialogTitle>
            </DialogHeader>
            <p className='text-sm text-espresso text-center'>
              Are you sure you want to delete the current entry in
              <strong className='block text-center'>{dailyDate}</strong>
              and replace it with a duplicate of
              <strong className='block text-center'>{pendingLatestDailyUpdate?.date ?? '-'}?</strong>
              <span className='mt-2 block text-xs text-clay'>Completed checklist items stay on their original date and are not copied.</span>
            </p>
            <div className='flex gap-2 flex-wrap justify-center'>
              <Button variant='destructive' onClick={confirmCopyLatestDailyUpdate}>Yes, replace entry</Button>
              <Button variant='secondary' onClick={closeCopyLatestConfirm}>Cancel</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteDailyConfirmOpen} onOpenChange={(open) => { if (!open) closeDeleteDailyConfirm() }}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle>Confirm delete daily entry</DialogTitle>
            </DialogHeader>
            <p className='text-sm text-espresso text-center'>
              Are you sure you want to delete the daily entry for
              <strong className='block text-center'>{pendingDeleteDailyUpdate?.date ?? dailyDate}?</strong>
            </p>
            <div className='flex gap-2 flex-wrap justify-center'>
              <Button variant='destructive' onClick={() => void confirmDeleteDailyUpdate()}>Yes, delete entry</Button>
              <Button variant='secondary' onClick={closeDeleteDailyConfirm}>Cancel</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={pendingDeleteAction !== null} onOpenChange={(open) => { if (!open) closeDeleteConfirmation() }}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle>{pendingDeleteAction?.title ?? 'Confirm delete'}</DialogTitle>
            </DialogHeader>
            <p className='text-sm text-espresso text-center'>{pendingDeleteAction?.message}</p>
            <div className='flex gap-2 flex-wrap justify-center'>
              <Button variant='destructive' onClick={() => void confirmPendingDelete()}>{pendingDeleteAction?.confirmLabel ?? 'Delete'}</Button>
              <Button variant='secondary' onClick={closeDeleteConfirmation}>Cancel</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={customActionResolveState !== null} onOpenChange={(open) => { if (!open) setCustomActionResolveState(null) }}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle>"{customActionResolveState?.action.name}" didn't match this patient</DialogTitle>
            </DialogHeader>
            <p className='text-sm text-espresso'>
              {customActionResolveState ? formatPatientLabelForNotice(customActionResolveState.patient) : ''} doesn't currently satisfy any
              condition for this action, so nothing was run. Add the missing tag(s) for one condition to run it now, or skip.
            </p>
            <div className='flex flex-col gap-1.5'>
              {customActionResolveState ? (() => {
                const state = customActionResolveState
                if (state.action.conditions.length === 0) {
                  return <p className='text-xs text-clay'>No conditions are defined for this action yet.</p>
                }
                return state.action.conditions.map((condition) => {
                  const missingTagIds = getMissingTagsForCondition(state.patient, condition)
                  if (missingTagIds.length === 0) return null
                  const missingTagNames = missingTagIds.map((tagId) => tagsById.get(tagId)?.name ?? 'a deleted tag')
                  return (
                    <Button
                      key={condition.id}
                      variant='outline'
                      className='h-auto justify-start whitespace-normal py-2 text-left text-sm'
                      onClick={() => void resolveCustomActionByAddingTags(condition)}
                    >
                      Add {missingTagNames.join(' + ')} and run
                    </Button>
                  )
                })
              })() : null}
            </div>
            <div className='flex justify-end gap-2 pt-1'>
              <Button variant='ghost' onClick={() => setCustomActionResolveState(null)}>Skip patient</Button>
            </div>
          </DialogContent>
        </Dialog>

        <SyncSetupDialog
          open={syncSetupOpen}
          title={syncSetupMode === 'edit' ? 'Edit sync settings' : 'Set up sync'}
          submitLabel={syncSetupMode === 'edit' ? 'Update & Sync' : 'Save & Sync'}
          initialRoomCode={syncConfig?.roomCode ?? ''}
          initialUsername={syncConfig?.username ?? ''}
          initialDeviceName={syncConfig?.deviceName ?? 'Phone'}
          onOpenChange={setSyncSetupOpen}
          onSubmit={handleSyncSetupSubmit}
        />

        <VersionPickerDialog
          open={syncConflictOpen}
          mode={syncConflictMode}
          versions={conflictVersions}
          localDeviceTag={syncConfig?.deviceTag ?? 'local-device'}
          localVersionMeta={localConflictVersionMeta}
          selectedVersion={selectedConflictVersion}
          onSelectVersion={setSelectedConflictVersion}
          onResolve={resolveSyncConflict}
          onOpenChange={setSyncConflictOpen}
          isResolving={isSyncBusy}
        />

        <Dialog open={showOnboarding} onOpenChange={setShowOnboarding}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <div className='flex justify-center mb-3'>
                <img src="/assets/puhr-v1/puhr-v1.svg" alt="PUHRR" className='h-16 w-16' />
              </div>
              <DialogTitle className='text-center text-2xl text-espresso'>Welcome to PUHRR</DialogTitle>
            </DialogHeader>
            <p className='text-center text-base font-medium text-espresso leading-relaxed'>
              Track patients, capture vitals, organize labs, meds, and orders &mdash; all offline, right from your phone. No account needed. Your data stays on this device.
            </p>
            <div className='mt-1 rounded-lg border border-clay/40 bg-warm-ivory p-3 text-xs text-clay'>
              <h4 className='font-medium text-clay'>Highly Recommended: Add to Home Screen</h4>
              <p className='mt-1 pl-2 space-y-1'>Bigger screen space. No downloads required.</p>
              {isStandaloneDisplayMode ? (
                <p className='mt-1'>PUHRR is already running in installed app mode.</p>
              ) : mobileInstallPlatform === 'android' ? (
                <ol className='mt-1 list-decimal pl-5 space-y-1'>
                  <li>For Android phone: Open this site on a browser.</li>
                  <li>Tap the browser menu (⋮), then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                  <li>Confirm Install/Add, then launch PUHRR from your home screen.</li>
                </ol>
              ) : mobileInstallPlatform === 'ios' ? (
                <ol className='mt-1 list-decimal pl-5 space-y-1'>
                  <li>Open this site in Safari on iPhone or iPad.</li>
                  <li>Tap <strong>Share</strong> (square with arrow up), then tap <strong>Add to Home Screen</strong>.</li>
                  <li>Tap <strong>Add</strong>, then open PUHRR from your home screen.</li>
                </ol>
              ) : (
                <div className='mt-1 space-y-1'>
                  <p>Android (Chrome): menu (⋮) &rarr; <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
                  <p>iPhone/iPad (Safari): <strong>Share</strong> &rarr; <strong>Add to Home Screen</strong>.</p>
                </div>
              )}
            </div>            
            <p className='text-center text-sm text-clay'>
              Start by adding your first patient<br />or exploring the sample record.
            </p>
            <div className='flex flex-col gap-2 mt-2'>
              <Button onClick={() => setShowOnboarding(false)}>
                Add Your First Patient
              </Button>
              <Button variant='secondary' onClick={() => { void addSamplePatient(); setShowOnboarding(false) }}>
                Try a Sample Patient
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <PatientFilterDialog
          open={patientListFilterDialogOpen}
          onOpenChange={setPatientListFilterDialogOpen}
          title='Filter patients'
          tags={tagDefinitions ?? []}
          groups={tagGroups ?? []}
          wards={distinctWards}
          filter={patientListFilter}
          onChangeFilter={setPatientListFilter}
          onClear={() => setPatientListFilter({ ...EMPTY_TAG_WARD_FILTER, tagMode: patientListFilter.tagMode })}
        />

        <PatientFilterDialog
          open={checklistFilterDialogOpen}
          onOpenChange={setChecklistFilterDialogOpen}
          title='Filter Master Checklist'
          tags={tagDefinitions ?? []}
          groups={tagGroups ?? []}
          wards={distinctWards}
          filter={checklistFilter}
          onChangeFilter={setChecklistFilter}
          onClear={() => setChecklistFilter({ ...EMPTY_TAG_WARD_FILTER, tagMode: checklistFilter.tagMode })}
        />

        <PatientFilterDialog
          open={censusFilterDialogOpen}
          onOpenChange={setCensusFilterDialogOpen}
          title='Filter census patients'
          tags={tagDefinitions ?? []}
          groups={tagGroups ?? []}
          wards={distinctWards}
          filter={censusFilter}
          onChangeFilter={setCensusFilter}
          pool={{
            criteria: censusPoolCriteria,
            onChangeCriteria: setCensusPoolCriteria,
            useWindow: censusPoolUseWindow,
            onChangeUseWindow: setCensusPoolUseWindow,
            window: censusPoolWindow,
            onChangeWindow: setCensusPoolWindow,
            defaults: censusPoolWindowDefaults,
          }}
          onClear={() => {
            setCensusFilter({ ...EMPTY_TAG_WARD_FILTER, tagMode: censusFilter.tagMode })
            setCensusPoolCriteria(DEFAULT_PATIENT_POOL_CRITERIA)
            setCensusPoolUseWindow(true)
            setCensusPoolWindow(EMPTY_DATE_TIME_WINDOW)
          }}
        />
      </main>
      <nav className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-clay/25 bg-warm-ivory/97 backdrop-blur-md sm:hidden transition-transform duration-150 ease-out',
        isStandaloneDisplayMode ? 'pb-[calc(0.375rem+env(safe-area-inset-bottom))]' : 'pb-1.5',
        isTextInputFocused ? 'translate-y-full pointer-events-none' : 'translate-y-0',
      )}>
        {view === 'patient' && selectedPatient ? (
          /* Patient tab navigation — horizontally scrollable so it works for any number of visible tabs */
          <div className='flex items-stretch'>
            <button
              className='shrink-0 flex flex-col items-center justify-center gap-0.5 px-2.5 text-clay/70 hover:text-espresso hover:bg-clay/5 border-r border-clay/20 transition-colors'
              onClick={() => setView('patients')}
              aria-label='Back to patients list'
            >
              <ChevronLeft className='h-3.5 w-3.5' />
              <span className='text-[9px] font-bold leading-none'>Back</span>
            </button>
            <div className='flex-1 flex items-stretch gap-0.5 overflow-x-auto p-1'>
              {visiblePatientTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSelectedTab(tab)}
                  className={cn(
                    'shrink-0 flex items-center justify-center px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all duration-150',
                    selectedTab === tab
                      ? 'text-action-primary bg-action-primary/10'
                      : 'text-clay/70 hover:text-espresso hover:bg-clay/5',
                  )}
                >
                  {PATIENT_TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Main navigation — Patients / [Patient] / Settings */
          <div className='mx-auto flex w-full max-w-xl justify-around gap-1 px-3 pt-1.5 pb-1'>
            <button
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200',
                view === 'patients'
                  ? 'text-action-primary bg-action-primary/10'
                  : 'text-clay/70 hover:text-espresso hover:bg-clay/5',
              )}
              onClick={() => setView('patients')}
            >
              <Users className='h-5 w-5' />
              <span>Patients</span>
            </button>
            {canShowFocusedPatientNavButton ? (
              <button
                className='flex flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 min-w-0 max-w-[42%] text-clay/70 hover:text-espresso hover:bg-clay/5'
                onClick={() => {
                  if (view !== 'patient' && selectedPatientId !== null) {
                    void loadDailyUpdate(selectedPatientId, dailyDate)
                  }
                  setView('patient')
                }}
              >
                <UserRound className='h-5 w-5' />
                <span className='truncate w-full text-center'>{focusedPatientNavLabel}</span>
              </button>
            ) : null}
            <button
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200',
                view === 'checklist'
                  ? 'text-action-primary bg-action-primary/10'
                  : 'text-clay/70 hover:text-espresso hover:bg-clay/5',
              )}
              onClick={() => setView('checklist')}
            >
              <CheckCircle2 className='h-5 w-5' />
              <span>Checklist</span>
            </button>
            <button
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200',
                view === 'settings' || view === 'manageTags' || view === 'tabSettings' || view === 'manageCustomActions'
                  ? 'text-action-primary bg-action-primary/10'
                  : 'text-clay/70 hover:text-espresso hover:bg-clay/5',
              )}
              onClick={() => setView('settings')}
            >
              <Settings className='h-5 w-5' />
              <span>Settings</span>
            </button>
          </div>
        )}
      </nav>
      <footer className='mt-4 mb-3 border-t border-clay/20 pt-3 text-sm text-clay'>
        <div className='flex items-center justify-between gap-2 flex-wrap'>
          <div className='flex items-center gap-2 flex-wrap min-h-9'>
            {selectedPatientId !== null ? (
              <>
                <p className='text-sm text-clay'>
                  Last saved:{' '}
                  {lastSavedAt
                    ? new Date(lastSavedAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
                <Button variant='secondary' size='sm' disabled={isSaving || !hasUnsavedChanges} onClick={() => void saveAllChanges()}>
                  {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save now' : (
                    <><CheckCircle2 className='h-3.5 w-3.5 text-[#3AA766]' /> Saved</>
                  )}
                </Button>
              </>
            ) : null}
          </div>
          <div className='sm:hidden'>
            <SyncButton
              status={syncButtonStatus}
              onClick={() => void runSyncNow()}
              disabled={isSyncBusy}
              lastSyncedAt={syncConfig?.lastSyncedAt ?? null}
            />
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
