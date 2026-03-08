import {
  formatLabComparisonReport,
  formatLabSingleReport,
} from '@/labFormatters'
import {
  LAB_TEMPLATES,
  OTHERS_LABEL_KEY,
  OTHERS_LAB_TEMPLATE_ID,
  OTHERS_RESULT_KEY,
  UST_ABG_TEMPLATE_ID,
} from '@/features/labs/labTemplates'
import {
  formatClock,
  formatClockCompact,
  formatDateMMDD,
  formatDateMMDDYYYY,
  isWithinDateTimeWindow,
  parseNumericInput,
  toDateTimeStamp,
} from '@/lib/dateTime'
import type {
  LabEntry,
  MedicationEntry,
  OrderEntry,
  Patient,
  VitalEntry,
} from '@/types'

type ReportWindow = {
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
}

type ProfileSummaryInput = {
  service: string
  diagnosis: string
  clerkNotes: string
}

type DailySummaryInput = {
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
}

const labTemplatesById = new Map(LAB_TEMPLATES.map((template) => [template.id, template] as const))

const formatPatientHeader = (patient: Patient) => `${patient.roomNumber} - ${patient.lastName.toUpperCase()}, ${patient.firstName}`

const formatStructuredMedication = (entry: MedicationEntry) => {
  const base = [entry.medication, entry.dose, entry.route, entry.frequency].filter(Boolean).join(' ')
  const withNote = [base, entry.note].filter(Boolean).join(' — ')
  if (entry.status === 'discontinued') {
    return `${withNote} (discontinued)`
  }
  if (entry.status === 'completed') {
    return `${withNote} (completed)`
  }
  return withNote
}

const formatOrderStatus = (status: OrderEntry['status']) => {
  if (status === 'carriedOut') return 'carried out'
  return status
}

export const formatOrderEntry = (entry: OrderEntry) => {
  const serviceText = (entry.service ?? '').trim()
  const whenText = [entry.orderDate ?? '', entry.orderTime ?? ''].filter(Boolean).join(' ')
  const header = [serviceText, whenText, entry.orderText].filter(Boolean).join(' • ')
  const withNote = [header, entry.note].filter(Boolean).join(' — ')
  return `${withNote || entry.orderText} (${formatOrderStatus(entry.status)})`
}

const parseServiceLines = (service: string) => {
  const lines = service
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return {
    main: lines[0] ?? '-',
    referrals: lines.slice(1),
  }
}

const formatRange = (values: number[]) => {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return `${min}`
  return `${min}-${max}`
}

const formatDecimalRange = (values: number[]) => {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const formatValue = (value: number) => Number.parseFloat(value.toFixed(1)).toString()
  if (min === max) return formatValue(min)
  return `${formatValue(min)}-${formatValue(max)}`
}

const buildDailyVitalsRangeLine = (entries: VitalEntry[], targetDate: string) => {
  const scoped = entries
    .filter((entry) => entry.date === targetDate)
    .sort((a, b) => a.time.localeCompare(b.time))
  if (scoped.length === 0) return ''

  const systolic: number[] = []
  const diastolic: number[] = []
  const hrs: number[] = []
  const rrs: number[] = []
  const temps: number[] = []
  const spo2s: number[] = []

  scoped.forEach((entry) => {
    const bpMatch = entry.bp.match(/(\d+)\s*\/\s*(\d+)/)
    if (bpMatch) {
      systolic.push(Number.parseInt(bpMatch[1], 10))
      diastolic.push(Number.parseInt(bpMatch[2], 10))
    }
    const hr = parseNumericInput(entry.hr)
    if (hr !== null) hrs.push(hr)
    const rr = parseNumericInput(entry.rr)
    if (rr !== null) rrs.push(rr)
    const temp = parseNumericInput(entry.temp)
    if (temp !== null) temps.push(temp)
    const spo2 = parseNumericInput(entry.spo2)
    if (spo2 !== null) spo2s.push(spo2)
  })

  const bpText = systolic.length > 0 && diastolic.length > 0
    ? `${formatRange(systolic)}/${formatRange(diastolic)}`
    : '-'
  const hrText = formatRange(hrs) || '-'
  const rrText = formatRange(rrs) || '-'
  const tempText = formatDecimalRange(temps) || '-'
  const spo2Text = `${formatRange(spo2s) || '-'}%`

  return `Vitals: ${bpText} ${hrText} ${rrText} ${tempText} ${spo2Text}`
}

