import { DEFAULT_TAGS_VARIABLE_CONFIG, buildVariableToken, createVariableId } from './templateEngine'
import type { FlatVariableId, ReportTemplate, TemplateVariableInstance } from '@/types'

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
