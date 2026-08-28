export type RoomSplitResult = {
  roomNumber: string
  ward: string
  /** Set only when the split was ambiguous — original value is preserved here rather than discarded. */
  roomLegacyRaw?: string
}

// Only delimiters that are unlikely to appear inside a bare room number/ward value on their own
// (e.g. a hyphenated room like "512-A" must NOT get split). A bare hyphen is deliberately excluded.
const SPLIT_PATTERNS = [/\s[-–—]\s/, /\s*\/\s*/, /\s*,\s*/, /\s*\|\s*/]

/**
 * Best-effort split of a legacy combined "Room" value into Room Number + Ward/Location.
 * Only splits on an explicit delimiter; a value with no delimiter is assumed to be a bare room
 * number (the common case) and is left whole with Ward blank — nothing ambiguous about that.
 * A delimiter that doesn't cleanly produce exactly two non-empty parts is treated as ambiguous:
 * the original value is kept as Room Number (no data loss) and mirrored into roomLegacyRaw as a
 * fallback display until manually resolved.
 */
export const splitCombinedRoomValue = (raw: string): RoomSplitResult => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { roomNumber: '', ward: '' }
  }

  for (const pattern of SPLIT_PATTERNS) {
    if (!pattern.test(trimmed)) continue

    const parts = trimmed.split(pattern).map((part) => part.trim()).filter(Boolean)
    if (parts.length === 2) {
      return { roomNumber: parts[0], ward: parts[1] }
    }

    return { roomNumber: trimmed, ward: '', roomLegacyRaw: trimmed }
  }

  return { roomNumber: trimmed, ward: '' }
}