export const buildStructuredLabLines = (entries: LabEntry[]) => {
  return entries.map((entry) => {
    const template = labTemplatesById.get(entry.templateId)
    const isOthersTemplate = entry.templateId === OTHERS_LAB_TEMPLATE_ID
    const customLabel = (entry.results?.[OTHERS_LABEL_KEY] ?? '').trim()
    const label = isOthersTemplate
      ? customLabel || 'Others'
      : template?.name ?? entry.templateId
    const note = entry.note ? ` — ${entry.note}` : ''
    const dateTimeLabel = `${entry.date}${entry.time ? ` ${entry.time}` : ''}`

    if (isOthersTemplate) {
      const freeformResult = (entry.results?.[OTHERS_RESULT_KEY] ?? '').trim()
      return `${dateTimeLabel} ${label}: ${freeformResult || '-'}${note}`
    }

    let details = isOthersTemplate
      ? ((entry.results?.[OTHERS_RESULT_KEY] ?? '').trim() || '-')
      : '-'
    if (!isOthersTemplate) {
      try {
        details = formatLabSingleReport(
          entry.templateId as 'ust-cbc' | 'ust-urinalysis' | 'ust-electrolytes' | 'ust-abg' | 'others',
          entry.results ?? {},
        )
      } catch (error) {
        details = error instanceof Error ? `Validation error: ${error.message}` : 'Validation error'
      }
    }
    return `${dateTimeLabel} ${label}: ${details}${note}`
  })
}

const buildLabReportBlocks = (entries: LabEntry[]) => {
  const formatDateMMDDSlash = (isoDate: string) => {
    const [, month, day] = isoDate.split('-')
    if (!month || !day) return isoDate
    return `${month}/${day}`
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    const aTime = a.time ?? ''
    const bTime = b.time ?? ''
    if (aTime !== bTime) return bTime.localeCompare(aTime)
    return b.createdAt.localeCompare(a.createdAt)
  })

  const byTemplate = new Map<string, LabEntry[]>()
  sorted.forEach((entry) => {
    const list = byTemplate.get(entry.templateId) ?? []
    list.push(entry)
    byTemplate.set(entry.templateId, list)
  })

  const consumedIds = new Set<number>()
  const blocks: string[] = []

  sorted.forEach((entry) => {
    if (entry.id !== undefined && consumedIds.has(entry.id)) return
    const sameTemplateEntries = byTemplate.get(entry.templateId) ?? []

    if (sameTemplateEntries.length === 2 && entry.templateId !== OTHERS_LAB_TEMPLATE_ID) {
      const newer = sameTemplateEntries[0]
      const older = sameTemplateEntries[1]
      if (entry.id !== newer.id) return

      const template = labTemplatesById.get(entry.templateId)
      const label = entry.templateId === OTHERS_LAB_TEMPLATE_ID
        ? ((newer.results?.[OTHERS_LABEL_KEY] ?? '').trim() || 'Others')
        : entry.templateId === UST_ABG_TEMPLATE_ID
          ? 'ABG'
          : (template?.name ?? entry.templateId)

      const newerTime = formatClock(newer.time ?? '00:00')
      const olderTime = formatClock(older.time ?? '00:00')
      const headerLine = newer.date === older.date
        ? `${formatDateMMDD(newer.date)} ${newerTime} vs ${olderTime}`
        : `${formatDateMMDD(newer.date)} vs ${formatDateMMDD(older.date)}`

      const newerStamp = toDateTimeStamp(newer.date, newer.time, newer.createdAt)
      const olderStamp = toDateTimeStamp(older.date, older.time, older.createdAt)
      const elapsedHours = Number.isFinite(newerStamp) && Number.isFinite(olderStamp)
        ? Math.abs(newerStamp - olderStamp) / 3_600_000
        : 0

      const body = formatLabComparisonReport(
        entry.templateId as 'ust-cbc' | 'ust-urinalysis' | 'ust-electrolytes' | 'ust-abg' | 'others',
        newer.results ?? {},
        older.results ?? {},
        elapsedHours,
      )

      blocks.push([label, headerLine, body].join('\n'))
      if (newer.id !== undefined) consumedIds.add(newer.id)
      if (older.id !== undefined) consumedIds.add(older.id)
      return
    }

    const template = labTemplatesById.get(entry.templateId)
    const label = entry.templateId === OTHERS_LAB_TEMPLATE_ID
      ? ((entry.results?.[OTHERS_LABEL_KEY] ?? '').trim() || 'Others')
      : entry.templateId === UST_ABG_TEMPLATE_ID
        ? 'ABG'
        : (template?.name ?? entry.templateId)
    const dateLine = formatDateMMDDSlash(entry.date)
    const body = formatLabSingleReport(
      entry.templateId as 'ust-cbc' | 'ust-urinalysis' | 'ust-electrolytes' | 'ust-abg' | 'others',
      entry.results ?? {},
    )
    blocks.push([label, dateLine, body].join('\n'))
    if (entry.id !== undefined) consumedIds.add(entry.id)
  })

  return blocks
}

