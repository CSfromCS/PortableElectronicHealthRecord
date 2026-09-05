import {
  DEFAULT_TAGS_VARIABLE_CONFIG,
  buildDefaultBlockVariableConfig,
  buildVariableToken,
  createVariableId,
} from './templateEngine'
import type { DateTimeComponentId, DateTimeFormatDefinition, FlatVariableId, ReportTemplate, TemplateVariableInstance } from '@/types'

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
    { name: 'Full Census', patternText: fullCensusPattern, variables, sortOrder: 0, createdAt: now },
    { name: 'Short List', patternText: shortListPattern, variables: shortListVariables, sortOrder: 1, createdAt: now },
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
  return { name: 'Labs', patternText: buildVariableToken(id), variables, sortOrder, createdAt: now, locked: true }
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
