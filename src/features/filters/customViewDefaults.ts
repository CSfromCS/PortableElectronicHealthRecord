import type { CustomView } from '@/types'

/**
 * The real-world set of starting Custom Views used only for brand-new installs
 * (`db.on('populate')`) — matches this app's own maintainer's actual configured views: the four
 * Category × Relationship combinations (CD/PD × Main/Referral) that come up every rounds. Fully
 * editable/deletable afterward, same as the default Custom Actions and Report Templates — just a
 * reasonable starting point. Tags resolved by name against `tagIdByName` (built earlier in the
 * same populate hook — see `seedDefaultTagGroupsAndTags`) rather than hardcoded ids, so this stays
 * correct regardless of insertion order.
 */
export const buildDefaultCustomViews = (now: string, tagIdByName: Map<string, number>): Omit<CustomView, 'id'>[] => {
  const cdTagId = tagIdByName.get('CD')
  const pdTagId = tagIdByName.get('PD')
  const mainTagId = tagIdByName.get('Main')
  const referralTagId = tagIdByName.get('Referral')

  const view = (
    name: string,
    tagIds: (number | undefined)[],
    tagMode: 'AND' | 'OR',
    sortOrder: number,
  ): Omit<CustomView, 'id'> => ({
    name,
    tagIds: tagIds.filter((id): id is number => id !== undefined),
    tagMode,
    wards: [],
    sortOrder,
    createdAt: now,
  })

  return [
    view('CD main', [cdTagId, mainTagId], 'AND', 0),
    view('PD Main', [pdTagId, mainTagId], 'AND', 1),
    view('CD referral', [cdTagId, referralTagId], 'AND', 2),
    view('PD referral', [pdTagId, referralTagId], 'AND', 3),
  ]
}
