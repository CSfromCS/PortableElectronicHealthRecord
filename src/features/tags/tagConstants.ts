import type { TagAutomationRole, TagDisplayType } from '@/types'

export const DEFAULT_TAG_GROUP_NAMES = [
  'CD vs PD',
  'Main vs Referral',
  'MGH status',
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
  emoji?: string
  color?: string
  displayText?: string
}

export const DEFAULT_TAG_SEEDS: DefaultTagSeed[] = [
  { name: 'CD', group: 'CD vs PD', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '❤️' },
  { name: 'PD', group: 'CD vs PD', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '💵' },
  { name: 'Main', group: 'Main vs Referral', terminal: false, automationRole: 'relationship-main', displayType: 'color', color: '#000000', displayText: 'M' },
  { name: 'Referral', group: 'Main vs Referral', terminal: false, automationRole: 'relationship-referral', displayType: 'color', color: '#ffffff', displayText: 'R' },
  { name: 'MGH', group: 'MGH status', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '🏠' },
  { name: 'SPDP', group: 'MGH status', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '🏠' },
  { name: 'Discharged', group: 'MGH status', terminal: true, automationRole: 'status-discharged', displayType: 'emoji', emoji: '🚶‍➡️' },
  { name: 'Signed Out', group: 'MGH status', terminal: true, automationRole: 'status-signed-out', displayType: 'emoji', emoji: '👋' },
  { name: 'Transferred', group: 'MGH status', terminal: true, automationRole: 'none', displayType: 'emoji', emoji: '🚗' },
  { name: 'Expired', group: 'MGH status', terminal: true, automationRole: 'status-expired', displayType: 'emoji', emoji: '🕊️' },
  { name: 'EHR', group: 'Chart Type', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '🖥️' },
  { name: 'Physical', group: 'Chart Type', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '📋' },
  { name: 'Pre-op', group: 'OR Status', terminal: false, automationRole: 'none', displayType: 'color', color: '#50ced7' },
  { name: 'Post-op', group: 'OR Status', terminal: false, automationRole: 'none', displayType: 'emoji', emoji: '🩹' },
  { name: 'Obstetrics', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#ffc2c2', displayText: 'OB' },
  { name: 'Gynecology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#ffc2c2', displayText: 'GYN' },
  { name: 'Family Medicine', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c98a5e', displayText: 'Fam Med' },
  { name: 'Neurology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#f7f382', displayText: 'Neuro' },
  { name: 'Psychiatrics', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#f7f382', displayText: 'Psych' },
  { name: 'Otorhinolaryngology and Head and Neck Surgery', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#92ee90', displayText: 'ENT' },
  { name: 'Ophthalmology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#92ee90', displayText: 'Ophtha' },
  { name: 'Rehabilitation Medicine', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#92ee90', displayText: 'Rehab Med' },
  { name: 'Dermatology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#92ee90', displayText: 'Derma' },
  { name: 'Internal Medicine', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'IM' },
  { name: 'Cardiovascular', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'CV' },
  { name: 'Endocrinology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'Endo' },
  { name: 'Gastroenterology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'GI' },
  { name: 'Pulmonology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'Pulmo' },
  { name: 'Nephrology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'Nephro' },
  { name: 'Infectious Disease', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'IDS' },
  { name: 'Hematology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'Hema' },
  { name: 'Medical Oncology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'Med Onco' },
  { name: 'Rheumatology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#82d0f7', displayText: 'Rheuma' },
  { name: 'Pediatrics', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#f0a966', displayText: 'Pedia' },
  { name: 'General Surgery', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c975f0', displayText: 'GS' },
  { name: 'Urology', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c975f0', displayText: 'Uro' },
  { name: 'Thoracic and Cardiovascular Surgery', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c975f0', displayText: 'TCVS' },
  { name: 'Orthopedics', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c975f0', displayText: 'Ortho' },
  { name: 'Neurosurgery', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c975f0', displayText: 'NSx' },
  { name: 'Plastics, Reconstructive, and Aesthetic Surgery', group: 'Service', terminal: false, automationRole: 'none', displayType: 'color', color: '#c975f0', displayText: 'PRAS' },
]

export const UNGROUPED_LABEL = 'Ungrouped'

export const AUTOMATION_ROLE_LABELS: Record<TagAutomationRole, string> = {
  none: 'None',
  'relationship-main': 'Relationship: Main',
  'relationship-referral': 'Relationship: Referral',
  'status-discharged': 'Status: Discharged',
  'status-signed-out': 'Status: Signed Out',
  'status-expired': 'Status: Expired',
}

export type AutomationRoleFamily = 'relationship'

/**
 * Automation Role "family" — point 7's ambiguity check flags 2+ applied tags whose roles fall in
 * the same family, not just literally identical roles. Discharged/Signed Out/Expired have no
 * family of their own here — they're all `terminal: true`, so applying more than one at once is
 * already caught by the separate, generic "2+ terminal tags applied" check; a family grouping too
 * would just duplicate that same warning under a second heading. */
export const AUTOMATION_ROLE_FAMILY: Record<TagAutomationRole, AutomationRoleFamily | null> = {
  none: null,
  'relationship-main': 'relationship',
  'relationship-referral': 'relationship',
  'status-discharged': null,
  'status-signed-out': null,
  'status-expired': null,
}

export const AUTOMATION_ROLE_FAMILY_LABELS: Record<AutomationRoleFamily, string> = {
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
