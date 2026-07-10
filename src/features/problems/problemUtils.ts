import type { DailyUpdate, ProblemBlock } from '@/types'

const LEGACY_DAILY_FIELDS = [
  ['fluid', 'F'],
  ['respiratory', 'R'],
  ['infectious', 'I'],
  ['cardio', 'C'],
  ['hema', 'H'],
  ['metabolic', 'M'],
  ['output', 'O'],
  ['neuro', 'N'],
  ['drugs', 'D'],
  ['other', 'Other'],
] as const

export const createProblemBlockId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `problem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const normalizeProblemBlocks = (value: unknown, idSeed = 'problem'): ProblemBlock[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Record<string, unknown>
    const title = typeof candidate.title === 'string' ? candidate.title : ''
    const notes = typeof candidate.notes === 'string' ? candidate.notes : ''
    if (!title.trim() && !notes.trim()) return []

    return [{
      id: typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id
        : `${idSeed}-${index}`,
      title,
      notes,
    }]
  })
}

export const normalizeDailyUpdate = (value: unknown): DailyUpdate => {
  const candidate = value as Record<string, unknown>
  const patientId = typeof candidate.patientId === 'number' ? candidate.patientId : 0
  const date = typeof candidate.date === 'string' ? candidate.date : ''
  const recordId = typeof candidate.id === 'number' ? candidate.id : 'new'
  const hasProblemsArray = Array.isArray(candidate.problems)
  let problems = normalizeProblemBlocks(candidate.problems, `problem-${patientId}-${date}`)

  if (!hasProblemsArray) {
    const legacyNotes = LEGACY_DAILY_FIELDS.flatMap(([field, label]) => {
      const content = typeof candidate[field] === 'string' ? candidate[field].trim() : ''
      return content ? [`${label}: ${content}`] : []
    })

    if (legacyNotes.length > 0) {
      problems = [{
        id: `legacy-${patientId}-${date}-${recordId}`,
        title: 'Legacy daily note',
        notes: legacyNotes.join('\n'),
      }]
    }
  }

  const checklist = Array.isArray(candidate.checklist)
    ? candidate.checklist.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const checklistItem = entry as Record<string, unknown>
      const text = typeof checklistItem.text === 'string' ? checklistItem.text.trim() : ''
      return text ? [{ text, completed: Boolean(checklistItem.completed) }] : []
    })
    : []

  return {
    ...(typeof candidate.id === 'number' ? { id: candidate.id } : {}),
    patientId,
    date,
    problems,
    assessment: typeof candidate.assessment === 'string' ? candidate.assessment : '',
    plans: typeof candidate.plans === 'string' ? candidate.plans : '',
    checklist,
    lastUpdated: typeof candidate.lastUpdated === 'string' ? candidate.lastUpdated : new Date().toISOString(),
  }
}