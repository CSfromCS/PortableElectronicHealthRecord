import {
  DEFAULT_TAGS_VARIABLE_CONFIG,
  buildDefaultBlockVariableConfig,
  buildGroupVariableInstanceForField,
  buildVariableToken,
  createVariableId,
  type GroupFieldId,
} from './templateEngine'
import type { DateTimeComponentId, DateTimeFormatDefinition, FlatVariableId, GroupVariableInstance, ReportTemplate, TemplateVariableInstance } from '@/types'

/** Tag Combo Grouping (issue #145) off, with reasonable starting values for its fields should the
 * user turn it on — split out from `DEFAULT_TEMPLATE_EXTRAS` below so the v25 migration in db.ts
 * can backfill *just* these fields onto existing templates without touching their real, already-
 * populated header/footer/patientSeparator data. */
export const DEFAULT_GROUPING_FIELDS = {
  groupingEnabled: false,
  groupSelectionMode: 'automatic' as const,
  groupTagIds: [] as number[],
  groupCombineMode: 'OR' as const,
  groupAutomaticLabels: [] as ReportTemplate['groupAutomaticLabels'],
  groupManualCombos: [] as ReportTemplate['groupManualCombos'],
  groupLookbackHours: 12,
  groupListOpenText: ' (',
  groupListCloseText: ')',
  groupShowListBracketsWhenEmpty: false,
  groupPatternText: '',
  groupVariables: {} as Record<string, GroupVariableInstance>,
  groupSeparator: 'blankLine' as const,
  customGroupSeparator: '',
}

/** Matches this app's pre-header/footer/patient-separator/grouping behavior exactly: patients
 * joined by a blank line, no header or footer text, Tag Combo Grouping (issue #145) off. */
export const DEFAULT_TEMPLATE_EXTRAS = {
  patientSeparator: 'blankLine' as const,
  customPatientSeparator: '',
  headerPatternText: '',
  headerVariables: {} as Record<string, TemplateVariableInstance>,
  footerPatternText: '',
  footerVariables: {} as Record<string, TemplateVariableInstance>,
  ...DEFAULT_GROUPING_FIELDS,
}

/** Point 7 of issue #82: two pre-populated templates so there's a working reference point on
 * first install. "Diagnosis" in the issue's own example predates this app's Admission/Discharge
 * Diagnosis split, so it maps to Admission Diagnosis here. */
export const buildDefaultReportTemplates = (now: string): Omit<ReportTemplate, 'id'>[] => {
  const variables: Record<string, TemplateVariableInstance> = {}
  const flatToken = (variableId: FlatVariableId): string => {
    const id = createVariableId()
    variables[id] = { kind: 'flat', variableId }
    return buildVariableToken(id)
  }
  const tagsId = createVariableId()
  variables[tagsId] = { kind: 'tags', config: { ...DEFAULT_TAGS_VARIABLE_CONFIG } }

  const fullCensusPattern = [
    `${flatToken('roomNumber')} ${flatToken('ward')} — ${flatToken('lastName')}, ${flatToken('firstName')} — ${flatToken('mainService')}`,
    flatToken('admissionDiagnosis'),
    buildVariableToken(tagsId),
  ].join('\n')

  const shortListVariables: Record<string, TemplateVariableInstance> = {}
  const shortFlatToken = (variableId: FlatVariableId): string => {
    const id = createVariableId()
    shortListVariables[id] = { kind: 'flat', variableId }
    return buildVariableToken(id)
  }
  const shortListPattern = `${shortFlatToken('roomNumber')} ${shortFlatToken('ward')} — ${shortFlatToken('lastName')}`

  return [
    { name: 'Full Census', patternText: fullCensusPattern, variables, sortOrder: 0, createdAt: now, ...DEFAULT_TEMPLATE_EXTRAS },
    { name: 'Short List', patternText: shortListPattern, variables: shortListVariables, sortOrder: 1, createdAt: now, ...DEFAULT_TEMPLATE_EXTRAS },
  ]
}