export const toCensusEntry = (
  patient: Patient,
  medicationEntries: MedicationEntry[],
  labEntries: LabEntry[],
  orderEntries: OrderEntry[],
) => {
  const activeStructuredMeds = medicationEntries
    .filter((entry) => entry.status === 'active')
    .map(formatStructuredMedication)
    .filter(Boolean)

  const freeformMeds = patient.medications.trim()
  const medsCombined = [freeformMeds, ...activeStructuredMeds].filter(Boolean).join('\n')
  const freeformLabs = patient.labs.trim()
  const structuredLabLines = buildStructuredLabLines(labEntries)
  const labsCombined = [freeformLabs, ...structuredLabLines].filter(Boolean).join('\n')
  const activeOrders = orderEntries
    .filter((entry) => entry.status === 'active')
    .map((entry) => {
      const serviceText = (entry.service ?? '').trim()
      const whenText = [entry.orderDate ?? '', entry.orderTime ?? ''].filter(Boolean).join(' ')
      const header = [serviceText, whenText, entry.orderText].filter(Boolean).join(' • ')
      return [header || entry.orderText, entry.note].filter(Boolean).join(' — ')
    })
    .filter(Boolean)
    .join('; ')

  return [
    `${patient.roomNumber} ${patient.lastName}, ${patient.firstName} ${patient.age}/${patient.sex}`,
    patient.diagnosis,
    `Labs: ${labsCombined || '-'}`,
    `Meds: ${medsCombined || '-'}`,
    `Orders: ${activeOrders || '-'}`,
  ].join('\n')
}

