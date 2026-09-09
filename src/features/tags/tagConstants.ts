import type { TagAutomationRole, TagDisplayType } from '@/types'

export const DEFAULT_TAG_GROUP_NAMES = [
  'Category',
  'Relationship',
  'Clinical Status',
  'Chart Type',
  'OR Status',
  'Service',
] as const

/** Name of the Tag Group holding Main Service / Referral service tags (kept out of `tagIds`, see Patient.mainServiceTagIds). */
export const SERVICE_TAG_GROUP_NAME = 'Service'

export type DefaultTagSeed = {
  name: string
  group: (typeof DEFAULT_TAG_GROUP_NAMES)[number]
  terminal: boolean
  automationRole: TagAutomationRole
  displayType: TagDisplayType
}

export const DEFAULT_TAG_SEEDS: DefaultTagSeed[] = [
  { name: 'CD', group: 'Category', terminal: false, automationRole: 'category-cd', displayType: 'emoji' },
  { name: 'PD', group: 'Category', terminal: false, automationRole: 'category-pd', displayType: 'emoji' },
  { name: 'Main', group: 'Relationship', terminal: false, automationRole: 'relationship-main', displayType: 'emoji' },
  { name: 'Referral', group: 'Relationship', terminal: false, automationRole: 'relationship-referral', displayType: 'emoji' },
  { name: 'MGH', group: 'Clinical Status', terminal: false, automationRole: 'none', displayType: 'emoji' },
  { name: 'SPDP', group: 'Clinical Status', terminal: false, automationRole: 'none', displayType: 'emoji' },
  { name: 'Discharged', group: 'Clinical Status', terminal: true, automationRole: 'status-discharged', displayType: 'emoji' },
  { name: 'Signed Out', group: 'Clinical Status', terminal: true, automationRole: 'status-signed-out', displayType: 'emoji' },
  { name: 'Transferred', group: 'Clinical Status', terminal: true, automationRole: 'none', displayType: 'emoji' },
  { name: 'Expired', group: 'Clinical Status', terminal: true, automationRole: 'status-expired', displayType: 'emoji' },
  { name: 'EHR', group: 'Chart Type', terminal: false, automationRole: 'none', displayType: 'emoji' },
  { name: 'Physical', group: 'Chart Type', terminal: false, automationRole: 'none', displayType: 'emoji' },
  { name: 'Pre-op', group: 'OR Status', terminal: false, automationRole: 'none', displayType: 'emoji' },
  { name: 'Post-op', group: 'OR Status', terminal: false, automationRole: 'none', displayType: 'emoji' },
]

export const UNGROUPED_LABEL = 'Ungrouped'

export const AUTOMATION_ROLE_LABELS: Record<TagAutomationRole, string> = {
  none: 'None',
  'category-cd': 'Category: CD',
  'category-pd': 'Category: PD',
  'relationship-main': 'Relationship: Main',
  'relationship-referral': 'Relationship: Referral',
  'status-discharged': 'Status: Discharged',
  'status-signed-out': 'Status: Signed Out',
  'status-expired': 'Status: Expired',
}

export type AutomationRoleFamily = 'category' | 'relationship'

/**
 * Automation Role "family" — point 7's ambiguity check flags 2+ applied tags whose roles fall in
 * the same family (e.g. Category: CD + Category: PD), not just literally identical roles, since
 * that's the case the issue's own example (CD + PD) describes. Discharged/Signed Out/Expired have
 * no family of their own here — they're all `terminal: true`, so applying more than one at once is
 * already caught by the separate, generic "2+ terminal tags applied" check; a family grouping too
 * would just duplicate that same warning under a second heading. */
export const AUTOMATION_ROLE_FAMILY: Record<TagAutomationRole, AutomationRoleFamily | null> = {
  none: null,
  'category-cd': 'category',
  'category-pd': 'category',
  'relationship-main': 'relationship',
  'relationship-referral': 'relationship',
  'status-discharged': null,
  'status-signed-out': null,
  'status-expired': null,
}

export const AUTOMATION_ROLE_FAMILY_LABELS: Record<AutomationRoleFamily, string> = {
  category: 'Category',
  relationship: 'Relationship',
}

/** Automation Roles whose absence would make a real feature silently stop working (report 0/empty
 * results, or a Patient Pool criterion matching nobody) rather than just losing an ambiguity hint
 * (unlike Category: CD/PD, which only feed the ambiguity check above) or a cosmetic default
 * (unlike the "Category" Tag Group name, which Census Summary falls back away from gracefully).
 * A tag carrying one of these is protected from deletion in Manage Tags — see
 * `isTagProtectedFromDeletion`. */
export const LOAD_BEARING_AUTOMATION_ROLES: TagAutomationRole[] = [
  'relationship-main',
  'relationship-referral',
  'status-discharged',
  'status-signed-out',
  'status-expired',
]

/** True for the one tag currently fulfilling a load-bearing Automation Role — deleting it would
 * silently break a real feature (see `LOAD_BEARING_AUTOMATION_ROLES`), so Manage Tags blocks
 * deletion while still allowing every other edit (color/emoji, card visibility, group, rename). */
export const isTagProtectedFromDeletion = (tag: { automationRole: TagAutomationRole }): boolean =>
  LOAD_BEARING_AUTOMATION_ROLES.includes(tag.automationRole)
