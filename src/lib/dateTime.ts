export const toLocalISODate = (date = new Date()) => {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10)
}

export const toLocalTime = (date = new Date()) => {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

export const parseNumericInput = (value: string | undefined): number | null => {
  const sanitized = (value ?? '').trim().replaceAll(',', '').replaceAll('%', '')
  if (!sanitized) return null

  const parsed = Number.parseFloat(sanitized)
  return Number.isFinite(parsed) ? parsed : null
}

export const formatCalculatedNumber = (value: number, decimals = 2): string => {
  if (!Number.isFinite(value)) return ''
  const rounded = Number.parseFloat(value.toFixed(decimals))
  return rounded.toString()
}

export const formatDateMMDDYYYY = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) return isoDate
  return `${month}-${day}-${year}`
}

export const formatDateMMDD = (isoDate: string) => {
  const [, month, day] = isoDate.split('-')
  if (!month || !day) return isoDate
  return `${month}-${day}`
}

export const formatDateShortMonthDay = (isoDate: string) => {
  const [yearText, monthText, dayText] = isoDate.split('-')
  const year = Number.parseInt(yearText ?? '', 10)
  const month = Number.parseInt(monthText ?? '', 10)
  const day = Number.parseInt(dayText ?? '', 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return isoDate

  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return isoDate

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

export const formatClock = (time: string) => {
  const [hourText, minuteText = '00'] = time.split(':')
  const hour = Number.parseInt(hourText, 10)
  const minute = Number.parseInt(minuteText, 10)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return time
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`
}

export const formatClockCompact = (time: string) => {
  const [hourText, minuteText = '00'] = time.split(':')
  const hour = Number.parseInt(hourText, 10)
  const minute = Number.parseInt(minuteText, 10)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return time
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  if (minute === 0) return `${hour12}${suffix}`
  return `${hour12}:${minute.toString().padStart(2, '0')}${suffix}`
}

export const toDateTimeStamp = (date: string, time?: string, fallback?: string) => {
  const safeTime = time && time.trim().length > 0 ? time : '00:00'
  const iso = `${date}T${safeTime}`
  const parsed = Date.parse(iso)
  if (Number.isFinite(parsed)) return parsed
  if (fallback) {
    const fallbackParsed = Date.parse(fallback)
    if (Number.isFinite(fallbackParsed)) return fallbackParsed
  }
  return Number.NaN
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const monthIndexFromName = (raw: string): number | null => {
  const normalized = raw.trim().toLowerCase()
  if (normalized.length < 3) return null
  const index = MONTH_NAMES.findIndex((name) => name.startsWith(normalized))
  return index === -1 ? null : index
}

const normalizeYear = (rawYear: string | undefined, referenceYear: number): number => {
  if (!rawYear) return referenceYear
  const year = Number.parseInt(rawYear, 10)
  if (rawYear.length >= 4) return year
  return year <= 68 ? 2000 + year : 1900 + year
}

const buildIsoDate = (year: number, monthIndex: number, day: number): FlexibleDateParseResult => {
  if (monthIndex < 0 || monthIndex > 11) return { ok: false, error: 'Enter a valid month.' }
  if (day < 1 || day > 31) return { ok: false, error: 'Enter a valid day.' }

  const date = new Date(year, monthIndex, day)
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return { ok: false, error: "That date doesn't exist." }
  }

  const mm = (monthIndex + 1).toString().padStart(2, '0')
  const dd = day.toString().padStart(2, '0')
  return { ok: true, iso: `${year}-${mm}-${dd}` }
}

export type FlexibleDateParseResult =
  | { ok: true; iso: string }
  | { ok: false; error: string }

/**
 * Permissively parses free-typed date entry (e.g. "jan 1", "1/1", "01/01", "january 1",
 * "01 jan", "jan 1 2026", "1/1/26") into an ISO yyyy-mm-dd string. Numeric month/day order
 * (not day/month) matches the MM-DD-YYYY convention used elsewhere in this app.
 */
export const parseFlexibleDate = (input: string, referenceDate = new Date()): FlexibleDateParseResult => {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Enter a date.' }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return buildIsoDate(Number.parseInt(y, 10), Number.parseInt(m, 10) - 1, Number.parseInt(d, 10))
  }

  const monthFirstMatch = /^([a-zA-Z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{2,4})?$/.exec(trimmed)
  if (monthFirstMatch) {
    const [, monthRaw, dayRaw, yearRaw] = monthFirstMatch
    const monthIndex = monthIndexFromName(monthRaw)
    if (monthIndex === null) return { ok: false, error: `Unrecognized month "${monthRaw}".` }
    return buildIsoDate(normalizeYear(yearRaw, referenceDate.getFullYear()), monthIndex, Number.parseInt(dayRaw, 10))
  }

  const dayFirstMatch = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]{3,})\.?,?\s*(\d{2,4})?$/.exec(trimmed)
  if (dayFirstMatch) {
    const [, dayRaw, monthRaw, yearRaw] = dayFirstMatch
    const monthIndex = monthIndexFromName(monthRaw)
    if (monthIndex === null) return { ok: false, error: `Unrecognized month "${monthRaw}".` }
    return buildIsoDate(normalizeYear(yearRaw, referenceDate.getFullYear()), monthIndex, Number.parseInt(dayRaw, 10))
  }

  const numericMatch = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(trimmed)
  if (numericMatch) {
    const [, monthRaw, dayRaw, yearRaw] = numericMatch
    return buildIsoDate(
      normalizeYear(yearRaw, referenceDate.getFullYear()),
      Number.parseInt(monthRaw, 10) - 1,
      Number.parseInt(dayRaw, 10),
    )
  }

  return { ok: false, error: 'Unrecognized date. Try "Jan 1", "1/1", or "Jan 1 2026".' }
}

/** Formats an ISO yyyy-mm-dd date as an unambiguous, fully resolved string, e.g. "January 1, 2026". */
export const formatFlexibleDateConfirmation = (isoDate: string): string => {
  const [yearText, monthText, dayText] = isoDate.split('-')
  const year = Number.parseInt(yearText ?? '', 10)
  const month = Number.parseInt(monthText ?? '', 10)
  const day = Number.parseInt(dayText ?? '', 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return isoDate
  if (month < 1 || month > 12) return isoDate

  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return isoDate

  // Fixed "D Mon YYYY" format (not locale-dependent) so the confirmation reads the same for
  // every user regardless of browser locale.
  const shortMonthName = MONTH_NAMES[month - 1]
  const capitalizedMonth = `${shortMonthName[0].toUpperCase()}${shortMonthName.slice(1, 3)}`
  return `${day} ${capitalizedMonth} ${year}`
}

export type FlexibleTimeParseResult =
  | { ok: true; hhmm: string }
  | { ok: false; error: string }

const buildHhmm = (hour: number, minute: number): FlexibleTimeParseResult => {
  if (hour < 0 || hour > 23) return { ok: false, error: 'Enter a valid hour.' }
  if (minute < 0 || minute > 59) return { ok: false, error: 'Enter a valid minute.' }
  return { ok: true, hhmm: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` }
}

/**
 * Permissively parses free-typed time entry into a 24h "HH:MM" string. A trailing am/pm
 * marker ("8pm", "7:30 pm", "3 p.m.") resolves a 12-hour hour; without one, the input is
 * treated as already 24-hour ("15:00", "1500", "1500H", "730" -> 07:30), matching standard
 * clinical/military time notation.
 */
export const parseFlexibleTime = (input: string): FlexibleTimeParseResult => {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Enter a time.' }

  const meridiemMatch = /^(.*?)\s*([ap])\.?\s*m\.?\s*$/i.exec(trimmed)
  const mainPart = (meridiemMatch ? meridiemMatch[1] : trimmed).trim().replace(/h$/i, '')
  const meridiem = meridiemMatch ? meridiemMatch[2].toLowerCase() : null

  if (!mainPart) return { ok: false, error: 'Enter a time.' }

  let hour: number
  let minute: number

  const colonMatch = /^(\d{1,2}):(\d{2})$/.exec(mainPart)
  const digitsOnlyMatch = /^(\d{1,4})$/.exec(mainPart)

  if (colonMatch) {
    hour = Number.parseInt(colonMatch[1], 10)
    minute = Number.parseInt(colonMatch[2], 10)
  } else if (digitsOnlyMatch) {
    const digits = digitsOnlyMatch[1]
    if (digits.length <= 2) {
      hour = Number.parseInt(digits, 10)
      minute = 0
    } else {
      hour = Number.parseInt(digits.slice(0, -2), 10)
      minute = Number.parseInt(digits.slice(-2), 10)
    }
  } else {
    return { ok: false, error: 'Unrecognized time. Try "3:30 pm", "1530", or "1530H".' }
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) return { ok: false, error: 'Enter a valid hour (1-12) with am/pm.' }
    if (meridiem === 'p' && hour !== 12) hour += 12
    if (meridiem === 'a' && hour === 12) hour = 0
  }

  return buildHhmm(hour, minute)
}

export const isWithinDateTimeWindow = (
  date: string,
  time: string,
  dateFrom: string,
  dateTo: string,
  timeFrom: string,
  timeTo: string,
) => {
  if (date < dateFrom || date > dateTo) return false
  if (date === dateFrom && time < timeFrom) return false
  if (date === dateTo && time > timeTo) return false
  return true
}