/**
 * The richer, real-world set of starting templates used only for brand-new installs
 * (`db.on('populate')`) — matches this app's own maintainer's actual configured templates rather
 * than the generic placeholder set `buildDefaultReportTemplates` above still provides for installs
 * upgrading through the historical migration that first introduced Report Templates (left
 * unchanged there deliberately, since that's a one-time backfill for pre-existing installs, not a
 * "what should a first run look like" decision). Requires `tagIdByName` (built earlier in the same
 * populate hook — see `seedDefaultTagGroupsAndTags`) since the Census Summary template scopes
 * itself to the CD/PD tags by id.
 */
export const buildFirstInstallReportTemplates = (now: string, tagIdByName: Map<string, number>): Omit<ReportTemplate, 'id'>[] => {
  const variables: Record<string, TemplateVariableInstance> = {}
  const flatToken = (variableId: FlatVariableId): string => {
    const id = createVariableId()
    variables[id] = { kind: 'flat', variableId }
    return buildVariableToken(id)
  }
  const fullCensusPattern = [
    `${flatToken('roomNumber')} ${flatToken('lastName')}, ${flatToken('firstName')}`,
    `${flatToken('age')}/${flatToken('sex')}`,
    `M: ${flatToken('mainService')}`,
    flatToken('admissionDiagnosis'),
    '',
  ].join('\n')

  const shortCensusVariables: Record<string, TemplateVariableInstance> = {}
  const shortToken = (variableId: FlatVariableId): string => {
    const id = createVariableId()
    shortCensusVariables[id] = { kind: 'flat', variableId }
    return buildVariableToken(id)
  }
  const shortCensusPattern = `${shortToken('roomNumber')} ${shortToken('ward')} — ${shortToken('lastName')}`

  const errandsVariables: Record<string, TemplateVariableInstance> = {}
  const errandsFlatToken = (variableId: FlatVariableId): string => {
    const id = createVariableId()
    errandsVariables[id] = { kind: 'flat', variableId }
    return buildVariableToken(id)
  }
  const checklistEntryFieldIds: Record<string, string> = {}
  const checklistToken = (fieldId: string): string => {
    const id = createVariableId()
    checklistEntryFieldIds[id] = fieldId
    return buildVariableToken(id)
  }
  const checklistVariableId = createVariableId()
  errandsVariables[checklistVariableId] = {
    kind: 'block',
    variableId: 'checklist',
    config: {
      ...buildDefaultBlockVariableConfig('checklist'),
      rangeMode: 'dateRange',
      relativeMode: 'lastNDays',
      lastNDays: 5,
      entryCount: 3,
      entryFieldIds: checklistEntryFieldIds,
      entryPatternText: `${checklistToken('checkbox')} ${checklistToken('itemText')}`,
      entrySeparator: 'lineBreak',
      showGroupHeader: false,
      groupSeparator: 'lineBreak',
      checkedGlyph: '✅',
      uncheckedGlyph: '⭕',
    },
  }
  const errandsPattern = `${errandsFlatToken('roomNumber')} ${errandsFlatToken('lastName')}\n${buildVariableToken(checklistVariableId)}\n`

  // Census summary CD vs PD — Tag Combo Grouping (issue #145): the group format renders a label
  // plus each status's tally/list, and the main per-patient pattern (just Last Name, matching what
  // the old Census-Summary-only Patient Row used to render) is what "New Admissions (list)" etc
  // embed for each matching patient.
  const groupVariables: Record<string, GroupVariableInstance> = {}
  const groupToken = (fieldId: GroupFieldId): string => {
    const id = createVariableId()
    groupVariables[id] = buildGroupVariableInstanceForField(fieldId)
    return buildVariableToken(id)
  }
  const groupPatternText = [
    groupToken('groupLabel'),
    `Admitted ${groupToken('admittedTally')} patients ${groupToken('admittedList')}`,
    `Referred ${groupToken('referredTally')} patients ${groupToken('referredList')}`,
    `Discharged ${groupToken('dischargedTally')} patients ${groupToken('dischargedList')}`,
  ].join('\n')

  const censusVariables: Record<string, TemplateVariableInstance> = {}
  const censusFlatToken = (variableId: FlatVariableId): string => {
    const id = createVariableId()
    censusVariables[id] = { kind: 'flat', variableId }
    return buildVariableToken(id)
  }

  return [
    { name: 'Full Census', patternText: fullCensusPattern, variables, sortOrder: 0, createdAt: now, ...DEFAULT_TEMPLATE_EXTRAS },
    { name: 'Short census', patternText: shortCensusPattern, variables: shortCensusVariables, sortOrder: 1, createdAt: now, ...DEFAULT_TEMPLATE_EXTRAS },
    { name: 'Errands list', patternText: errandsPattern, variables: errandsVariables, sortOrder: 2, createdAt: now, ...DEFAULT_TEMPLATE_EXTRAS },
    {
      name: 'Census summary CD vs PD (past 12 hours)',
      patternText: censusFlatToken('lastName'),
      variables: censusVariables,
      sortOrder: 4,
      createdAt: now,
      ...DEFAULT_TEMPLATE_EXTRAS,
      groupingEnabled: true,
      groupSelectionMode: 'automatic',
      groupTagIds: [tagIdByName.get('CD'), tagIdByName.get('PD')].filter((id): id is number => id !== undefined),
      groupCombineMode: 'OR',
      groupLookbackHours: 12,
      groupListOpenText: ' (',
      groupListCloseText: ')',
      groupShowListBracketsWhenEmpty: false,
      groupPatternText,
      groupVariables,
      groupSeparator: 'blankLine',
    },
  ]
}

