import type { TagDefinition } from '@/types'

export const findServiceTagByName = (name: string, serviceTags: TagDefinition[]): TagDefinition | undefined => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return undefined
  return serviceTags.find((tag) => tag.name.trim().toLowerCase() === normalized)
}

/** Splits legacy free-text service lines the way the old field encoded them: line 1 (comma/semicolon-separated) was Main Service(s), each subsequent line was one Referral. */
export const parseLegacyServiceText = (service: string): { mainNames: string[]; referralNames: string[] } => {
  const lines = service.split('\n').map((line) => line.trim()).filter(Boolean)
  const mainNames = (lines[0] ?? '')
    .split(/[,;]/)
    .map((name) => name.trim())
    .filter(Boolean)
  const referralNames = lines.slice(1).filter(Boolean)
  return { mainNames, referralNames }
}
