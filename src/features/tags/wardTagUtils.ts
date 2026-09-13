import { db } from '@/db'
import type { Patient, TagDefinition, TagGroupDefinition } from '@/types'
import { WARD_TAG_GROUP_NAME } from './tagConstants'

export const findWardTagByName = (name: string, wardTags: TagDefinition[]): TagDefinition | undefined => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return undefined
  return wardTags.find((tag) => tag.name.trim().toLowerCase() === normalized)
}

/** Finds the "Ward" Tag Group, creating it if it's ever missing (e.g. deleted via Manage Tags). */
export const ensureWardGroupId = async (groups: TagGroupDefinition[]): Promise<number> => {
  const existing = groups.find((group) => group.name === WARD_TAG_GROUP_NAME)
  if (existing?.id !== undefined) return existing.id

  const nextSortOrder = groups.length > 0 ? Math.max(...groups.map((group) => group.sortOrder)) + 1 : 0
  return db.tagGroups.add({ name: WARD_TAG_GROUP_NAME, sortOrder: nextSortOrder }) as Promise<number>
}

/** Unlike getOrCreateServiceTag, a newly created ward tag starts with no color/emoji/displayText —
 * see `isWardTagCustomized` — so it renders as plain text (matching the old free-text ward field's
 * appearance) until the user deliberately styles it in Manage Tags. */
export const getOrCreateWardTag = async (
  name: string,
  existingWardTags: TagDefinition[],
  wardGroupId: number,
): Promise<TagDefinition> => {
  const trimmed = name.trim()
  const existing = findWardTagByName(trimmed, existingWardTags)
  if (existing) return existing

  const now = new Date().toISOString()
  const nextSortOrder = existingWardTags.length > 0 ? Math.max(...existingWardTags.map((tag) => tag.sortOrder)) + 1 : 0
  const newTag: Omit<TagDefinition, 'id'> = {
    name: trimmed,
    displayType: 'color',
    groupId: wardGroupId,
    sortOrder: nextSortOrder,
    // Ward is shown inline on the patient card (see App.tsx), not the general tag chip row.
    visibleOnPatientCard: false,
    terminal: false,
    automationRole: 'none',
    createdAt: now,
  }
  const id = await db.tagDefinitions.add(newTag)
  return { ...newTag, id }
}

/** A ward tag with no color, emoji, or display text set has never been deliberately styled —
 * render it as plain text (matching the old free-text ward field) rather than a chip. */
export const isWardTagCustomized = (tag: TagDefinition): boolean =>
  Boolean(tag.color) || Boolean(tag.emoji) || Boolean(tag.displayText)

export const setPatientWardTag = async (patient: Patient, tag: TagDefinition): Promise<void> => {
  if (patient.id === undefined || tag.id === undefined) return
  await db.patients.update(patient.id, { wardTagId: tag.id, lastModified: new Date().toISOString() })
}

export const clearPatientWardTag = async (patient: Patient): Promise<void> => {
  if (patient.id === undefined) return
  await db.patients.update(patient.id, { wardTagId: undefined, lastModified: new Date().toISOString() })
}

export const resolveWardTag = (wardTagId: number | undefined, tagsById: Map<number, TagDefinition>): TagDefinition | undefined =>
  wardTagId !== undefined ? tagsById.get(wardTagId) : undefined