export const toSelectedPatientCensusReport = (
  patient: Patient,
  diagnosisText: string,
  vitalsEntries: VitalEntry[],
  selectedLabEntries: LabEntry[],
  selectedLabReportIds: number[],
  orderEntries: OrderEntry[],
  vitalsWindow: ReportWindow,
  ordersWindow: ReportWindow,
) => {
  const labBlocks = buildLabReportBlocks(
    selectedLabEntries.filter((entry) => entry.id !== undefined && selectedLabReportIds.includes(entry.id)),
  )
  const scopedVitals = vitalsEntries
    .filter((entry) =>
      isWithinDateTimeWindow(
        entry.date,
        entry.time,
        vitalsWindow.dateFrom,
        vitalsWindow.dateTo,
        vitalsWindow.timeFrom,
        vitalsWindow.timeTo,
      ),
    )
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.time !== b.time) return a.time.localeCompare(b.time)
      return a.createdAt.localeCompare(b.createdAt)
    })
  const scopedOrders = orderEntries
    .filter((entry) =>
      isWithinDateTimeWindow(
        entry.orderDate,
        entry.orderTime,
        ordersWindow.dateFrom,
        ordersWindow.dateTo,
        ordersWindow.timeFrom,
        ordersWindow.timeTo,
      ),
    )
    .sort((a, b) => {
      if (a.orderDate !== b.orderDate) return a.orderDate.localeCompare(b.orderDate)
      if (a.orderTime !== b.orderTime) return a.orderTime.localeCompare(b.orderTime)
      return a.createdAt.localeCompare(b.createdAt)
    })
  const diagnosis = diagnosisText.trim() || patient.diagnosis.trim() || '-'
  const vitalsLines = scopedVitals.map((entry) => {
    const base = `${formatDateMMDD(entry.date)} ${formatClockCompact(entry.time)} ${entry.bp.trim()} ${entry.hr.trim()} ${entry.rr.trim()} ${entry.temp.trim()} ${entry.spo2.trim()}`
    return entry.note.trim() ? `${base} ${entry.note.trim()}` : base
  })
  const ordersLines = scopedOrders.map((entry) => {
    const orderDateTime = `${formatDateMMDD(entry.orderDate)} ${formatClock(entry.orderTime)}`
    const orderLine = [orderDateTime, entry.orderText.trim()].filter(Boolean).join(' — ')
    return entry.note.trim() ? `${orderLine} (${entry.note.trim()})` : orderLine
  })
  const vitalsWindowLabel = `Vitals (From ${formatDateMMDDYYYY(vitalsWindow.dateFrom)}, ${formatClock(vitalsWindow.timeFrom)}, Until ${formatDateMMDDYYYY(vitalsWindow.dateTo)}, ${formatClock(vitalsWindow.timeTo)})`

  return [
    `${patient.roomNumber} – ${patient.lastName.toUpperCase()}, ${patient.firstName}`,
    `${patient.age} / ${patient.sex}`,
    diagnosis,
    '',
    'Labs',
    labBlocks.length > 0 ? labBlocks.join('\n\n') : '-',
    '',
    vitalsWindowLabel,
    vitalsLines.length > 0 ? vitalsLines.join('\n') : '-',
    '',
    'Orders',
    ordersLines.length > 0 ? ordersLines.join('\n') : '-',
  ].join('\n')
}

export const toProfileSummary = (
  patient: Patient,
  profile: ProfileSummaryInput,
) => {
  const { main, referrals } = parseServiceLines(profile.service || patient.service)
  const diagnosis = profile.diagnosis.trim() || patient.diagnosis.trim() || '-'
  const notes = (profile.clerkNotes || patient.clerkNotes || '').trim()

  const lines = [
    formatPatientHeader(patient),
    `${patient.age} / ${patient.sex}`,
    `Main: ${main}`,
    `Referrals: ${referrals.length > 0 ? referrals.join(', ') : '-'}`,
    `Dx: ${diagnosis}`,
  ]

  if (notes) {
    lines.push('Notes:')
    lines.push(notes)
  }

  return lines.join('\n')
}

export const toDailySummary = (
  patient: Patient,
  update: DailySummaryInput,
  vitalsEntries: VitalEntry[],
  dailyDate: string,
) => {
  const vitalsLine = buildDailyVitalsRangeLine(vitalsEntries, dailyDate)
  const checklistItems = (update.checklist ?? []).filter((item) => (item.text ?? '').trim().length > 0)
  const pendingChecklistItems = checklistItems.filter((item) => !item.completed)
  const completedChecklistItems = checklistItems.filter((item) => item.completed)

  const lines = [
    `${formatPatientHeader(patient)} — ${formatDateMMDDYYYY(dailyDate)}`,
    vitalsLine,
    update.fluid ? `F: ${update.fluid}` : '',
    update.respiratory ? `R: ${update.respiratory}` : '',
    update.infectious ? `I: ${update.infectious}` : '',
    update.cardio ? `C: ${update.cardio}` : '',
    update.hema ? `H: ${update.hema}` : '',
    update.metabolic ? `M: ${update.metabolic}` : '',
    update.output ? `O: ${update.output}` : '',
    update.neuro ? `N: ${update.neuro}` : '',
    update.drugs ? `D: ${update.drugs}` : '',
    update.other ? `Other: ${update.other}` : '',
    update.assessment ? `Assessment: ${update.assessment}` : '',
    update.plans ? `Plan: ${update.plans}` : '',
    checklistItems.length > 0 ? 'Checklist:' : '',
    ...pendingChecklistItems.map((item) => `- [ ] ${item.text.trim()}`),
    ...completedChecklistItems.map((item) => `- [x] ${item.text.trim()}`),
  ]

  return lines.filter(Boolean).join('\n')
}

