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
  formatDateMMDD,
  toDateTimeStamp,
} from '@/lib/dateTime'
import type {
  LabEntry,
  MedicationEntry,
  OrderEntry,
} from '@/types'

const labTemplatesById = new Map(LAB_TEMPLATES.map((template) => [template.id, template] as const))

export const formatStructuredMedication = (entry: MedicationEntry) => {
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

export const formatOrderStatus = (status: OrderEntry['status']) => {
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

/** Same as `formatOrderEntry` but omits the service segment — for UI that already shows the service as its own chip. */
export const formatOrderEntryWithoutService = (entry: OrderEntry) => {
  const whenText = [entry.orderDate ?? '', entry.orderTime ?? ''].filter(Boolean).join(' ')
  const header = [whenText, entry.orderText].filter(Boolean).join(' • ')
  const withNote = [header, entry.note].filter(Boolean).join(' — ')
  return `${withNote || entry.orderText} (${formatOrderStatus(entry.status)})`
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

const formatDateMMDDSlash = (isoDate: string) => {
  const [, month, day] = isoDate.split('-')
  if (!month || !day) return isoDate
  return `${month}/${day}`
}

/**
 * One Labs result block — either a single entry's result, or (when exactly 2 entries of the same
 * lab template are in scope) a side-by-side comparison of the two. Structured rather than
 * pre-joined so the template engine can control date display (each block's own date, no date at
 * all, or one date header shared by every same-day block) independently of the label/body content,
 * which stays algorithmic (see `formatLabSingleReport`/`formatLabComparisonReport`).
 */
export interface LabReportBlockPiece {
  /** ISO date this block is anchored to — the newer entry's date for a comparison block. */
  date: string
  label: string
  /** A comparison block's "vs ..." context (e.g. "6:00 AM vs 6:00 PM" or "vs 01-01"), never
   * including the leading date itself — "" for a single-entry block. */
  headerDetail: string
  /** Legacy per-block date formatting differs by block kind (dash for comparisons, slash for
   * singles) — kept only so the default "show each block's own date" display reproduces exactly
   * what this app already showed before Labs' date display became configurable. */
  legacyDateLine: string
  body: string
}

export const buildLabReportBlockPieces = (entries: LabEntry[]): LabReportBlockPiece[] => {
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
  const pieces: LabReportBlockPiece[] = []

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
      const sameDay = newer.date === older.date
      const headerDetail = sameDay ? `${newerTime} vs ${olderTime}` : `vs ${formatDateMMDD(older.date)}`
      const legacyDateLine = sameDay
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

      pieces.push({ date: newer.date, label, headerDetail, legacyDateLine, body })
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
    const body = formatLabSingleReport(
      entry.templateId as 'ust-cbc' | 'ust-urinalysis' | 'ust-electrolytes' | 'ust-abg' | 'others',
      entry.results ?? {},
    )
    pieces.push({ date: entry.date, label, headerDetail: '', legacyDateLine: formatDateMMDDSlash(entry.date), body })
    if (entry.id !== undefined) consumedIds.add(entry.id)
  })

  return pieces
}
