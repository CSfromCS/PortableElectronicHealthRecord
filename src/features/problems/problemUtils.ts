import type { DailyProblemNote, DailyUpdate, MasterProblem } from '@/types'

export const normalizeDailyProblemNotes = (value: unknown): DailyProblemNote[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Record<string, unknown>
    const masterProblemId = typeof candidate.masterProblemId === 'number' && Number.isFinite(candidate.masterProblemId)
      ? candidate.masterProblemId
      : null
    if (masterProblemId === null) return []

    return [{
      masterProblemId,
      notes: typeof candidate.notes === 'string' ? candidate.notes : '',
    }]
  })
}

/** Every currently-active MasterProblem for a patient, materialized as a fresh (blank-note) daily
 * entry — used to populate a brand-new date's Problems tab, replacing the old model's "copy
 * whatever wasn't completed on the prior date" (problem identity/status is now canonical on
 * MasterProblem itself, not derived from whichever date's array a problem last appeared in). */
export const buildActiveDailyProblemNotes = (masterProblems: MasterProblem[], patientId: number): DailyProblemNote[] =>
  masterProblems
    .filter((problem): problem is MasterProblem & { id: number } =>
      problem.id !== undefined && problem.patientId === patientId && problem.status === 'active')
    .map((problem) => ({ masterProblemId: problem.id, notes: '' }))

export const normalizeDailyUpdate = (value: unknown): DailyUpdate => {
  const candidate = value as Record<string, unknown>
  const patientId = typeof candidate.patientId === 'number' ? candidate.patientId : 0
  const date = typeof candidate.date === 'string' ? candidate.date : ''

  const checklist = Array.isArray(candidate.checklist)
    ? candidate.checklist.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const checklistItem = entry as Record<string, unknown>
      const text = typeof checklistItem.text === 'string' ? checklistItem.text.trim() : ''
      const notes = typeof checklistItem.notes === 'string' ? checklistItem.notes.trim() : ''
      return text ? [{ text, completed: Boolean(checklistItem.completed), ...(notes ? { notes } : {}) }] : []
    })
    : []

  return {
    ...(typeof candidate.id === 'number' ? { id: candidate.id } : {}),
    patientId,
    date,
    problems: normalizeDailyProblemNotes(candidate.problems),
    subjective: typeof candidate.subjective === 'string' ? candidate.subjective : '',
    objective: typeof candidate.objective === 'string' ? candidate.objective : '',
    assessment: typeof candidate.assessment === 'string' ? candidate.assessment : '',
    plans: typeof candidate.plans === 'string' ? candidate.plans : '',
    checklist,
    lastUpdated: typeof candidate.lastUpdated === 'string' ? candidate.lastUpdated : new Date().toISOString(),
  }
}