export const toVitalsLogSummary = (patient: Patient, vitalsEntries: VitalEntry[], vitalsWindow: ReportWindow) => {
  const scoped = vitalsEntries
    .filter((entry) =>
      isWithinDateTimeWindow(
        entry.date,
        entry.time,
        vitalsWindow.dateFrom,
        vitalsWindow.dateTo,
        vitalsWindow.timeFrom,
        vitalsWindow.timeTo,
      ),
    )
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.time !== b.time) return a.time.localeCompare(b.time)
      return a.createdAt.localeCompare(b.createdAt)
    })

  if (scoped.length === 0) {
    return 'No vitals in selected window.'
  }

  const lines = [formatPatientHeader(patient)]
  scoped.forEach((entry) => {
    const base = `${formatClockCompact(entry.time)} ${entry.bp.trim()} ${entry.hr.trim()} ${entry.rr.trim()} ${entry.temp.trim()} ${entry.spo2.trim()}`
    lines.push(entry.note.trim() ? `${base} ${entry.note.trim()}` : base)
  })

  return lines.join('\n')
}

export const toSelectedPatientsVitalsSummary = (
  patientsToInclude: Patient[],
  structuredVitalsByPatient: Map<number, VitalEntry[]>,
  vitalsWindow: ReportWindow,
) => {
  return patientsToInclude
    .map((patient) => {
      const summary = toVitalsLogSummary(
        patient,
        structuredVitalsByPatient.get(patient.id ?? -1) ?? [],
        vitalsWindow,
      )
      if (summary === 'No vitals in selected window.') {
        return `${formatPatientHeader(patient)}\n${summary}`
      }
      return summary
    })
    .join('\n\n')
}

export const toOrdersSummary = (patient: Patient, orderEntries: OrderEntry[], ordersWindow: ReportWindow) => {
  const scoped = orderEntries
    .filter((entry) =>
      isWithinDateTimeWindow(
        entry.orderDate,
        entry.orderTime,
        ordersWindow.dateFrom,
        ordersWindow.dateTo,
        ordersWindow.timeFrom,
        ordersWindow.timeTo,
      ),
    )
    .sort((a, b) => {
      if (a.orderDate !== b.orderDate) return a.orderDate.localeCompare(b.orderDate)
      if (a.orderTime !== b.orderTime) return a.orderTime.localeCompare(b.orderTime)
      return a.createdAt.localeCompare(b.createdAt)
    })

  if (scoped.length === 0) {
    return `${formatPatientHeader(patient)}\nNo orders in selected window.`
  }

  const orderLines = scoped.map((entry) => {
    const serviceText = (entry.service ?? '').trim()
    const dateTime = `${formatDateMMDD(entry.orderDate)} ${formatClock(entry.orderTime)}`.trim()
    const header = [serviceText, dateTime].filter(Boolean).join(' – ')
    return [header, entry.orderText].filter(Boolean).join('\n')
  })

  return [formatPatientHeader(patient), '', ...orderLines].join('\n')
}

export const toMedicationsSummary = (patient: Patient, medicationEntries: MedicationEntry[]) => {
  const lines = [`MEDICATIONS — ${patient.lastName} (${patient.roomNumber})`]
  const active = medicationEntries.filter((m) => m.status === 'active')
  const inactive = medicationEntries.filter((m) => m.status !== 'active')

  if (active.length > 0) {
    lines.push('Active:')
    active.forEach((m) => lines.push(`  ${formatStructuredMedication(m)}`))
  }
  if (inactive.length > 0) {
    lines.push('Inactive/discontinued:')
    inactive.forEach((m) => lines.push(`  ${formatStructuredMedication(m)}`))
  }
  if (medicationEntries.length === 0) {
    lines.push('No medications yet.')
  }

  return lines.join('\n')
}

export const toLabsSummary = (patient: Patient, labEntries: LabEntry[], selectedLabReportIds: number[]) => {
  const selectedEntries = labEntries.filter((entry) => entry.id !== undefined && selectedLabReportIds.includes(entry.id))
  const blocks = buildLabReportBlocks(selectedEntries)
  if (blocks.length === 0) {
    return `${formatPatientHeader(patient)}\nNo selected labs.`
  }
  return [formatPatientHeader(patient), ...blocks].join('\n\n')
}
