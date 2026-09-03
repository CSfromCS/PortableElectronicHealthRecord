import type { CustomAction, CustomActionCondition } from '@/types'

export const createCustomActionConditionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `condition-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Pre-populates the default Custom Actions described in issue #75, point 2. Fully editable
 * afterward — these are just a reasonable starting point, not fixed content. Runs both for
 * brand-new installs (db.on('populate')) and for existing installs upgrading through the
 * schema version that introduces Custom Actions.
 */
export const seedDefaultCustomActions = async (
  tagIdByName: Map<string, number>,
  addAction: (action: CustomAction) => Promise<number>,
): Promise<void> => {
  const now = new Date().toISOString()
  const mghTagId = tagIdByName.get('MGH')
  const cdTagId = tagIdByName.get('CD')
  const pdTagId = tagIdByName.get('PD')
  const mainTagId = tagIdByName.get('Main')
  const referralTagId = tagIdByName.get('Referral')

  const conditionRequiring = (tagIds: (number | undefined)[], checklistItems: string[]): CustomActionCondition => ({
    id: createCustomActionConditionId(),
    requiredTagIds: tagIds.filter((tagId): tagId is number => tagId !== undefined),
    checklistItems,
    tagEffects: [],
  })

  const defaults: CustomAction[] = [
    {
      name: 'Start Admission Papers',
      scope: 'patient',
      triggerType: 'manual',
      checklistItems: [
        'Admission orders written',
        'Consent for admission signed',
        'Initial labs ordered',
        'Admission note dictated',
      ],
      tagEffects: [],
      conditions: [],
      sortOrder: 0,
      createdAt: now,
    },
    {
      name: 'Start Discharge Papers (SPDP)',
      scope: 'patient',
      triggerType: 'manual',
      checklistItems: [
        'Discharge summary drafted',
        'Discharge medications reconciled',
        'Discharge instructions given',
        'Follow-up appointment scheduled',
      ],
      tagEffects: [],
      conditions: [],
      sortOrder: 1,
      createdAt: now,
    },
    {
      name: 'Start PM Papers',
      scope: 'patient',
      triggerType: 'manual',
      checklistItems: [
        'PM notification submitted',
        'PM paperwork completed',
        'Family/next-of-kin notified',
      ],
      tagEffects: [],
      conditions: [],
      sortOrder: 2,
      createdAt: now,
    },
    {
      name: 'MGH Auto-Checklist',
      scope: 'patient',
      triggerType: 'automatic',
      triggerTagId: mghTagId,
      checklistItems: [],
      tagEffects: [],
      conditions: [
        conditionRequiring([cdTagId, mainTagId], ['MGH (CD, Main): verify primary diagnosis workup', 'MGH (CD, Main): notify primary team']),
        conditionRequiring([cdTagId, referralTagId], ['MGH (CD, Referral): request referral records', 'MGH (CD, Referral): confirm accepting service']),
        conditionRequiring([pdTagId, mainTagId], ['MGH (PD, Main): verify primary diagnosis workup', 'MGH (PD, Main): notify primary team']),
        conditionRequiring([pdTagId, referralTagId], ['MGH (PD, Referral): request referral records', 'MGH (PD, Referral): confirm accepting service']),
      ],
      sortOrder: 3,
      createdAt: now,
    },
  ]

  for (const action of defaults) {
    await addAction(action)
  }
}
