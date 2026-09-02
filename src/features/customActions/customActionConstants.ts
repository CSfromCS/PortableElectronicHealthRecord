import type { CustomAction, CustomActionVariantKey, CustomActionVariants } from '@/types'

export const CUSTOM_ACTION_VARIANT_KEYS: CustomActionVariantKey[] = ['cd-main', 'cd-referral', 'pd-main', 'pd-referral']

export const CUSTOM_ACTION_VARIANT_LABELS: Record<CustomActionVariantKey, string> = {
  'cd-main': 'CD + Main',
  'cd-referral': 'CD + Referral',
  'pd-main': 'PD + Main',
  'pd-referral': 'PD + Referral',
}

export const emptyCustomActionVariants = (): CustomActionVariants => ({
  'cd-main': [],
  'cd-referral': [],
  'pd-main': [],
  'pd-referral': [],
})

const sameVariantsForAll = (items: string[]): CustomActionVariants => ({
  'cd-main': [...items],
  'cd-referral': [...items],
  'pd-main': [...items],
  'pd-referral': [...items],
})

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

  const defaults: CustomAction[] = [
    {
      name: 'Start Admission Papers',
      triggerType: 'manual',
      variants: sameVariantsForAll([
        'Admission orders written',
        'Consent for admission signed',
        'Initial labs ordered',
        'Admission note dictated',
      ]),
      tagEffects: [],
      sortOrder: 0,
      createdAt: now,
    },
    {
      name: 'Start Discharge Papers (SPDP)',
      triggerType: 'manual',
      variants: sameVariantsForAll([
        'Discharge summary drafted',
        'Discharge medications reconciled',
        'Discharge instructions given',
        'Follow-up appointment scheduled',
      ]),
      tagEffects: [],
      sortOrder: 1,
      createdAt: now,
    },
    {
      name: 'Start PM Papers',
      triggerType: 'manual',
      variants: sameVariantsForAll([
        'PM notification submitted',
        'PM paperwork completed',
        'Family/next-of-kin notified',
      ]),
      tagEffects: [],
      sortOrder: 2,
      createdAt: now,
    },
    {
      name: 'MGH Auto-Checklist',
      triggerType: 'automatic',
      triggerTagId: mghTagId,
      variants: {
        'cd-main': ['MGH (CD, Main): verify primary diagnosis workup', 'MGH (CD, Main): notify primary team'],
        'cd-referral': ['MGH (CD, Referral): request referral records', 'MGH (CD, Referral): confirm accepting service'],
        'pd-main': ['MGH (PD, Main): verify primary diagnosis workup', 'MGH (PD, Main): notify primary team'],
        'pd-referral': ['MGH (PD, Referral): request referral records', 'MGH (PD, Referral): confirm accepting service'],
      },
      tagEffects: [],
      sortOrder: 3,
      createdAt: now,
    },
  ]

  for (const action of defaults) {
    await addAction(action)
  }
}
