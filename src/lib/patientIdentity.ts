import type { Patient } from '@/types'

/** Joins only the non-blank parts with `sep` — the separator itself never appears unless there's
 * actually something on both sides of it (no dangling ", " or "/" when a field is empty). */
export const joinNonBlank = (parts: (string | null | undefined)[], sep: string): string =>
  parts.map((part) => (part ?? '').trim()).filter(Boolean).join(sep)

/** `wardName` is resolved by the caller (via `wardTagId`/`tagsById`) rather than taken from
 * `Patient` directly, since Ward is a tag reference now — see `Patient.wardTagId`. */
export const formatRoomWard = (patient: Pick<Patient, 'roomNumber'>, wardName: string): string =>
  joinNonBlank([patient.roomNumber, wardName], ' ')

export const formatFullName = (patient: Pick<Patient, 'lastName' | 'firstName'>): string =>
  joinNonBlank([patient.lastName, patient.firstName], ', ')

export const formatAgeSex = (patient: Pick<Patient, 'age' | 'sex'>): string =>
  joinNonBlank([patient.age !== undefined ? String(patient.age) : '', patient.sex], ' / ')
