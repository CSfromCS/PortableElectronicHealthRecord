import type { DailyProblemNote, DailyUpdate, MasterProblem } from '@/types'

/** 'a', 'b', 'c', ... for a sub-problem's position among its siblings — appended to the parent's
 * own number (see `buildMasterProblemLabels`) to form its label, e.g. "1a", "1b". */
export const subProblemLabelSuffix = (index: number): string => String.fromCharCode(97 + index)

/** Labels every problem the same way the Master Problem List numbers them — "1", "2", ... for
 * top-level problems (in `sortOrder`) and "1a", "1b", "2a", ... for their sub-problems (also in
 * `sortOrder`) — so any other view referencing a problem by id (e.g. the Simple Problem List's
 * group badges) always shows the same number the user sees there, sub-problems included. Accepts
 * every problem for a patient regardless of status, so a since-resolved problem still labels
 * correctly. */
export const buildMasterProblemLabels = (problems: MasterProblem[]): Map<number, string> => {
  const topLevel = problems.filter((problem) => problem.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)
  const childrenByParentId = new Map<number, MasterProblem[]>()
  problems.forEach((problem) => {
    if (problem.parentId === null || problem.id === undefined) return
    const list = childrenByParentId.get(problem.parentId) ?? []
    list.push(problem)
    childrenByParentId.set(problem.parentId, list)
  })
  childrenByParentId.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder))

  const labels = new Map<number, string>()
  topLevel.forEach((problem, index) => {
    if (problem.id === undefined) return
    labels.set(problem.id, String(index + 1))
    const children = childrenByParentId.get(problem.id) ?? []
    children.forEach((child, childIndex) => {
      if (child.id === undefined) return
      labels.set(child.id, `${index + 1}${subProblemLabelSuffix(childIndex)}`)
    })
  })
  return labels
}

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
