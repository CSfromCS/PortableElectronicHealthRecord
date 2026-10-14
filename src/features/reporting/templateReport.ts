import { type PatientPoolContext } from '@/features/filters/patientFilterUtils'
import {
  PLACEHOLDER_PATIENT_FOR_PRINTS_ONCE,
  type TemplateRenderContext,
  buildCurrentDateTimeText,
  classifyTemplateRepeatMode,
  renderGroupedBody,
  renderTemplateForPatient,
  resolveJoinString,
} from '@/features/templates/templateEngine'
import type {
  DailyUpdate,
  DateTimeFormatDefinition,
  LabEntry,
  MasterProblem,
  MedicationEntry,
  OrderEntry,
  Patient,
  ReportTemplate,
  TagDefinition,
  TagGroupDefinition,
  VitalEntry,
} from '@/types'

const groupByPatient = <T extends { patientId: number }>(entries: T[], sortList: (list: T[]) => void): Map<number, T[]> => {
  const grouped = new Map<number, T[]>()
  entries.forEach((entry) => {
    const list = grouped.get(entry.patientId) ?? []
    list.push(entry)
    grouped.set(entry.patientId, list)
  })
  grouped.forEach(sortList)
  return grouped
}

// Each of these is the display order the app's own tabs and reports use. They live here, not in
// App.tsx, so anything that renders a report (the app, the Medmin bridge) orders entries the same.

export const groupMedicationsByPatient = (medications: MedicationEntry[]): Map<number, MedicationEntry[]> =>
  groupByPatient(medications, (list) => {
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

export const groupLabsByPatient = (labs: LabEntry[]): Map<number, LabEntry[]> =>
  groupByPatient(labs, (list) => {
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

export const groupOrdersByPatient = (orders: OrderEntry[]): Map<number, OrderEntry[]> =>
  groupByPatient(orders, (list) => {
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

export const groupVitalsByPatient = (vitals: VitalEntry[]): Map<number, VitalEntry[]> =>
  groupByPatient(vitals, (list) => {
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.time !== b.time) return a.time.localeCompare(b.time)
      return a.createdAt.localeCompare(b.createdAt)
    })
  })

/** Every DailyUpdate row (all dates), grouped by patient — feeds the Problems/Checklist Block
 * variables in report templates, which read across dates rather than just one. */
export const groupAllDailyUpdatesByPatient = (dailyUpdates: DailyUpdate[]): Map<number, DailyUpdate[]> =>
  groupByPatient(dailyUpdates, () => undefined)

export const indexMasterProblemsById = (problems: MasterProblem[]): Map<number, MasterProblem> =>
  new Map(problems.flatMap((problem) => (problem.id === undefined ? [] : [[problem.id, problem] as const])))

export const indexDateTimeFormatsById = (formats: DateTimeFormatDefinition[]): Map<string, DateTimeFormatDefinition> =>
  new Map(formats.map((format) => [String(format.id), format]))

export type TemplateRenderData = {
  tagsById: Map<number, TagDefinition>
  tagGroups: TagGroupDefinition[]
  vitalsByPatient: Map<number, VitalEntry[]>
  labsByPatient: Map<number, LabEntry[]>
  ordersByPatient: Map<number, OrderEntry[]>
  medicationsByPatient: Map<number, MedicationEntry[]>
  dailyUpdatesByPatient: Map<number, DailyUpdate[]>
  masterProblemsById: Map<number, MasterProblem>
  dateTimeFormatsById: Map<string, DateTimeFormatDefinition>
  allPatients: Patient[]
  poolContext: PatientPoolContext
}

/** The context a template renders against. The clock is captured here, once, so every patient's
 * block in one generated report shows the identical Current Date/Time. */
export const buildTemplateRenderContext = (data: TemplateRenderData, now = new Date()): TemplateRenderContext => ({
  ...data,
  ...buildCurrentDateTimeText(now),
})

/**
 * Renders `template` across `patientsForBody` (ignored for a Prints-Once template, which only ever
 * produces one block) and stitches on the header/footer. The one place a report is assembled —
 * the Reports tab, the "run a template" custom action and the Medmin bridge all call this, so a
 * report never differs by where it was generated.
 */
export const generateTemplateOutput = (template: ReportTemplate, patientsForBody: Patient[], ctx: TemplateRenderContext): string => {
  const bodyText = template.groupingEnabled
    ? renderGroupedBody(template, patientsForBody, ctx)
    : classifyTemplateRepeatMode(template) === 'prints-once'
      ? renderTemplateForPatient(template, PLACEHOLDER_PATIENT_FOR_PRINTS_ONCE, ctx)
      : patientsForBody
        .map((patient) => renderTemplateForPatient(template, patient, ctx))
        .join(resolveJoinString(template.patientSeparator, template.customPatientSeparator))
  const headerText = template.headerPatternText
    ? renderTemplateForPatient({ patternText: template.headerPatternText, variables: template.headerVariables }, PLACEHOLDER_PATIENT_FOR_PRINTS_ONCE, ctx)
    : ''
  const footerText = template.footerPatternText
    ? renderTemplateForPatient({ patternText: template.footerPatternText, variables: template.footerVariables }, PLACEHOLDER_PATIENT_FOR_PRINTS_ONCE, ctx)
    : ''
  return [headerText, bodyText, footerText].filter((part) => part.trim() !== '').join('\n')
}
