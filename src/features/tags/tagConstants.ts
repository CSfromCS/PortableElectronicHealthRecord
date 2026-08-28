import type { TagAutomationRole, TagDisplayType } from '@/types'

export const DEFAULT_TAG_GROUP_NAMES = [
  'Category',
  'Relationship',
  'Clinical Status',
  'Chart Type',
  'OR Status',
] as const

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
  { name: 'Discharged', group: 'Clinical Status', terminal: true, automationRole: 'none', displayType: 'emoji' },
  { name: 'Signed Out', group: 'Clinical Status', terminal: true, automationRole: 'none', displayType: 'emoji' },
  { name: 'Transferred', group: 'Clinical Status', terminal: true, automationRole: 'none', displayType: 'emoji' },
  { name: 'Expired', group: 'Clinical Status', terminal: true, automationRole: 'none', displayType: 'emoji' },
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
}

export type AutomationRoleFamily = 'category' | 'relationship'

/**
 * Automation Role "family" — point 7's ambiguity check flags 2+ applied tags whose roles fall in
 * the same family (e.g. Category: CD + Category: PD), not just literally identical roles, since
 * that's the case the issue's own example (CD + PD) describes.
 */
export const AUTOMATION_ROLE_FAMILY: Record<TagAutomationRole, AutomationRoleFamily | null> = {
  none: null,
  'category-cd': 'category',
  'category-pd': 'category',
  'relationship-main': 'relationship',
  'relationship-referral': 'relationship',
}

export const AUTOMATION_ROLE_FAMILY_LABELS: Record<AutomationRoleFamily, string> = {
  category: 'Category',
  relationship: 'Relationship',
}
