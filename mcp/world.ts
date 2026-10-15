import { db } from '@/db'
import { groupDailyUpdatesByPatientSorted } from '@/features/checklist/masterChecklist'
import { buildPatientPoolContext } from '@/features/filters/patientFilterUtils'
import {
  type TemplateRenderData,
  groupAllDailyUpdatesByPatient,
  groupLabsByPatient,
  groupMedicationsByPatient,
  groupOrdersByPatient,
  groupVitalsByPatient,
  indexDateTimeFormatsById,
  indexMasterProblemsById,
} from '@/features/reporting/templateReport'
import type {
  CustomAction,
  CustomView,
  DailyUpdate,
  LabEntry,
  MasterProblem,
  MedicationEntry,
  OrderEntry,
  Patient,
  ReportTemplate,
  SimpleProblemItem,
  TagDefinition,
  TagEvent,
  TagGroupDefinition,
  VitalEntry,
} from '@/types'

/** A snapshot of the room as the app would hold it in memory — the same maps, built the same way. */
export type World = {
  patients: Patient[]
  patientsById: Map<number, Patient>
  tagGroups: TagGroupDefinition[]
  tagsById: Map<number, TagDefinition>
  tagEvents: TagEvent[]
  views: CustomView[]
  customActions: CustomAction[]
  templates: ReportTemplate[]
  masterProblems: MasterProblem[]
  simpleProblemItems: SimpleProblemItem[]
  vitalsByPatient: Map<number, VitalEntry[]>
  labsByPatient: Map<number, LabEntry[]>
  ordersByPatient: Map<number, OrderEntry[]>
  medicationsByPatient: Map<number, MedicationEntry[]>
  /** Oldest date first, General checklist (patientId -1) included — what the Master Checklist reads. */
  dailyUpdatesSorted: Map<number, DailyUpdate[]>
  renderData: TemplateRenderData
}

export const loadWorld = async (): Promise<World> => {
  const [
    patients, tagGroups, tagDefinitions, tagEvents, views, customActions, templates, dateTimeFormats,
    masterProblems, simpleProblemItems, vitals, labs, orders, medications, dailyUpdates,
  ] = await Promise.all([
    db.patients.toArray(),
    db.tagGroups.toArray(),
    db.tagDefinitions.toArray(),
    db.tagEvents.toArray(),
    db.customViews.toArray(),
    db.customActions.toArray(),
    db.reportTemplates.toArray(),
    db.dateTimeFormats.toArray(),
    db.masterProblems.toArray(),
    db.simpleProblemItems.toArray(),
    db.vitals.toArray(),
    db.labs.toArray(),
    db.orders.toArray(),
    db.medications.toArray(),
    db.dailyUpdates.toArray(),
  ])

  const tagsById = new Map(tagDefinitions.map((tag) => [tag.id as number, tag]))
  const vitalsByPatient = groupVitalsByPatient(vitals)
  const labsByPatient = groupLabsByPatient(labs)
  const ordersByPatient = groupOrdersByPatient(orders)
  const medicationsByPatient = groupMedicationsByPatient(medications)

  return {
    patients,
    patientsById: new Map(patients.map((patient) => [patient.id as number, patient])),
    tagGroups,
    tagsById,
    tagEvents,
    views: [...views].sort((a, b) => a.sortOrder - b.sortOrder),
    customActions: [...customActions].sort((a, b) => a.sortOrder - b.sortOrder),
    templates: [...templates].sort((a, b) => a.sortOrder - b.sortOrder),
    masterProblems,
    simpleProblemItems,
    vitalsByPatient,
    labsByPatient,
    ordersByPatient,
    medicationsByPatient,
    dailyUpdatesSorted: groupDailyUpdatesByPatientSorted(dailyUpdates),
    renderData: {
      tagsById,
      tagGroups,
      vitalsByPatient,
      labsByPatient,
      ordersByPatient,
      medicationsByPatient,
      dailyUpdatesByPatient: groupAllDailyUpdatesByPatient(dailyUpdates),
      masterProblemsById: indexMasterProblemsById(masterProblems),
      dateTimeFormatsById: indexDateTimeFormatsById(dateTimeFormats),
      allPatients: patients,
      poolContext: buildPatientPoolContext(tagsById, tagEvents),
    },
  }
}