/** The built-in, locked "Labs" template — Labs' if/then comparison-mode formatting
 * (`buildLabReportBlocks`) is algorithmic, not field-composable like Vitals/Orders/Problems/
 * Checklist, so rather than exposing it for editing this just wraps the existing Labs Block
 * variable (defaulted to its 2-entry comparison mode) as a single ready-to-use template. Users
 * choose whether to include it in a report the same way as any other template — they just can't
 * edit or delete it. */
export const buildLockedLabsTemplate = (now: string, sortOrder: number): Omit<ReportTemplate, 'id'> => {
  const id = createVariableId()
  const variables: Record<string, TemplateVariableInstance> = {
    [id]: {
      kind: 'block',
      variableId: 'labs',
      config: { ...buildDefaultBlockVariableConfig('labs'), rangeMode: 'numberOfEntries', entryCount: 2 },
    },
  }
  return { name: 'Labs', patternText: buildVariableToken(id), variables, sortOrder, createdAt: now, locked: true, ...DEFAULT_TEMPLATE_EXTRAS }
}

/** A handful of common date/time display formats so the Date & Time Formats screen isn't empty on
 * first install — matches this app's existing MM-DD-YYYY convention plus a couple of common
 * clinical alternatives. */
export const buildDefaultDateTimeFormats = (now: string): Omit<DateTimeFormatDefinition, 'id'>[] => {
  const buildFormat = (name: string, sortOrder: number, parts: Array<{ component: DateTimeComponentId } | { text: string }>): Omit<DateTimeFormatDefinition, 'id'> => {
    const componentIdsById: Record<string, DateTimeComponentId> = {}
    const patternText = parts
      .map((part) => {
        if ('text' in part) return part.text
        const id = createVariableId()
        componentIdsById[id] = part.component
        return buildVariableToken(id)
      })
      .join('')
    return { name, patternText, componentIds: componentIdsById, sortOrder, createdAt: now }
  }

  return [
    buildFormat('MM-DD-YYYY', 0, [
      { component: 'monthNum2' }, { text: '-' }, { component: 'day2' }, { text: '-' }, { component: 'year4' },
    ]),
    buildFormat('Mon D, YYYY', 1, [
      { component: 'monthAbbrev' }, { text: ' ' }, { component: 'dayNoLeadingZero' }, { text: ', ' }, { component: 'year4' },
    ]),
    buildFormat('h:mm A', 2, [
      { component: 'hour12NoLeadingZero' }, { text: ':' }, { component: 'minute2' }, { text: ' ' }, { component: 'meridiemUpper' },
    ]),
  ]
}
