import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
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
import {
  formatClock,
  formatDateMMDD,
  formatDateShortMonthDay,
  formatCalculatedNumber,
  parseNumericInput,
  toLocalISODate,
  toLocalTime,
} from '@/lib/dateTime'
import {
  buildStructuredLabLines,
  formatOrderEntry,
  toCensusEntry,
  toDailySummary,
  toLabsSummary,
  toMedicationsSummary,
  toOrdersSummary,
  toProfileSummary,
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
import {
  PHOTO_CATEGORY_OPTIONS,
  buildDefaultPhotoTitle,
  buildPhotoUploadGroupId,
  compressImageFile,
  formatBytes,
  formatPhotoCategory,
  getPhotoGroupKey,
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
import { Users, UserRound, Settings, HeartPulse, Pill, FlaskConical, ClipboardList, Camera, ChevronLeft, ChevronRight, CheckCircle2, Info, Download, Upload, Trash2, Expand, Minimize2, GripVertical, Pencil } from 'lucide-react'

type PatientFormState = {
  roomNumber: string
  firstName: string
  lastName: string
  age: string
  sex: 'M' | 'F' | 'O'
  service: string
}

const initialForm: PatientFormState = {
  roomNumber: '',
  firstName: '',
  lastName: '',
  age: '',
  sex: 'M',
  service: '',
}

type ProfileFormState = {
  roomNumber: string
  firstName: string
  lastName: string
  age: string
  sex: 'M' | 'F' | 'O'
  service: string
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
}

const initialProfileForm: ProfileFormState = {
  roomNumber: '',
  firstName: '',
  lastName: '',
  age: '',
  sex: 'M',
  service: '',
  diagnosis: '',
  chiefComplaint: '',
  hpiText: '',
  pmhText: '',
  peText: '',
  clinicalSummary: '',
  plans: '',
  medications: '',
  labs: '',
  pendings: '',
  clerkNotes: '',
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
  createdDate: string | null
  completedDate: string | null
  lastFoundDate: string | null
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
  fluid: '',
  respiratory: '',
  infectious: '',
  cardio: '',
  hema: '',
  metabolic: '',
  output: '',
  neuro: '',
  drugs: '',
  other: '',
  assessment: '',
  plans: '',
  checklist: [],
}

const normalizeChecklistItems = (items: DailyChecklistItem[] | undefined) =>
  (items ?? [])
    .map((item) => ({
      text: item.text.trim(),
      completed: Boolean(item.completed),
    }))
    .filter((item) => item.text.length > 0)

const toPendingChecklistItems = (items: DailyChecklistItem[] | undefined) =>
  normalizeChecklistItems(items)
    .filter((item) => !item.completed)
    .map((item) => ({ ...item, completed: false }))

const selectLatestDailyUpdate = (updates: DailyUpdate[]) => {
  if (updates.length === 0) return null

  return updates.reduce((latest, candidate) => {
    if (candidate.date > latest.date) {
      return candidate
    }
    if (candidate.date < latest.date) {
      return latest
    }

    const latestTimestamp = Date.parse(latest.lastUpdated)
    const candidateTimestamp = Date.parse(candidate.lastUpdated)
    if (Number.isFinite(candidateTimestamp) && Number.isFinite(latestTimestamp)) {
      return candidateTimestamp >= latestTimestamp ? candidate : latest
    }

    return candidate
  })
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
  date: toLocalISODate(),
  time: toLocalTime(),
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
  orderDate: toLocalISODate(),
  orderTime: toLocalTime(),
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
  return validVitals && validMedications && validLabs && validOrders
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

const ensurePatientLastModified = (patient: Patient): Patient => {
  return {
    ...patient,
    lastModified: patient.lastModified ?? patient.admitDate ?? new Date().toISOString(),
  }
}

function App() {
  const backupFileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const galleryPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const outputPreviewTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [form, setForm] = useState<PatientFormState>(initialForm)
  const [view, setView] = useState<'patients' | 'patient' | 'checklist' | 'settings'>('patients')
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'discharged' | 'all'>('active')
  const [sortBy, setSortBy] = useState<'room' | 'name' | 'admitDate'>('room')
  const [profileForm, setProfileForm] = useState<ProfileFormState>(initialProfileForm)
  const [dailyDate, setDailyDate] = useState(() => toLocalISODate())
  const [masterChecklistDate, setMasterChecklistDate] = useState(() => toLocalISODate())
  const [dailyUpdateForm, setDailyUpdateForm] = useState<DailyUpdateFormState>(initialDailyUpdateForm)
  const [dailyUpdateId, setDailyUpdateId] = useState<number | undefined>(undefined)
  const [dailyChecklistDraft, setDailyChecklistDraft] = useState('')
  const [editingDailyChecklistItem, setEditingDailyChecklistItem] = useState<{ index: number; text: string } | null>(null)
  const [editingMasterChecklistItem, setEditingMasterChecklistItem] = useState<{ patientId: number; index: number; text: string } | null>(null)
  const [draggingDailyChecklistItemIndex, setDraggingDailyChecklistItemIndex] = useState<number | null>(null)
  const [touchDailyChecklistTargetIndex, setTouchDailyChecklistTargetIndex] = useState<number | null>(null)
  const [draggingMasterChecklistItem, setDraggingMasterChecklistItem] = useState<{ patientId: number; index: number } | null>(null)
  const [touchMasterChecklistTarget, setTouchMasterChecklistTarget] = useState<{ patientId: number; index: number } | null>(null)
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
  const [labTemplateDate, setLabTemplateDate] = useState(() => toLocalISODate())
  const [labTemplateTime, setLabTemplateTime] = useState(() => toLocalTime())
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
  const [selectedTab, setSelectedTab] = useState<'profile' | 'frichmond' | 'vitals' | 'labs' | 'medications' | 'orders' | 'photos' | 'reporting'>('profile')
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
  const [isPhotoSaving, setIsPhotoSaving] = useState(false)
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<number | null>(null)
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<number, string>>({})
  const [allAttachmentPreviewUrls, setAllAttachmentPreviewUrls] = useState<Record<number, string>>({})
  const [showPhotoReviewDialog, setShowPhotoReviewDialog] = useState(false)
  const [reassignTargetsByAttachmentId, setReassignTargetsByAttachmentId] = useState<Record<number, string>>({})
  const [selectedCensusPatientIds, setSelectedCensusPatientIds] = useState<number[]>([])
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

  const activePatients = useMemo(() => (patients ?? []).filter((patient) => patient.status === 'active'), [patients])

  const activePatientIds = useMemo(
    () => activePatients.map((patient) => patient.id).filter((id): id is number => id !== undefined),
    [activePatients],
  )

  const reportingSelectablePatients = useMemo(() => {
    return [...activePatients].sort((a, b) => {
      const byRoom = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
      if (byRoom !== 0) return byRoom
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })
  }, [activePatients])

  useEffect(() => {
    if (activePatientIds.length === 0) {
      setSelectedCensusPatientIds([])
      censusSelectionInitializedRef.current = false
      return
    }

    setSelectedCensusPatientIds((previous) => {
      if (!censusSelectionInitializedRef.current) {
        censusSelectionInitializedRef.current = true
        return activePatientIds
      }

      const activeIdSet = new Set(activePatientIds)
      return previous.filter((id) => activeIdSet.has(id))
    })
  }, [activePatientIds])

  const selectedCensusPatients = useMemo(() => {
    const patientsById = new Map<number, Patient>()
    reportingSelectablePatients.forEach((patient) => {
      if (patient.id === undefined) return
      patientsById.set(patient.id, patient)
    })

    return selectedCensusPatientIds
      .map((id) => patientsById.get(id))
      .filter((patient): patient is Patient => patient !== undefined)
  }, [reportingSelectablePatients, selectedCensusPatientIds])

  const toggleCensusPatientSelection = (patientId: number) => {
    setSelectedCensusPatientIds((previous) =>
      previous.includes(patientId)
        ? previous.filter((id) => id !== patientId)
        : [...previous, patientId],
    )
  }

  const selectAllCensusPatients = () => {
    setSelectedCensusPatientIds(activePatientIds)
  }

  const clearCensusPatientsSelection = () => {
    setSelectedCensusPatientIds([])
  }

  const moveCensusPatientSelection = (patientId: number, direction: 'up' | 'down') => {
    setSelectedCensusPatientIds((previous) => {
      const index = previous.indexOf(patientId)
      if (index < 0) return previous

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= previous.length) return previous

      const next = [...previous]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }

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
      .filter((patient) => patient.status === 'active')
      .sort((a, b) => {
      const byRoom = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
      if (byRoom !== 0) return byRoom
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })

    const items: MasterChecklistItem[] = []
    sortedPatients.forEach((patient) => {
      if (patient.id === undefined) return
      const patientId = patient.id

      const updates = dailyUpdatesByPatient.get(patientId) ?? []
      const priorOrCurrent = updates.filter((entry) => entry.date <= masterChecklistDate)
      if (priorOrCurrent.length === 0) return

      const dateMatchedUpdate = priorOrCurrent.find((entry) => entry.date === masterChecklistDate)
      const sourceUpdate = dateMatchedUpdate ?? selectLatestDailyUpdate(priorOrCurrent)
      if (!sourceUpdate) return

      const scopedChecklist = dateMatchedUpdate
        ? normalizeChecklistItems(sourceUpdate.checklist)
        : toPendingChecklistItems(sourceUpdate.checklist)
      if (scopedChecklist.length === 0) return

      const patientIdentifier = `${patient.roomNumber} — ${patient.lastName.toUpperCase()}`
      const normalizedHistory = priorOrCurrent.map((entry) => ({
        date: entry.date,
        checklist: normalizeChecklistItems(entry.checklist),
      }))

      scopedChecklist.forEach((item, index) => {
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

        items.push({
          patientId,
          patientIdentifier,
          viewDate: masterChecklistDate,
          index,
          text: item.text,
          completed: item.completed,
          createdDate,
          completedDate,
          lastFoundDate,
        })
      })
    })

    return items
  }, [dailyUpdatesByPatient, masterChecklistDate, patients])

  const reviewablePhotoAttachments = useMemo(() => {
    return (photoAttachments ?? [])
      .filter((entry): entry is ReviewablePhotoAttachment => entry.id !== undefined)
      .sort(comparePhotosByNewest)
  }, [photoAttachments])

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

    const grouped = new Map<string, Array<PhotoAttachment & { id: number }>>()
    selectedPatientAllAttachments
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
  }, [selectedAttachmentId, selectedPatientAllAttachments])

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

  const visiblePatients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matchesQuery = (patient: Patient) => {
      if (!query) return true
      return [patient.roomNumber, patient.lastName, patient.firstName, patient.service]
        .join(' ')
        .toLowerCase()
        .includes(query)
    }

    const compareByRoom = (a: Patient, b: Patient) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })

    return (patients ?? [])
      .filter((patient) => (statusFilter === 'all' ? true : patient.status === statusFilter))
      .filter(matchesQuery)
      .sort((a, b) => {
        if (sortBy === 'name') {
          return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
        }
        if (sortBy === 'admitDate') {
          return b.admitDate.localeCompare(a.admitDate)
        }
        return compareByRoom(a, b)
      })
  }, [patients, searchQuery, sortBy, statusFilter])

  const quickSwitchPatients = useMemo(() => {
    const compareByRoom = (a: Patient, b: Patient) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })

    return (patients ?? [])
      .filter((patient) => patient.status === 'active')
      .sort(compareByRoom)
  }, [patients])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const age = Number.parseInt(form.age, 10)
    if (!Number.isFinite(age)) return

    const patientPayload: Omit<Patient, 'id'> = {
      lastModified: new Date().toISOString(),
      roomNumber: form.roomNumber.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      age,
      sex: form.sex,
      service: form.service.trim(),
      diagnosis: '',
      admitDate: toLocalISODate(),
      attendingPhysician: '',
      chiefComplaint: '',
      hpiText: '',
      pmhText: '',
      peText: '',
      clinicalSummary: '',
      plans: '',
      medications: '',
      labs: '',
      pendings: '',
      clerkNotes: '',
      status: 'active',
    }

    await db.patients.add(patientPayload)
    setForm(initialForm)
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
        checklist: toPendingChecklistItems(latestPriorUpdate?.checklist),
      })
      setDailyChecklistDraft('')
      setDailyDirty(false)
      return
    }

    setDailyUpdateId(update.id)
    setDailyUpdateForm({
      fluid: update.fluid,
      respiratory: update.respiratory,
      infectious: update.infectious,
      cardio: update.cardio,
      hema: update.hema,
      metabolic: update.metabolic,
      output: update.output,
      neuro: update.neuro,
      drugs: update.drugs,
      other: update.other,
      assessment: update.assessment,
      plans: update.plans,
      checklist: normalizeChecklistItems(update.checklist),
    })
    setDailyChecklistDraft('')
    setDailyDirty(false)
  }, [])

  const applyDailyUpdateToForm = useCallback((update: DailyUpdate) => {
    setDailyUpdateForm({
      fluid: update.fluid,
      respiratory: update.respiratory,
      infectious: update.infectious,
      cardio: update.cardio,
      hema: update.hema,
      metabolic: update.metabolic,
      output: update.output,
      neuro: update.neuro,
      drugs: update.drugs,
      other: update.other,
      assessment: update.assessment,
      plans: update.plans,
      checklist: toPendingChecklistItems(update.checklist),
    })
    setDailyChecklistDraft('')
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
        await db.patients.update(selectedPatientId, {
          lastModified: new Date().toISOString(),
          roomNumber: profileForm.roomNumber.trim(),
          firstName: profileForm.firstName.trim(),
          lastName: profileForm.lastName.trim(),
          ...(ageIsValid ? { age } : {}),
          sex: profileForm.sex,
          service: profileForm.service.trim(),
          diagnosis: profileForm.diagnosis,
          chiefComplaint: profileForm.chiefComplaint,
          hpiText: profileForm.hpiText,
          pmhText: profileForm.pmhText,
          peText: profileForm.peText,
          clinicalSummary: profileForm.clinicalSummary,
          plans: profileForm.plans,
          medications: profileForm.medications,
          labs: profileForm.labs,
          pendings: profileForm.pendings,
          clerkNotes: profileForm.clerkNotes,
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
      firstName: patient.firstName,
      lastName: patient.lastName,
      age: patient.age.toString(),
      sex: patient.sex,
      service: patient.service,
      diagnosis: patient.diagnosis,
      chiefComplaint: patient.chiefComplaint ?? '',
      hpiText: patient.hpiText ?? '',
      pmhText: patient.pmhText ?? '',
      peText: patient.peText ?? '',
      clinicalSummary: patient.clinicalSummary ?? '',
      plans: patient.plans,
      medications: patient.medications,
      labs: patient.labs,
      pendings: patient.pendings,
      clerkNotes: patient.clerkNotes,
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
    setLabTemplateDate(toLocalISODate())
    setLabTemplateTime(toLocalTime())
    setLabTemplateValues({})
    setLabTemplateNote('')
    setEditingLabId(null)
    setAttachmentCategory('profile')
    setAttachmentFilter('all')
    setAttachmentTitle(buildDefaultPhotoTitle('profile'))
    setSelectedAttachmentId(null)
    if (!options?.preserveSelectedTab) {
      setSelectedTab('profile')
    }
  }

  const toggleDischarge = async (patient: Patient) => {
    if (patient.id === undefined) return
    const discharged = patient.status === 'active'
    await db.patients.update(patient.id, {
      lastModified: new Date().toISOString(),
      status: discharged ? 'discharged' : 'active',
      dischargeDate: discharged ? toLocalISODate() : undefined,
    })
  }

  useEffect(() => {
    if (selectedPatientId === null || !profileDirty || isSaving) return

    const timeoutId = window.setTimeout(() => {
      void saveProfile()
    }, 800)

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

    const currentChecklist = normalizeChecklistItems(entryForDate.checklist)
    const nextChecklist = normalizeChecklistItems(updater(currentChecklist))

    const savedId = await db.dailyUpdates.put({
      ...entryForDate,
      id: existingEntry?.id,
      checklist: nextChecklist,
      lastUpdated: new Date().toISOString(),
    })
    await touchPatientLastModified(patientId)

    return typeof savedId === 'number' ? savedId : existingEntry?.id
  }, [dailyUpdatesByPatient, masterChecklistDate, touchPatientLastModified])

  const addDailyChecklistItem = useCallback(() => {
    const nextText = dailyChecklistDraft.trim()
    if (!nextText) return

    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: [...previous.checklist, { text: nextText, completed: false }],
    }))
    setDailyChecklistDraft('')
    setDailyDirty(true)
  }, [dailyChecklistDraft])

  const updateDailyChecklistItemCompletion = useCallback((index: number, completed: boolean) => {
    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: previous.checklist.map((item, itemIndex) => (
        itemIndex === index ? { ...item, completed } : item
      )),
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
    if (!nextText) return

    setDailyUpdateForm((previous) => ({
      ...previous,
      checklist: previous.checklist.map((item, itemIndex) => (
        itemIndex === index ? { ...item, text: nextText } : item
      )),
    }))
    setDailyDirty(true)
  }, [])

  const requestEditDailyChecklistItem = useCallback((index: number) => {
    const currentItem = dailyUpdateForm.checklist[index]
    if (!currentItem) return

    setEditingDailyChecklistItem({ index, text: currentItem.text })
  }, [dailyUpdateForm.checklist])

  const saveEditedDailyChecklistItem = useCallback(() => {
    if (!editingDailyChecklistItem) return

    updateDailyChecklistItemText(editingDailyChecklistItem.index, editingDailyChecklistItem.text)
    setEditingDailyChecklistItem(null)
  }, [editingDailyChecklistItem, updateDailyChecklistItemText])

  const removeEditedDailyChecklistItem = useCallback(() => {
    if (!editingDailyChecklistItem) return

    removeDailyChecklistItem(editingDailyChecklistItem.index)
    setEditingDailyChecklistItem(null)
  }, [editingDailyChecklistItem, removeDailyChecklistItem])

  const reorderDailyChecklistItem = useCallback((sourceIndex: number, targetIndex: number) => {
    setDailyUpdateForm((previous) => {
      const sourceItem = previous.checklist[sourceIndex]
      const targetItem = previous.checklist[targetIndex]
      if (!sourceItem || !targetItem || sourceIndex === targetIndex || sourceItem.completed !== targetItem.completed) return previous

      const matchingIndices = previous.checklist.reduce<number[]>((accumulator, item, index) => {
        if (item.completed === sourceItem.completed) {
          accumulator.push(index)
        }
        return accumulator
      }, [])
      const sourcePosition = matchingIndices.indexOf(sourceIndex)
      const targetPosition = matchingIndices.indexOf(targetIndex)
      if (sourcePosition < 0 || targetPosition < 0) return previous

      const matchingItems = matchingIndices.map((index) => previous.checklist[index])
      const [movedItem] = matchingItems.splice(sourcePosition, 1)
      matchingItems.splice(targetPosition, 0, movedItem)

      const nextChecklist = [...previous.checklist]
      matchingIndices.forEach((index, itemPosition) => {
        nextChecklist[index] = matchingItems[itemPosition]
      })

      return {
        ...previous,
        checklist: nextChecklist,
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
    if (!sourceItem || !targetItem || sourceItem.completed !== targetItem.completed) {
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
    if (!sourceItem || !targetItem || sourceItem.completed !== targetItem.completed) return

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
    const currentItem = dailyUpdateForm.checklist[index]
    if (!currentItem) return

    const step = direction === 'up' ? -1 : 1
    for (let candidateIndex = index + step; candidateIndex >= 0 && candidateIndex < dailyUpdateForm.checklist.length; candidateIndex += step) {
      if (dailyUpdateForm.checklist[candidateIndex]?.completed === currentItem.completed) {
        reorderDailyChecklistItem(index, candidateIndex)
        return
      }
    }
  }, [dailyUpdateForm.checklist, reorderDailyChecklistItem])

  const renderDailyChecklistItem = useCallback((item: DailyChecklistItem, index: number) => (
    <div
      key={`checklist-${index}`}
      data-daily-checklist-index={index}
      className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${item.completed ? 'border border-clay/20 bg-warm-ivory/70' : 'border border-clay/30 bg-warm-ivory'} ${draggingDailyChecklistItemIndex === index ? 'opacity-60' : ''} ${touchDailyChecklistTargetIndex === index && draggingDailyChecklistItemIndex !== null ? 'ring-2 ring-action-primary/40 ring-offset-1 ring-offset-transparent' : ''}`}
      onDragOver={(event) => allowDailyChecklistDrop(event, index)}
      onDrop={(event) => dropDailyChecklistItem(event, index)}
    >
      <input
        type='checkbox'
        className='mt-1 h-4 w-4 accent-action-primary'
        checked={item.completed}
        onChange={(event) => updateDailyChecklistItemCompletion(index, event.target.checked)}
        aria-label={item.completed ? 'Mark checklist item pending' : 'Mark checklist item complete'}
      />
      <p className={`flex-1 whitespace-pre-wrap text-sm ${item.completed ? 'text-clay line-through' : 'text-espresso'}`}>{item.text}</p>
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
      <Button
        type='button'
        variant='ghost'
        className='h-6 w-6 shrink-0 p-0 text-clay'
        aria-label='Edit checklist item'
        onClick={() => requestEditDailyChecklistItem(index)}
      >
        <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
      </Button>
    </div>
  ), [allowDailyChecklistDrop, cancelDailyChecklistTouchDrag, draggingDailyChecklistItemIndex, dropDailyChecklistItem, endDailyChecklistDrag, endDailyChecklistTouchDrag, moveDailyChecklistItemByDirection, requestEditDailyChecklistItem, startDailyChecklistDrag, startDailyChecklistTouchDrag, touchDailyChecklistTargetIndex, updateDailyChecklistItemCompletion, updateDailyChecklistTouchTarget])

  const updateMasterChecklistItemCompletion = useCallback((patientId: number, index: number, completed: boolean) => {
    void updateMasterChecklist(patientId, (previous) => previous.map((item, itemIndex) => (
      itemIndex === index ? { ...item, completed } : item
    )))
  }, [updateMasterChecklist])

  const removeMasterChecklistItem = useCallback((patientId: number, index: number) => {
    void updateMasterChecklist(patientId, (previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }, [updateMasterChecklist])

  const updateMasterChecklistItemText = useCallback((patientId: number, index: number, text: string) => {
    const nextText = text.trim()
    if (!nextText) return

    void updateMasterChecklist(patientId, (previous) => previous.map((item, itemIndex) => (
      itemIndex === index ? { ...item, text: nextText } : item
    )))
  }, [updateMasterChecklist])

  const moveMasterChecklistItem = useCallback((patientId: number, index: number, direction: 'up' | 'down') => {
    void updateMasterChecklist(patientId, (previous) => {
      const currentItem = previous[index]
      if (!currentItem) return previous

      let swapIndex = -1
      if (direction === 'up') {
        for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
          if (previous[candidateIndex]?.completed === currentItem.completed) {
            swapIndex = candidateIndex
            break
          }
        }
      } else {
        for (let candidateIndex = index + 1; candidateIndex < previous.length; candidateIndex += 1) {
          if (previous[candidateIndex]?.completed === currentItem.completed) {
            swapIndex = candidateIndex
            break
          }
        }
      }

      if (swapIndex < 0) return previous

      const nextChecklist = [...previous]
      ;[nextChecklist[index], nextChecklist[swapIndex]] = [nextChecklist[swapIndex], nextChecklist[index]]
      return nextChecklist
    })
  }, [updateMasterChecklist])

  const reorderMasterChecklistItem = useCallback((patientId: number, sourceIndex: number, targetIndex: number) => {
    void updateMasterChecklist(patientId, (previous) => {
      const sourceItem = previous[sourceIndex]
      const targetItem = previous[targetIndex]
      if (!sourceItem || !targetItem || sourceIndex === targetIndex || sourceItem.completed !== targetItem.completed) return previous

      const matchingIndices = previous.reduce<number[]>((accumulator, item, index) => {
        if (item.completed === sourceItem.completed) {
          accumulator.push(index)
        }
        return accumulator
      }, [])
      const sourcePosition = matchingIndices.indexOf(sourceIndex)
      const targetPosition = matchingIndices.indexOf(targetIndex)
      if (sourcePosition < 0 || targetPosition < 0) return previous

      const matchingItems = matchingIndices.map((index) => previous[index])
      const [movedItem] = matchingItems.splice(sourcePosition, 1)
      matchingItems.splice(targetPosition, 0, movedItem)

      const nextChecklist = [...previous]
      matchingIndices.forEach((index, itemPosition) => {
        nextChecklist[index] = matchingItems[itemPosition]
      })

      return nextChecklist
    })
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
    if (!sourceItem || !targetItem || sourceItem.patientId !== targetItem.patientId || sourceItem.completed !== targetItem.completed) {
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

    const sourceItem = masterChecklistItems.find((item) => (
      item.patientId === draggingMasterChecklistItem.patientId && item.index === draggingMasterChecklistItem.index
    ))
    const targetItem = masterChecklistItems.find((item) => item.patientId === patientId && item.index === targetIndex)
    if (!sourceItem || !targetItem || sourceItem.completed !== targetItem.completed) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [draggingMasterChecklistItem, masterChecklistItems])

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

  const requestEditMasterChecklistItem = useCallback((item: MasterChecklistItem) => {
    setEditingMasterChecklistItem({ patientId: item.patientId, index: item.index, text: item.text })
  }, [])

  const saveEditedMasterChecklistItem = useCallback(() => {
    if (!editingMasterChecklistItem) return

    updateMasterChecklistItemText(
      editingMasterChecklistItem.patientId,
      editingMasterChecklistItem.index,
      editingMasterChecklistItem.text,
    )
    setEditingMasterChecklistItem(null)
  }, [editingMasterChecklistItem, updateMasterChecklistItemText])

  const removeEditedMasterChecklistItem = useCallback(() => {
    if (!editingMasterChecklistItem) return

    removeMasterChecklistItem(editingMasterChecklistItem.patientId, editingMasterChecklistItem.index)
    setEditingMasterChecklistItem(null)
  }, [editingMasterChecklistItem, removeMasterChecklistItem])

  const renderMasterChecklistItem = useCallback((item: MasterChecklistItem, key: string) => (
    <div
      key={key}
      data-master-checklist-patient-id={item.patientId}
      data-master-checklist-index={item.index}
      className={`space-y-1 rounded-md px-2 py-1.5 ${item.completed ? 'border border-clay/20 bg-warm-ivory/70' : 'border border-clay/30 bg-warm-ivory'} ${draggingMasterChecklistItem?.patientId === item.patientId && draggingMasterChecklistItem.index === item.index ? 'opacity-60' : ''} ${touchMasterChecklistTarget?.patientId === item.patientId && touchMasterChecklistTarget.index === item.index && draggingMasterChecklistItem !== null ? 'ring-2 ring-action-primary/40 ring-offset-1 ring-offset-transparent' : ''}`}
      onDragOver={(event) => allowMasterChecklistDrop(event, item.patientId, item.index)}
      onDrop={(event) => dropMasterChecklistItem(event, item.patientId, item.index)}
    >
      <div className='flex items-start gap-2'>
        <input
          type='checkbox'
          className='self-center h-4 w-4 accent-action-primary'
          checked={item.completed}
          onChange={(event) => updateMasterChecklistItemCompletion(item.patientId, item.index, event.target.checked)}
          aria-label={item.completed ? 'Mark checklist item pending' : 'Mark checklist item complete'}
        />
        <div className='flex-1'>
          <p className={`whitespace-pre-wrap text-sm ${item.completed ? 'text-clay line-through' : 'text-espresso'}`}>{item.text}</p>
          <p className='text-[11px] text-clay'>
            {item.createdDate ? `Created: ${formatDateShortMonthDay(item.createdDate)}` : ''}
            {item.lastFoundDate ? ` • Latest: ${formatDateShortMonthDay(item.lastFoundDate)}` : ''}
            {item.completedDate ? ` • Completed: ${formatDateShortMonthDay(item.completedDate)}` : ''}
          </p>
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
          className='self-center h-6 w-6 shrink-0 p-0 text-clay'
          aria-label='Edit checklist item'
          onClick={() => requestEditMasterChecklistItem(item)}
        >
          <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
        </Button>
      </div>
    </div>
    ), [allowMasterChecklistDrop, cancelMasterChecklistTouchDrag, draggingMasterChecklistItem, dropMasterChecklistItem, endMasterChecklistDrag, endMasterChecklistTouchDrag, moveMasterChecklistItem, requestEditMasterChecklistItem, startMasterChecklistDrag, startMasterChecklistTouchDrag, touchMasterChecklistTarget, updateMasterChecklistItemCompletion, updateMasterChecklistTouchTarget])

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
      const title = attachmentTitle.trim() || buildDefaultPhotoTitle(attachmentCategory)
      const uploadGroupId = buildPhotoUploadGroupId()
      const preparedAttachments = await Promise.all(
        files.map(async (file, selectionOrderInGroup) => {
          const compressed = await compressImageFile(file)
          return {
            patientId: selectedPatientId,
            category: attachmentCategory,
            title,
            uploadGroupId,
            selectionOrderInGroup,
            mimeType: compressed.mimeType,
            width: compressed.width,
            height: compressed.height,
            byteSize: compressed.blob.size,
            imageBlob: compressed.blob,
            createdAt: new Date().toISOString(),
          }
        }),
      )

      await db.photoAttachments.bulkAdd(preparedAttachments)
      await touchPatientLastModified(selectedPatientId)

      setAttachmentTitle(buildDefaultPhotoTitle(attachmentCategory))
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
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [dailyDirty, saveDailyUpdate, selectedPatientId])

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
    if (selectedPatientId === null || !vitalForm.date || !vitalForm.time) return

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
    if (editingVitalId === null || !vitalForm.date || !vitalForm.time) return

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
      if (selectedPatientId === null || !vitalForm.date || !vitalForm.time) return false

      setIsSaving(true)

      const payload = {
        date: vitalForm.date,
        time: vitalForm.time,
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
        orderDate: orderForm.orderDate,
        orderTime: orderForm.orderTime,
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
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [isSaving, saveVitalDraft, selectedPatientId, vitalDirty])

  useEffect(() => {
    if (selectedPatientId === null || !orderDirty || isSaving || !orderForm.orderText.trim()) return

    const timeoutId = window.setTimeout(() => {
      void saveOrderDraft()
    }, 800)

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
      time: labTemplateTime || '',
      templateId: selectedLabTemplate.id,
      results: resultsPayload,
      note: labTemplateNote.trim(),
      createdAt: new Date().toISOString(),
    })
    await touchPatientLastModified(selectedPatientId)

    setLabTemplateValues({})
    setLabTemplateNote('')
    setLabTemplateTime(toLocalTime())
    setNotice(`Lab added from ${selectedLabTemplate.name}.`)
  }

  const deleteStructuredLab = async (labId?: number) => {
    if (labId === undefined) return
    await db.labs.delete(labId)
    await touchPatientLastModified(selectedPatientId)
    if (editingLabId === labId) {
      setEditingLabId(null)
      setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
      setLabTemplateDate(toLocalISODate())
      setLabTemplateTime(toLocalTime())
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
      time: labTemplateTime || '',
      templateId: selectedLabTemplate.id,
      results: resultsPayload,
      note: labTemplateNote.trim(),
    })
    await touchPatientLastModified(selectedPatientId)

    setEditingLabId(null)
    setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
    setLabTemplateDate(toLocalISODate())
    setLabTemplateTime(toLocalTime())
    setLabTemplateValues({})
    setLabTemplateNote('')
    setNotice('Lab updated.')
  }

  const cancelEditingLab = () => {
    setEditingLabId(null)
    setSelectedLabTemplateId(DEFAULT_LAB_TEMPLATE_ID)
    setLabTemplateDate(toLocalISODate())
    setLabTemplateTime(toLocalTime())
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
    setLabTemplateDate(toLocalISODate())
    setLabTemplateTime(toLocalTime())
    setLabTemplateValues({})
    setLabTemplateNote('')
    setEditingLabId(null)
    setAttachmentCategory('profile')
    setAttachmentFilter('all')
    setAttachmentTitle(buildDefaultPhotoTitle('profile'))
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
        [db.patients, db.dailyUpdates, db.vitals, db.medications, db.labs, db.orders],
        async () => {
        await db.labs.clear()
        await db.medications.clear()
        await db.orders.clear()
        await db.vitals.clear()
        await db.dailyUpdates.clear()
        await db.patients.clear()
        if (parsed.patients.length > 0) {
          await db.patients.bulkPut(parsed.patients.map((patient) => ensurePatientLastModified(patient)))
        }
        if (parsed.dailyUpdates.length > 0) {
          await db.dailyUpdates.bulkPut(parsed.dailyUpdates)
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

  const clearDischargedPatients = async () => {
    const dischargedPatients = await db.patients.where('status').equals('discharged').toArray()
    const dischargedIds = dischargedPatients.map((patient) => patient.id).filter((id): id is number => id !== undefined)

    if (dischargedIds.length === 0) {
      setNotice('No discharged patients to clear.')
      return
    }

    await db.transaction(
      'rw',
      [db.patients, db.dailyUpdates, db.vitals, db.medications, db.labs, db.orders, db.photoAttachments],
      async () => {
      await db.patients.bulkDelete(dischargedIds)
      await db.dailyUpdates.where('patientId').anyOf(dischargedIds).delete()
      await db.vitals.where('patientId').anyOf(dischargedIds).delete()
      await db.medications.where('patientId').anyOf(dischargedIds).delete()
      await db.labs.where('patientId').anyOf(dischargedIds).delete()
      await db.orders.where('patientId').anyOf(dischargedIds).delete()
      await db.photoAttachments.where('patientId').anyOf(dischargedIds).delete()
    },
    )

    if (selectedPatientId !== null && dischargedIds.includes(selectedPatientId)) {
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
      setSelectedAttachmentId(null)
      setProfileForm(initialProfileForm)
      setDailyUpdateId(undefined)
      setLastSavedAt(null)
    }

    setNotice('Cleared discharged patients.')
  }

  const addSamplePatient = async () => {
    const today = toLocalISODate()
    const now = new Date().toISOString()
    let samplePatientId = 0

    await db.transaction('rw', [db.patients, db.dailyUpdates, db.vitals, db.medications, db.labs, db.orders], async () => {
      samplePatientId = await db.patients.add({
        lastModified: now,
        roomNumber: '512A',
        lastName: 'Dela Cruz',
        firstName: 'Juan',
        middleName: 'Santos',
        age: 57,
        sex: 'M',
        admitDate: today,
        service: 'Internal Medicine',
        attendingPhysician: 'Dr. Maria C. Garcia',
        diagnosis: 'Community-acquired pneumonia (RLL), improving',
        chiefComplaint: '5 days cough, fever, and dyspnea',
        hpiText: '57-year-old male with productive cough and intermittent fever for 5 days, associated with mild dyspnea on exertion. No chest pain. Symptoms improved after IV antibiotics.',
        pmhText: 'Hypertension (8 years), Type 2 Diabetes Mellitus (5 years), ex-smoker',
        peText: 'Awake and coherent, speaks in full sentences.\nVS: BP 128/76, HR 84, RR 18, Temp 37.3°C, SpO2 96% room air.\nChest: bibasal crackles right greater than left, no retractions.\nCVS: adynamic precordium, regular rhythm.\nAbdomen: soft, non-tender.',
        clinicalSummary: 'CAP improving on empiric antibiotics with stable hemodynamics and improving respiratory symptoms. Continue monitoring trends and prepare for oral step-down when afebrile and clinically stable.',
        plans: 'Continue IV to oral antibiotic step-down tomorrow if afebrile.\nPulmonary hygiene and ambulation as tolerated.\nRepeat CBC and electrolytes in AM.',
        medications: 'Nebulization PRN for dyspnea episodes.',
        labs: 'Follow-up trends: CBC improving, renal panel stable.',
        pendings: 'Sputum culture and sensitivity result.\nRepeat chest x-ray in 48-72 hours.',
        clerkNotes: 'Patient reports better appetite and less cough overnight.',
        status: 'active',
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
        fluid: 'D5 0.3 NaCl 1L over 8h + oral hydration encouraged.',
        respiratory: 'Cough less frequent, no accessory muscle use, saturating well on room air.',
        infectious: 'Afebrile for >24h. Continue antibiotics; monitor culture results.',
        cardio: 'Hemodynamically stable. No chest pain or palpitations.',
        hema: 'Leukocytosis downtrending. No bleeding manifestations.',
        metabolic: 'Capillary glucose acceptable on current regimen.',
        output: 'Urine output adequate; no bowel issues reported.',
        neuro: 'Alert, oriented x3, no focal neurologic deficits.',
        drugs: 'Ceftriaxone 2 g IV q24h, Azithromycin 500 mg PO OD, Amlodipine 10 mg PO OD, Metformin 500 mg PO BID.',
        other: 'Ambulates with minimal assistance; tolerates soft diet.',
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
              buildText: () => toProfileSummary(selectedPatient, profileForm),
            },
            {
              id: 'daily-summary',
              label: 'FRICH',
              outputTitle: 'FRICHMOND',
              buildText: () => toDailySummary(selectedPatient, dailyUpdateForm, patientVitals ?? [], dailyDate),
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
  const canShowFocusedPatientNavButton = selectedPatient?.status === 'active'
  const dailyChecklistSections = useMemo(() =>
    dailyUpdateForm.checklist.reduce<{ pending: Array<{ item: DailyChecklistItem; index: number }>; completed: Array<{ item: DailyChecklistItem; index: number }> }>((accumulator, item, index) => {
      if (item.completed) {
        accumulator.completed.push({ item, index })
      } else {
        accumulator.pending.push({ item, index })
      }
      return accumulator
    }, { pending: [], completed: [] }),
  [dailyUpdateForm.checklist])
  const masterChecklistGroupedByPatient = useMemo(() => {
    const grouped = new Map<number, { patientIdentifier: string; pending: MasterChecklistItem[]; completed: MasterChecklistItem[] }>()

    masterChecklistItems.forEach((item) => {
      const existing = grouped.get(item.patientId)
      if (existing) {
        if (item.completed) {
          existing.completed.push(item)
        } else {
          existing.pending.push(item)
        }
        return
      }

      grouped.set(item.patientId, {
        patientIdentifier: item.patientIdentifier,
        pending: item.completed ? [] : [item],
        completed: item.completed ? [item] : [],
      })
    })

    return Array.from(grouped.entries())
      .map(([patientId, value]) => ({ patientId, ...value }))
      .sort((a, b) => a.patientIdentifier.localeCompare(b.patientIdentifier, undefined, { numeric: true, sensitivity: 'base' }))
  }, [masterChecklistItems])

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
              <Button variant={view === 'settings' ? 'default' : 'ghost'} size='sm' onClick={() => setView('settings')}>Settings</Button>
            </div>
          </div>
        </div>

        {view === 'patient' && selectedPatient ? (
          <div className='mb-3 h-px bg-linear-to-r from-transparent via-clay/20 to-transparent sm:hidden' aria-hidden='true' />
        ) : null}

        {view !== 'settings' ? (
          <>
            {view === 'patients' ? (
              <>
            <Card className='bg-white/80 border-clay/30 mb-4 shadow-sm'>
              <CardHeader className='py-2.5 px-3 pb-0'>
                <CardTitle className='text-sm font-semibold text-espresso'>Add patient</CardTitle>
              </CardHeader>
              <CardContent className='px-3 pb-3'>
                <form className='grid grid-cols-2 gap-2 sm:grid-cols-3' onSubmit={handleSubmit}>
                  <Input aria-label='Room' placeholder='Room' value={form.roomNumber} onChange={(event) => setForm({ ...form, roomNumber: event.target.value })} required />
                  <Input aria-label='First name' placeholder='First name' value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required />
                  <Input aria-label='Last name' placeholder='Last name' value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required />
                  <Input aria-label='Age' placeholder='Age' type='number' min='0' value={form.age} onChange={(event) => setForm({ ...form, age: event.target.value })} required />
                  <Select value={form.sex} onValueChange={(v) => setForm({ ...form, sex: v as 'M' | 'F' | 'O' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='M'>M</SelectItem>
                      <SelectItem value='F'>F</SelectItem>
                      <SelectItem value='O'>O</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input aria-label='Service' placeholder='Service' value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })} required />
                  <Button type='submit' className='col-span-2 sm:col-span-3'>Add patient</Button>
                </form>
              </CardContent>
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
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'active' | 'discharged' | 'all')}>
                      <SelectTrigger className='flex-1'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='active'>Active</SelectItem>
                        <SelectItem value='discharged'>Discharged</SelectItem>
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
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className='flex flex-col gap-2'>
              {visiblePatients.map((patient) => (
                <Card key={patient.id} className={cn(
                  'border-clay/20 hover:shadow-md hover:border-clay/35 transition-all duration-200 overflow-hidden bg-white/75',
                  patient.status === 'active'
                    ? 'border-l-[3px] border-l-action-primary shadow-sm'
                    : 'border-l-[3px] border-l-clay/25 opacity-70'
                )}>
                  <CardContent className='flex items-center gap-3 py-3 px-4'>
                    <div className={cn(
                      'shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-xs font-bold leading-tight text-center px-1',
                      patient.status === 'active'
                        ? 'bg-action-primary/10 text-action-primary'
                        : 'bg-clay/10 text-clay'
                    )}>
                      <span className='truncate max-w-full'>{patient.roomNumber}</span>
                    </div>
                    <div className='flex-1 min-w-0'>
                      <p className='font-semibold text-espresso truncate text-sm leading-snug'>
                        {patient.lastName}, {patient.firstName}
                      </p>
                      <p className='text-xs text-clay mt-0.5 truncate'>
                        {patient.age}/{patient.sex} · {patient.service.split('\n')[0]}
                      </p>
                      {patient.diagnosis && (
                        <p className='text-xs text-espresso/50 truncate mt-0.5'>
                          {patient.diagnosis.split('\n')[0]}
                        </p>
                      )}
                    </div>
                    <Button
                      size='sm'
                      variant={patient.status === 'active' ? 'default' : 'secondary'}
                      onClick={() => selectPatient(patient)}
                    >
                      Open
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
              </>
            ) : null}

            {view === 'checklist' ? (
              <Card className='bg-warm-ivory border-clay shadow-sm'>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-base text-espresso'>Master Checklist (Active Patients)</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='space-y-1 max-w-60'>
                    <Label htmlFor='master-checklist-date'>Date</Label>
                    <Input
                      id='master-checklist-date'
                      type='date'
                      value={masterChecklistDate}
                      onChange={(event) => setMasterChecklistDate(event.target.value)}
                    />
                  </div>
                  <p className='text-xs text-clay'>
                    Viewing checklist state for {formatDateShortMonthDay(masterChecklistDate)}. Pending items carry forward to future dates; completed items stay on their original completion date.
                  </p>
                  <div className='space-y-3'>
                    {masterChecklistGroupedByPatient.map((group) => (
                      <div key={`master-patient-${group.patientId}`} className='space-y-2'>
                        <p className='text-sm font-semibold text-espresso'>{group.patientIdentifier}</p>
                        <div className='space-y-2'>
                          {group.pending.map((item) => renderMasterChecklistItem(item, `master-pending-${item.patientId}-${item.viewDate}-${item.index}`))}
                          {group.completed.map((item) => renderMasterChecklistItem(item, `master-completed-${item.patientId}-${item.viewDate}-${item.index}`))}
                        </div>
                      </div>
                    ))}
                    {masterChecklistItems.length === 0 ? (
                      <p className='text-xs text-clay'>No checklist items for this date.</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {view === 'patient' ? (
              selectedPatient ? (
              <Card className='border-0 bg-transparent shadow-none sm:bg-white/80 sm:border-clay/25 sm:shadow-md sm:ring-1 sm:ring-clay/10'>
                <CardHeader className='sticky top-0 z-20 py-2 px-0 pb-2 bg-warm-ivory/97 backdrop-blur-sm border-b border-clay/15 mx-0 sm:static sm:py-3 sm:px-4 sm:pb-0 sm:bg-transparent sm:backdrop-blur-none sm:border-b-0'>
                  <Select
                    value={selectedPatient.status === 'active' ? (selectedPatient.id?.toString() ?? '') : ''}
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
                  <TabsList className='hidden sm:grid sm:grid-cols-4 lg:grid-cols-8 h-auto w-full gap-0.5 px-1 mb-4 mt-2'>
                    <TabsTrigger className='w-full text-xs px-2.5' value='profile'>Profile</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='frichmond'>FRICH</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='vitals'>Vitals</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='labs'>Labs</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='medications'>Meds</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='orders'>Orders</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='photos'>Photos</TabsTrigger>
                    <TabsTrigger className='w-full text-xs px-2.5' value='reporting'>Report</TabsTrigger>
                  </TabsList>

                <TabsContent value='profile'>
                  <div className='space-y-3'>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-room'>Room</Label>
                        <Input
                          id='profile-room'
                          value={profileForm.roomNumber}
                          onChange={(event) => updateProfileField('roomNumber', event.target.value)}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-firstname'>First name</Label>
                        <Input
                          id='profile-firstname'
                          value={profileForm.firstName}
                          onChange={(event) => updateProfileField('firstName', event.target.value)}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-lastname'>Last name</Label>
                        <Input
                          id='profile-lastname'
                          value={profileForm.lastName}
                          onChange={(event) => updateProfileField('lastName', event.target.value)}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-age'>Age</Label>
                        <Input
                          id='profile-age'
                          type='number'
                          min='0'
                          value={profileForm.age}
                          onChange={(event) => updateProfileField('age', event.target.value)}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label htmlFor='profile-sex'>Sex</Label>
                        <Select
                          value={profileForm.sex}
                          onValueChange={(v) => updateProfileField('sex', v as 'M' | 'F' | 'O')}
                        >
                          <SelectTrigger id='profile-sex'>
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
                    <div className='space-y-1'>
                      <Label htmlFor='profile-service'>Service</Label>
                      <PhotoMentionField
                        ariaLabel='Service'
                        placeholder='Service'
                        value={profileForm.service}
                        onChange={(nextValue) => updateProfileField('service', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-diagnosis'>Diagnosis</Label>
                      <PhotoMentionField
                        ariaLabel='Diagnosis'
                        placeholder='Diagnosis'
                        className='min-h-24'
                        value={profileForm.diagnosis}
                        onChange={(nextValue) => updateProfileField('diagnosis', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-clinicalsummary'>Clinical Summary</Label>
                      <PhotoMentionField
                        ariaLabel='Clinical Summary'
                        placeholder='Clinical Summary'
                        className='min-h-32'
                        value={profileForm.clinicalSummary}
                        onChange={(nextValue) => updateProfileField('clinicalSummary', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-chiefcomplaint'>Chief Complaint</Label>
                      <PhotoMentionField
                        ariaLabel='Chief Complaint'
                        placeholder='Chief Complaint'
                        className='min-h-32'
                        value={profileForm.chiefComplaint}
                        onChange={(nextValue) => updateProfileField('chiefComplaint', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-hpi'>History of Present Illness</Label>
                      <PhotoMentionField
                        ariaLabel='History of Present Illness'
                        placeholder='History of Present Illness'
                        className='min-h-32'
                        value={profileForm.hpiText}
                        onChange={(nextValue) => updateProfileField('hpiText', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-pmh'>Past Medical History</Label>
                      <PhotoMentionField
                        ariaLabel='Past Medical History'
                        placeholder='Past Medical History'
                        className='min-h-32'
                        value={profileForm.pmhText}
                        onChange={(nextValue) => updateProfileField('pmhText', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-pe'>Physical Examination</Label>
                      <PhotoMentionField
                        ariaLabel='Physical Examination'
                        placeholder='Physical Examination'
                        className='min-h-32'
                        value={profileForm.peText}
                        onChange={(nextValue) => updateProfileField('peText', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='profile-clerknotes'>Clerk notes</Label>
                      <PhotoMentionField
                        ariaLabel='Clerk notes'
                        placeholder='Clerk notes'
                        className='min-h-24'
                        value={profileForm.clerkNotes}
                        onChange={(nextValue) => updateProfileField('clerkNotes', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='flex gap-2 flex-wrap'>
                      <Button
                        variant={selectedPatient.status === 'active' ? 'destructive' : 'secondary'}
                        onClick={() => void toggleDischarge(selectedPatient)}
                      >
                        {selectedPatient.status === 'active' ? 'Discharge' : 'Re-activate'}
                      </Button>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value='frichmond'>
                  <div className='space-y-3'>
                    <div className='flex flex-wrap items-end gap-2'>
                      <div className='space-y-1 max-w-60'>
                        <Label htmlFor='daily-date'>Date</Label>
                        <Input
                          id='daily-date'
                          type='date'
                          value={dailyDate}
                          onChange={(event) => {
                            const nextDate = event.target.value
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
                    <p className='text-xs text-clay'>Copies all daily fields (FRICHMOND, assessment, plan) and carries over only pending checklist items from the latest saved date (or previous date when today is latest).</p>
                    <div className='space-y-2'>
                      <Label>Checklist</Label>
                      <p className='text-xs text-clay'>Drag the handle to reorder items within pending or completed sections. On mobile, press and hold the handle then drag. Keyboard: focus handle then press Ctrl/⌘ + ↑/↓.</p>
                      <div className='flex flex-wrap gap-2'>
                        <Input
                          value={dailyChecklistDraft}
                          onChange={(event) => setDailyChecklistDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              addDailyChecklistItem()
                            }
                          }}
                          placeholder='Add checklist item'
                          aria-label='Add checklist item'
                        />
                        <Button type='button' variant='secondary' onClick={addDailyChecklistItem}>
                          Add item
                        </Button>
                      </div>
                      <div className='space-y-2'>
                        {dailyChecklistSections.pending.map(({ item, index }) => renderDailyChecklistItem(item, index))}
                        {dailyChecklistSections.completed.map(({ item, index }) => renderDailyChecklistItem(item, index))}
                        {dailyUpdateForm.checklist.length === 0 && (
                          <p className='text-xs text-clay'>No checklist items yet.</p>
                        )}
                      </div>
                    </div>
                    <div className='space-y-1'>
                      <Label>Fluid</Label>
                      <PhotoMentionField
                        ariaLabel='Fluid'
                        placeholder='Fluid'
                        value={dailyUpdateForm.fluid}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, fluid: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Respiratory</Label>
                      <PhotoMentionField
                        ariaLabel='Respiratory'
                        placeholder='Respiratory'
                        value={dailyUpdateForm.respiratory}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, respiratory: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Infectious</Label>
                      <PhotoMentionField
                        ariaLabel='Infectious'
                        placeholder='Infectious'
                        value={dailyUpdateForm.infectious}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, infectious: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Cardio</Label>
                      <PhotoMentionField
                        ariaLabel='Cardio'
                        placeholder='Cardio'
                        value={dailyUpdateForm.cardio}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, cardio: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Hema</Label>
                      <PhotoMentionField
                        ariaLabel='Hema'
                        placeholder='Hema'
                        value={dailyUpdateForm.hema}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, hema: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Metabolic</Label>
                      <PhotoMentionField
                        ariaLabel='Metabolic'
                        placeholder='Metabolic'
                        value={dailyUpdateForm.metabolic}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, metabolic: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Output</Label>
                      <PhotoMentionField
                        ariaLabel='Output'
                        placeholder='Output'
                        value={dailyUpdateForm.output}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, output: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Neuro</Label>
                      <PhotoMentionField
                        ariaLabel='Neuro'
                        placeholder='Neuro'
                        value={dailyUpdateForm.neuro}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, neuro: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Drugs</Label>
                      <PhotoMentionField
                        ariaLabel='Drugs'
                        placeholder='Drugs'
                        value={dailyUpdateForm.drugs}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, drugs: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Other</Label>
                      <PhotoMentionField
                        ariaLabel='Other'
                        placeholder='Other'
                        value={dailyUpdateForm.other}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, other: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Assessment</Label>
                      <PhotoMentionField
                        ariaLabel='Assessment'
                        placeholder='Assessment'
                        value={dailyUpdateForm.assessment}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, assessment: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
                    </div>
                    <div className='space-y-1'>
                      <Label>Plan</Label>
                      <PhotoMentionField
                        ariaLabel='Daily plan'
                        placeholder='Plan'
                        value={dailyUpdateForm.plans}
                        onChange={(nextValue) => {
                          setDailyUpdateForm({ ...dailyUpdateForm, plans: nextValue })
                          setDailyDirty(true)
                        }}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
                      />
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
                            <Input type='date' aria-label='Vital date' value={vitalForm.date} onChange={(event) => updateVitalField('date', event.target.value)} />
                          </div>
                          <div className='space-y-1'>
                            <Label>Time</Label>
                            <Input type='time' aria-label='Vital time' value={vitalForm.time} onChange={(event) => updateVitalField('time', event.target.value)} />
                          </div>
                          <div className='space-y-1'>
                            <Label>BP</Label>
                            <Input
                              className='placeholder:text-clay/60'
                              aria-label='Vital blood pressure'
                              placeholder='120/80'
                              value={vitalForm.bp}
                              onChange={(event) => updateVitalField('bp', event.target.value)}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>HR</Label>
                            <Input
                              className='placeholder:text-clay/60'
                              aria-label='Vital heart rate'
                              placeholder='80'
                              value={vitalForm.hr}
                              onChange={(event) => updateVitalField('hr', event.target.value)}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>RR</Label>
                            <Input
                              className='placeholder:text-clay/60'
                              aria-label='Vital respiratory rate'
                              placeholder='18'
                              value={vitalForm.rr}
                              onChange={(event) => updateVitalField('rr', event.target.value)}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Temp</Label>
                            <Input
                              className='placeholder:text-clay/60'
                              aria-label='Vital temperature'
                              placeholder='37.0'
                              value={vitalForm.temp}
                              onChange={(event) => updateVitalField('temp', event.target.value)}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>SpO2</Label>
                            <Input
                              className='placeholder:text-clay/60'
                              aria-label='Vital oxygen saturation'
                              placeholder='99'
                              value={vitalForm.spo2}
                              onChange={(event) => updateVitalField('spo2', event.target.value)}
                            />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Note</Label>
                            <PhotoMentionField
                              ariaLabel='Vital note'
                              placeholder='Note'
                              value={vitalForm.note}
                              onChange={(nextValue) => updateVitalField('note', nextValue)}
                              attachments={mentionableAttachments}
                              attachmentByTitle={mentionableAttachmentByTitle}
                              onOpenPhotoById={openPhotoById}
                              multiline={false}
                            />
                          </div>
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                          {editingVitalId === null ? (
                            <Button size='sm' onClick={() => void addStructuredVital()}>Add vital</Button>
                          ) : (
                            <>
                              <Button size='sm' onClick={() => void saveEditingVital()}>Save</Button>
                              <Button size='sm' variant='destructive' onClick={() => void deleteStructuredVital(editingVitalId)}>Remove</Button>
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
                      <PhotoMentionField
                        ariaLabel='Medications'
                        placeholder='Medications'
                        value={profileForm.medications}
                        onChange={(nextValue) => updateProfileField('medications', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
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
                            <Input aria-label='Medication name' placeholder='Medication' value={medicationForm.medication} onChange={(event) => setMedicationForm({ ...medicationForm, medication: event.target.value })} />
                          </div>
                          <div className='space-y-1'>
                            <Label>Dose</Label>
                            <Input aria-label='Medication dose' placeholder='Dose' value={medicationForm.dose} onChange={(event) => setMedicationForm({ ...medicationForm, dose: event.target.value })} />
                          </div>
                          <div className='space-y-1'>
                            <Label>Route</Label>
                            <Input aria-label='Medication route' placeholder='Route' value={medicationForm.route} onChange={(event) => setMedicationForm({ ...medicationForm, route: event.target.value })} />
                          </div>
                          <div className='space-y-1'>
                            <Label>Frequency</Label>
                            <Input aria-label='Medication frequency' placeholder='Frequency' value={medicationForm.frequency} onChange={(event) => setMedicationForm({ ...medicationForm, frequency: event.target.value })} />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Note</Label>
                            <PhotoMentionField
                              ariaLabel='Medication note'
                              placeholder='Note'
                              value={medicationForm.note}
                              onChange={(nextValue) => setMedicationForm({ ...medicationForm, note: nextValue })}
                              attachments={mentionableAttachments}
                              attachmentByTitle={mentionableAttachmentByTitle}
                              onOpenPhotoById={openPhotoById}
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
                              <Button size='sm' variant='destructive' onClick={() => void deleteStructuredMedication(editingMedicationId)}>Remove</Button>
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
                      <PhotoMentionField
                        ariaLabel='Labs'
                        placeholder='Labs'
                        value={profileForm.labs}
                        onChange={(nextValue) => updateProfileField('labs', nextValue)}
                        attachments={mentionableAttachments}
                        attachmentByTitle={mentionableAttachmentByTitle}
                        onOpenPhotoById={openPhotoById}
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
                            <Input
                              type='date'
                              aria-label='Lab date'
                              value={labTemplateDate}
                              onChange={(event) => setLabTemplateDate(event.target.value)}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Time</Label>
                            <Input
                              type='time'
                              aria-label='Lab time'
                              value={labTemplateTime}
                              onChange={(event) => setLabTemplateTime(event.target.value)}
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
                                <Input
                                  aria-label='Other lab label'
                                  placeholder='Example: ABG, Troponin, Coagulation Profile'
                                  value={labTemplateValues[OTHERS_LABEL_KEY] ?? ''}
                                  onChange={(event) => updateLabTemplateValue(OTHERS_LABEL_KEY, event.target.value)}
                                />
                              </div>
                              <div className='space-y-1'>
                                <Label>Lab Result</Label>
                                <PhotoMentionField
                                  ariaLabel='Other lab result'
                                  placeholder='Enter full lab result as freeform text'
                                  value={labTemplateValues[OTHERS_RESULT_KEY] ?? ''}
                                  onChange={(nextValue) => updateLabTemplateValue(OTHERS_RESULT_KEY, nextValue)}
                                  attachments={mentionableAttachments}
                                  attachmentByTitle={mentionableAttachmentByTitle}
                                  onOpenPhotoById={openPhotoById}
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
                                        <Input
                                          aria-label={`${selectedLabTemplate.name} ${test.key} value`}
                                          placeholder={abgPlaceholder}
                                          value={labTemplateValues[test.key] ?? ''}
                                          readOnly={isCalculatedAbgField}
                                          className={cn(isCalculatedAbgField && 'bg-warm-ivory text-clay')}
                                          onChange={(event) => updateLabTemplateValue(test.key, event.target.value)}
                                        />
                                        {test.requiresUln ? (
                                          <Input
                                            aria-label={`${selectedLabTemplate.name} ${test.key} upper limit of normal`}
                                            placeholder='ULN (upper limit of normal)'
                                            value={labTemplateValues[getUlnFieldKey(test.key)] ?? ''}
                                            onChange={(event) => updateLabTemplateValue(getUlnFieldKey(test.key), event.target.value)}
                                          />
                                        ) : null}
                                        {test.requiresNormalRange ? (
                                          <Input
                                            aria-label={`${selectedLabTemplate.name} ${test.key} normal range`}
                                            placeholder='Normal range (e.g., 1.71-3.71)'
                                            value={labTemplateValues[getNormalRangeFieldKey(test.key)] ?? ''}
                                            onChange={(event) => updateLabTemplateValue(getNormalRangeFieldKey(test.key), event.target.value)}
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
                          <PhotoMentionField
                            ariaLabel='Lab note'
                            placeholder='Optional note for this lab run'
                            value={labTemplateNote}
                            onChange={(nextValue) => setLabTemplateNote(nextValue)}
                            attachments={mentionableAttachments}
                            attachmentByTitle={mentionableAttachmentByTitle}
                            onOpenPhotoById={openPhotoById}
                          />
                        </div>
                        <div className='flex gap-2 flex-wrap'>
                          {editingLabId === null ? (
                            <Button size='sm' onClick={() => void addStructuredLab()}>Add lab</Button>
                          ) : (
                            <>
                              <Button size='sm' onClick={() => void saveEditingLab()}>Save</Button>
                              <Button size='sm' variant='secondary' onClick={cancelEditingLab}>Cancel</Button>
                              <Button size='sm' variant='destructive' onClick={() => void deleteStructuredLab(editingLabId)}>Remove</Button>
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
                            <Input type='date' aria-label='Order date' value={orderForm.orderDate} onChange={(event) => updateOrderField('orderDate', event.target.value)} />
                          </div>
                          <div className='space-y-1'>
                            <Label>Time</Label>
                            <Input type='time' aria-label='Order time' value={orderForm.orderTime} onChange={(event) => updateOrderField('orderTime', event.target.value)} />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Service</Label>
                            <Input aria-label='Order service' placeholder='Service' value={orderForm.service} onChange={(event) => updateOrderField('service', event.target.value)} />
                          </div>
                          <div className='space-y-1 col-span-2'>
                            <Label>Order</Label>
                            <PhotoMentionField
                              ariaLabel='Order text'
                              placeholder='Order'
                              value={orderForm.orderText}
                              onChange={(nextValue) => updateOrderField('orderText', nextValue)}
                              attachments={mentionableAttachments}
                              attachmentByTitle={mentionableAttachmentByTitle}
                              onOpenPhotoById={openPhotoById}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Note</Label>
                            <PhotoMentionField
                              ariaLabel='Order note'
                              placeholder='Note'
                              value={orderForm.note}
                              onChange={(nextValue) => updateOrderField('note', nextValue)}
                              attachments={mentionableAttachments}
                              attachmentByTitle={mentionableAttachmentByTitle}
                              onOpenPhotoById={openPhotoById}
                              multiline={false}
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
                              <Button size='sm' variant='destructive' onClick={() => void deleteOrder(editingOrderId)}>Remove</Button>
                              <Button size='sm' variant='secondary' onClick={cancelEditingOrder}>Cancel</Button>
                            </>
                          )}
                        </div>
                        {selectedPatientOrders.length > 0 ? (
                          <ul className='space-y-1'>
                            {selectedPatientOrders.map((entry) => (
                              <li key={entry.id} className='flex items-center justify-between gap-2 text-sm py-1 border-b border-clay/30 last:border-0'>
                                {editingOrderId === entry.id ? (
                                  <span className='text-clay italic'>(Editing above...)</span>
                                ) : (
                                  <>
                                    <span className='min-w-0 flex-1 whitespace-pre-wrap text-left'>
                                      <MentionText
                                        text={formatOrderEntry(entry)}
                                        attachmentByTitle={mentionableAttachmentByTitle}
                                        onOpenPhotoById={openPhotoById}
                                      />
                                    </span>
                                    <Button size='sm' variant='edit' onClick={() => startEditingOrder(entry)}>Edit</Button>
                                  </>
                                )}
                              </li>
                            ))}
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
                              onChange={(event) => setAttachmentTitle(event.target.value)}
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

                        {selectedPatientAttachmentGroups.length > 0 ? (
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
                                    onClick={() => setSelectedAttachmentId(coverPhoto.id)}
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
                                    <Button size='sm' variant='destructive' onClick={() => void deletePhotoAttachmentGroup(group)}>
                                      Remove set
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
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
                                  Included: {selectedCensusPatients.length} of {reportingSelectablePatients.length} active patients
                                </p>
                                <div className='flex gap-2'>
                                  <Button size='sm' variant='secondary' onClick={selectAllCensusPatients}>
                                    Select all
                                  </Button>
                                  <Button size='sm' variant='secondary' onClick={clearCensusPatientsSelection}>
                                    Unselect
                                  </Button>
                                </div>
                              </div>
                              {reportingSelectablePatients.length > 0 ? (
                                <div className='flex flex-wrap gap-2'>
                                  {reportingSelectablePatients.map((patient) => {
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
                                <p className='text-sm text-clay'>No active patients to include.</p>
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
                                          className='flex items-center justify-between gap-2 rounded border border-clay/30 bg-warm-ivory px-2 py-1'
                                        >
                                          <p className='text-sm text-espresso'>
                                            {index + 1}. {patient.roomNumber} — {patient.lastName}, {patient.firstName}
                                          </p>
                                          <div className='flex gap-1'>
                                            <Button
                                              size='sm'
                                              variant='secondary'
                                              aria-label='Move up'
                                              title='Move up'
                                              onClick={() => moveCensusPatientSelection(patientId, 'up')}
                                              disabled={index === 0}
                                            >
                                              ↑
                                            </Button>
                                            <Button
                                              size='sm'
                                              variant='secondary'
                                              aria-label='Move down'
                                              title='Move down'
                                              onClick={() => moveCensusPatientSelection(patientId, 'down')}
                                              disabled={index === selectedCensusPatients.length - 1}
                                            >
                                              ↓
                                            </Button>
                                          </div>
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
                                    <Input type='date' value={reportVitalsDateFrom} onChange={(event) => setReportVitalsDateFrom(event.target.value)} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From time</Label>
                                    <Input type='time' value={reportVitalsTimeFrom} onChange={(event) => setReportVitalsTimeFrom(event.target.value)} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until date</Label>
                                    <Input type='date' value={reportVitalsDateTo} onChange={(event) => setReportVitalsDateTo(event.target.value)} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until time</Label>
                                    <Input type='time' value={reportVitalsTimeTo} onChange={(event) => setReportVitalsTimeTo(event.target.value)} />
                                  </div>
                                </div>
                              </div>

                              <div className='space-y-2'>
                                <p className='text-xs font-semibold text-espresso'>Orders Filter</p>
                                <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From date</Label>
                                    <Input type='date' value={reportOrdersDateFrom} onChange={(event) => setReportOrdersDateFrom(event.target.value)} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>From time</Label>
                                    <Input type='time' value={reportOrdersTimeFrom} onChange={(event) => setReportOrdersTimeFrom(event.target.value)} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until date</Label>
                                    <Input type='date' value={reportOrdersDateTo} onChange={(event) => setReportOrdersDateTo(event.target.value)} />
                                  </div>
                                  <div className='space-y-1'>
                                    <Label className='text-xs'>Until time</Label>
                                    <Input type='time' value={reportOrdersTimeTo} onChange={(event) => setReportOrdersTimeTo(event.target.value)} />
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
                    onClick={() => void clearDischargedPatients()}
                    className='flex items-center gap-3 px-3.5 py-3 rounded-xl bg-red-50 hover:bg-red-100 border border-action-danger/25 text-left transition-colors active:scale-[0.98]'
                  >
                    <div className='w-9 h-9 rounded-lg bg-action-danger/10 flex items-center justify-center shrink-0'>
                      <Trash2 className='h-4 w-4 text-action-danger' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-action-danger'>Clear discharged patients</p>
                      <p className='text-xs text-clay mt-0.5'>Permanently removes all discharged patient records</p>
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
                    ['Add a patient', 'Fill in the form on the Patients tab (room, name, age, sex, service) and tap Add patient.'],
                    ['Open a patient', 'Tap Open on any patient card to enter the patient view with all clinical tabs.'],
                    ['Navigate on mobile', 'The bottom bar shows all 8 patient sections in a 2-row grid — tap any to switch. Use ← Back to return to the patient list.'],
                    ['Switch patients', 'Tap the patient name at the top of any tab to jump to a different active patient while staying on the same section. Discharged patients are hidden from this quick-switch list, and you can scroll through the list when many active patients are present.'],
                    ['Write daily notes', 'Open FRICH, pick today\'s date, fill F-R-I-C-H-M-O-N-D fields, plan, and checklist. Use the pencil button to revise or remove checklist items, and use the drag handle to reorder priorities (on mobile, press and hold the handle then drag). Tap Copy latest entry to carry forward yesterday\'s note with pending checklist items only.'],
                    ['Review all checklist items', 'Open Checklist from the main navigation to see checklist items for active patients on one date, including pending and completed entries with Created/Completed dates shown in short format (e.g., Feb 10). Use the pencil button to edit or remove items, update status, and drag with the handle to reorder within each patient section (on mobile, press and hold then drag).'],
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
                <div className='grid grid-cols-2 gap-1.5'>
                  {([
                    ['Profile', 'Demographics, diagnosis, clinical summary, HPI, PMH, PE, meds, labs, and clerk notes'],
                    ['FRICH', 'Date-based F-R-I-C-H-M-O-N-D daily notes, assessment, plan, and checklist'],
                    ['Vitals', 'Structured BP/HR/RR/Temp/SpO2 log with date & time entries'],
                    ['Labs', 'CBC, UA, Blood Chem, ABG templates + free-text with date/time'],
                    ['Meds', 'Structured medication list: drug, dose, route, frequency, status, plus drag-to-reorder'],
                    ['Orders', "Doctor's orders with date, time, service & status tracking"],
                    ['Photos', 'Categorized image attachments with grouped uploads & carousel'],
                    ['Report', 'Copy-ready text exports for handoffs, census, vitals & labs'],
                  ] as [string, string][]).map(([name, desc]) => (
                    <div key={name} className='rounded-lg bg-warm-ivory border border-clay/20 px-2.5 py-2'>
                      <p className='text-xs font-bold text-espresso'>{name}</p>
                      <p className='text-[11px] text-clay leading-snug mt-0.5'>{desc}</p>
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
                    'FRICH exports include a daily vitals range line (BP, HR, RR, Temp, SpO2%) for the selected date.',
                    'All patient exports: select and reorder active patients before generating Multiple Census or Multiple Vitals.',
                    'Photos: upload multiple images at once — they are grouped into one block and keep your picker selection order. Tap the block to open a carousel, then use < / >, keyboard arrows, Home/End, or thumbnails to jump quickly in large sets.',
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
                    ['Set up sync once', 'Tap the sync button (bottom-right in the mobile footer, top-right on desktop). Enter the same Room code on both devices, then type your Name and a Device name (recommended default: Phone). Keep each device name unique (example: Phone, Clerk-Laptop) so you can identify which device pushed each sync.'],
                    ['Edit sync identity', 'Open Settings → Edit sync settings any time to change this device\'s room code, your name, or device name.'],
                    ['Run first sync', 'After setup, PUHRR runs an initial sync. Wait for the success state before closing the dialog.'],
                    ['Understand first sync choices', 'If a room already has data and this device has never synced, PUHRR asks you to pick Upload this device or Download room data first. It will not auto-overwrite.'],
                    ['Check sync status', 'Open Settings → Sync Status to confirm latest room upload time, which device uploaded it, and whether this device has local unsynced changes.'],
                    ['Sync during rounds', 'Tap Sync from the footer (phone) or header (desktop) whenever you finish key edits or before switching devices. Button states: Synced, ↑ Push ready, ↓ Updates available, ⚠ Conflict, or Syncing.'],
                    ['If conflict appears', 'A version picker opens whenever remote data is newer and this device also changed since the last sync. Choose one of the latest versions (or keep local) to continue.'],
                    ['Keep backup safety', 'Sync includes profile, FRICH, vitals, medications, labs, and orders. Photos are excluded. Continue exporting JSON backup regularly from Settings, especially before device/browser changes.'],
                    ['If only profile/FRICH pull in', 'This usually means the room still has a legacy snapshot from an older app build. Sync from an updated device once to upgrade the room snapshot, then sync again on the other device.'],
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
          <DialogContent className='flex flex-col gap-2 p-3 w-[95vw] max-w-3xl h-[95vh] max-h-[95vh] md:gap-3 md:p-4 md:h-[92vh] md:max-h-[92vh]'>
            <DialogHeader>
              <DialogTitle>
                {selectedAttachmentCarouselEntry
                  ? `[${formatPhotoCategory(selectedAttachmentCarouselEntry.category)}] ${selectedAttachmentCarouselEntry.title || 'Untitled'}`
                  : 'Photo attachment'}
              </DialogTitle>
            </DialogHeader>
            {selectedAttachmentCarouselEntry ? (
              <>
                {attachmentPreviewUrls[selectedAttachmentCarouselEntry.id] ? (
                  <div className='flex-1 min-h-0 rounded border border-clay/30 bg-warm-ivory'>
                    <img
                      src={attachmentPreviewUrls[selectedAttachmentCarouselEntry.id]}
                      alt={selectedAttachmentCarouselEntry.title || 'Attachment preview'}
                      className='h-full w-full object-contain'
                    />
                  </div>
                ) : (
                  <p className='text-sm text-clay'>Preview unavailable.</p>
                )}
                {selectedAttachmentCarousel && selectedAttachmentCarousel.entries.length > 1 ? (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <Button
                        variant='secondary'
                        onClick={() => moveCarousel('previous')}
                        aria-label='Previous photo'
                      >
                        {'<'}
                      </Button>
                      <p className='text-xs text-clay'>
                        {selectedAttachmentCarousel.currentIndex + 1} of {selectedAttachmentCarousel.entries.length}
                      </p>
                      <Button
                        variant='secondary'
                        onClick={() => moveCarousel('next')}
                        aria-label='Next photo'
                      >
                        {'>'}
                      </Button>
                    </div>
                    <ScrollArea className='w-full rounded border border-clay/25 bg-white'>
                      <div className='flex gap-1.5 p-1.5'>
                        {selectedAttachmentCarousel.entries.map((entry, index) => {
                          const previewUrl = attachmentPreviewUrls[entry.id]
                          const isActive = index === selectedAttachmentCarousel.currentIndex

                          return (
                            <button
                              key={`carousel-thumb-${entry.id}`}
                              type='button'
                              className={cn(
                                'h-14 w-14 shrink-0 overflow-hidden rounded border transition-colors',
                                isActive ? 'border-action-primary ring-1 ring-action-primary/40' : 'border-clay/30 hover:border-clay/60',
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
                    </ScrollArea>
                  </div>
                ) : null}
                <div className='flex gap-2 flex-wrap'>
                  <Button variant='destructive' onClick={() => void deletePhotoAttachment(selectedAttachmentCarouselEntry.id)}>
                    Remove from app
                  </Button>
                  <Button variant='secondary' onClick={() => setSelectedAttachmentId(null)}>
                    Close
                  </Button>
                </div>
              </>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={showPhotoReviewDialog} onOpenChange={setShowPhotoReviewDialog}>
          <DialogContent className='flex flex-col gap-3 p-4 w-[95vw] max-w-5xl h-[85vh] max-h-[85vh]'>
            <DialogHeader>
              <DialogTitle>Review all photos</DialogTitle>
            </DialogHeader>
            <p className='text-sm text-clay'>Review linked and orphan photos across all patients. Reassign, delete, or export any photo.</p>
            <ScrollArea className='flex-1 min-h-0 rounded border border-clay/25 bg-warm-ivory p-2'>
              {reviewablePhotoAttachments.length > 0 ? (
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
                          <div className='rounded border border-clay/25 bg-warm-ivory overflow-hidden h-30'>
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
                          </div>
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
                              <Button size='sm' variant='destructive' onClick={() => void deletePhotoAttachment(attachment.id)}>
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

        <Dialog open={editingDailyChecklistItem !== null} onOpenChange={(open) => { if (!open) setEditingDailyChecklistItem(null) }}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle>Edit checklist item</DialogTitle>
            </DialogHeader>
            <div className='space-y-3'>
              <Input
                value={editingDailyChecklistItem?.text ?? ''}
                onChange={(event) => setEditingDailyChecklistItem((previous) => (previous ? { ...previous, text: event.target.value } : previous))}
                aria-label='Edit checklist item text'
                placeholder='Checklist item'
              />
              <div className='flex gap-2 justify-end'>
                <Button variant='destructive' className='mr-auto' onClick={removeEditedDailyChecklistItem}>Remove</Button>
                <Button variant='secondary' onClick={() => setEditingDailyChecklistItem(null)}>Cancel</Button>
                <Button onClick={saveEditedDailyChecklistItem}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={editingMasterChecklistItem !== null} onOpenChange={(open) => { if (!open) setEditingMasterChecklistItem(null) }}>
          <DialogContent className='max-w-md'>
            <DialogHeader>
              <DialogTitle>Edit checklist item</DialogTitle>
            </DialogHeader>
            <div className='space-y-3'>
              <Input
                value={editingMasterChecklistItem?.text ?? ''}
                onChange={(event) => setEditingMasterChecklistItem((previous) => (previous ? { ...previous, text: event.target.value } : previous))}
                aria-label='Edit master checklist item text'
                placeholder='Checklist item'
              />
              <div className='flex gap-2 justify-end'>
                <Button variant='destructive' className='mr-auto' onClick={removeEditedMasterChecklistItem}>Remove</Button>
                <Button variant='secondary' onClick={() => setEditingMasterChecklistItem(null)}>Cancel</Button>
                <Button onClick={saveEditedMasterChecklistItem}>Save</Button>
              </div>
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
      </main>
      <nav className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-clay/25 bg-warm-ivory/97 backdrop-blur-md sm:hidden',
        isStandaloneDisplayMode ? 'pb-[calc(0.375rem+env(safe-area-inset-bottom))]' : 'pb-1.5',
      )}>
        {view === 'patient' && selectedPatient ? (
          /* Patient tab navigation — 4×2 grid, no scrolling */
          <div className='flex items-stretch'>
            <button
              className='shrink-0 flex flex-col items-center justify-center gap-0.5 px-2.5 text-clay/70 hover:text-espresso hover:bg-clay/5 border-r border-clay/20 transition-colors'
              onClick={() => setView('patients')}
              aria-label='Back to patients list'
            >
              <ChevronLeft className='h-3.5 w-3.5' />
              <span className='text-[9px] font-bold leading-none'>Back</span>
            </button>
            <div className='flex-1 grid grid-cols-4 gap-px p-1'>
              {((['profile', 'frichmond', 'vitals', 'labs', 'medications', 'orders', 'photos', 'reporting'] as const)).map((tab) => {
                const tabLabels: Record<typeof tab, string> = {
                  profile: 'Profile',
                  frichmond: 'FRICH',
                  vitals: 'Vitals',
                  labs: 'Labs',
                  medications: 'Meds',
                  orders: 'Orders',
                  photos: 'Photos',
                  reporting: 'Report',
                }
                return (
                  <button
                    key={tab}
                    onClick={() => setSelectedTab(tab)}
                    className={cn(
                      'flex items-center justify-center py-1.5 text-[11px] font-semibold rounded-md transition-all duration-150',
                      selectedTab === tab
                        ? 'text-action-primary bg-action-primary/10'
                        : 'text-clay/70 hover:text-espresso hover:bg-clay/5',
                    )}
                  >
                    {tabLabels[tab]}
                  </button>
                )
              })}
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
                view === 'settings'
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
