import { DEFAULT_TAGS_VARIABLE_CONFIG, createSegmentId } from './templateEngine'
import type { FlatVariableId, ReportTemplate, TemplateSegment } from '@/types'

const text = (value: string): TemplateSegment => ({ id: createSegmentId(), type: 'text', text: value })
const lineBreak = (): TemplateSegment => ({ id: createSegmentId(), type: 'lineBreak' })
const flat = (variableId: FlatVariableId): TemplateSegment => ({ id: createSegmentId(), type: 'flatVariable', variableId })
const tags = (): TemplateSegment => ({ id: createSegmentId(), type: 'tagsVariable', config: { ...DEFAULT_TAGS_VARIABLE_CONFIG } })

/** Point 7 of issue #82: two pre-populated templates so there's a working reference point on
 * first install. "Diagnosis" in the issue's own example predates this app's Admission/Discharge
 * Diagnosis split, so it maps to Admission Diagnosis here. */
export const buildDefaultReportTemplates = (now: string): Omit<ReportTemplate, 'id'>[] => [
  {
    name: 'Full Census',
    sortOrder: 0,
    createdAt: now,
    segments: [
      flat('roomNumber'), text(' '), flat('ward'), text(' — '), flat('lastName'), text(', '), flat('firstName'), text(' — '), flat('mainService'),
      lineBreak(),
      flat('admissionDiagnosis'),
      lineBreak(),
      tags(),
    ],
  },
  {
    name: 'Short List',
    sortOrder: 1,
    createdAt: now,
    segments: [
      flat('roomNumber'), text(' '), flat('ward'), text(' — '), flat('lastName'),
    ],
  },
]
