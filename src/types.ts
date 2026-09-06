export interface Patient {
  id?: number
  lastModified: string
  /** Set once at creation; used as the computed default for Admission Date and Referral Date until the user types an override. */
  createdAt: string
  roomNumber: string
  ward: string
  /** Set only when the legacy combined Room value couldn't be auto-split into Room Number + Ward; shown as a fallback until manually resolved. */
  roomLegacyRaw?: string
  lastName: string
  firstName: string
  middleName?: string
  /** Blank (unset) when the user hasn't entered an age, rather than defaulting to 0. */
  age?: number
  sex: 'M' | 'F' | 'O'
  /** User-typed override only — unset (blank) by default. While unset, the UI displays (but does not persist) `createdAt`'s date. */
  admitDate: string
  /** User-typed override only — unset (blank) by default. While unset, the UI displays (but does not persist) `createdAt`'s time. */
  admitTime: string
  /** User-typed override only — unset (blank) by default. While unset, the UI displays (but does not persist) `createdAt`'s date. Only shown in the UI once a "Referral" tag is applied to the patient. */
  referralDate: string
  /** User-typed override only — unset (blank) by default. While unset, the UI displays (but does not persist) `createdAt`'s time. Only shown in the UI once a "Referral" tag is applied to the patient. */
  referralTime: string
  /** User-typed override only — unset by default. While unset, the UI displays (but does not persist) the date the patient's current Terminal-flagged tag was applied, computed from Tag Event history. Only shown in the UI while a terminal tag is currently attached. */
  dischargeDate?: string
  /** User-typed override only — unset by default. While unset, the UI displays (but does not persist) the time the patient's current Terminal-flagged tag was applied, computed from Tag Event history. Only shown in the UI while a terminal tag is currently attached. */
  dischargeTime?: string
  /** References to TagDefinition rows in the "Service" tag group. Kept separate from the general `tagIds` because the same service tag pool is split into Main vs Referral roles per patient. */
  mainServiceTagIds: number[]
  referralServiceTagIds: number[]
  attendingPhysician: string
  /** Diagnosis text with no service tag assigned to it — the only diagnosis field shown while the patient has zero Main/Referral services. Once at least one service exists, the per-service fields below take over and this holds whatever text predates the patient's first-ever service (see `admissionDiagnosisByService`). */
  admissionDiagnosisUnassigned: string
  /** One line per assigned service (Main then Referral, in the order each was added), keyed by that service TagDefinition's id — renders as e.g. "IM: AKI secondary to postrenal obstructive uropathy". A service's entry is kept even after the service tag is removed from the patient, so it reappears if the same service is re-added. */
  admissionDiagnosisByService: Record<number, string>
  dischargeDiagnosisUnassigned: string
  dischargeDiagnosisByService: Record<number, string>
  clinicalSummary: string
  /** Unstructured scratch pad — merges the legacy Chief Complaint / HPI / PMH / PE / Clerk notes fields into a single free-text area (Database tab). */
  database: string
  plans: string
  medications: string
  labs: string
  pendings: string
  tagIds: number[]
}

export type TagDisplayType = 'emoji' | 'color'

export type TagAutomationRole =
  | 'none'
  | 'category-cd'
  | 'category-pd'
  | 'relationship-main'
  | 'relationship-referral'

export interface TagGroupDefinition {
  id?: number
  name: string
  sortOrder: number
}

export interface TagDefinition {
  id?: number
  name: string
  displayType: TagDisplayType
  emoji?: string
  color?: string
  /** Text-with-Color only: what's actually shown on the badge (e.g. "Ref" for a "Referral" tag). Falls back to name when unset. */
  displayText?: string
  groupId?: number
  sortOrder: number
  visibleOnPatientCard: boolean
  terminal: boolean
  automationRole: TagAutomationRole
  createdAt: string
}

export interface TagEvent {
  id?: number
  patientId: number
  tagId: number
  tagName: string
  action: 'added' | 'removed'
  at: string
}

export type CustomActionTriggerType = 'manual' | 'automatic'

/**
 * "patient" (default, existing behavior) applies to a specific patient's checklist/tags when
 * triggered. "general" (issue #120) applies instead to the General (non-patient) checklist —
 * such an action can only use the manual trigger and never has tag effects or tag-based
 * conditions, since there's no associated patient to check or change tags on.
 */
export type CustomActionScope = 'patient' | 'general'

export interface CustomActionTagEffect {
  tagId: number
  action: 'add' | 'remove'
}

/**
 * A user-defined rule scoping part of a Custom Action's behavior: the patient must have every tag
 * in `requiredTagIds` applied (checked across tagIds, mainServiceTagIds, and referralServiceTagIds)
 * for this condition to match — an empty list always matches. Conditions are independent and
 * non-exclusive: a patient can match several at once, and each matching condition's checklist
 * items and tag effects all apply. A patient matching none of an action's conditions is left
 * unaffected and flagged rather than guessed at.
 *
 * `daysOfWeek`/`daysOfMonth` (issue #120) add an optional date restriction on top of the tag
 * requirement, checked against the date at trigger time: an empty/undefined list on either means
 * no restriction on that axis, otherwise today's day-of-week (0=Sunday..6=Saturday) or
 * day-of-month (1-31) must be in the list. Both the tag and date requirements must pass for the
 * condition to match. A General-scope action's conditions never have tag requirements (there's no
 * patient to check), so for those only the date restriction is meaningful.
 */
export interface CustomActionCondition {
  id: string
  requiredTagIds: number[]
  daysOfWeek?: number[]
  daysOfMonth?: number[]
  checklistItems: string[]
  tagEffects: CustomActionTagEffect[]
}

export interface CustomAction {
  id?: number
  name: string
  scope: CustomActionScope
  triggerType: CustomActionTriggerType
  /** Required (and only meaningful) when triggerType === 'automatic': the tag whose absent→present transition fires this action. */
  triggerTagId?: number
  /** Applied to every triggered patient unconditionally, regardless of any condition below — lets an action apply uniformly with no condition defined at all. */
  checklistItems: string[]
  tagEffects: CustomActionTagEffect[]
  /** Optional additional scoping on top of the unconditional items/effects above — each matching condition's own checklist items and tag effects also apply. */
  conditions: CustomActionCondition[]
  sortOrder: number
  createdAt: string
}

/** One row per (actionId, patientId, date) a Manual action was actually run — powers the once-per-day duplicate-prevention rule. */
export interface CustomActionRun {
  id?: number
  actionId: number
  patientId: number
  date: string
  at: string
}

export interface ProblemBlock {
  id: string
  title: string
  notes: string
  /** Adopts the Checklist tab's per-date carry-forward model: unresolved problems roll forward to the next date automatically; resolved ones stay put. */
  completed: boolean
}

export interface DailyUpdate {
  id?: number
  patientId: number
  date: string
  problems: ProblemBlock[]
  assessment: string
  plans: string
  checklist: { text: string; completed: boolean; notes?: string }[]
  lastUpdated: string
}

export interface VitalEntry {
  id?: number
  patientId: number
  date: string
  time: string
  bp: string
  hr: string
  rr: string
  temp: string
  spo2: string
  note: string
  createdAt: string
}

export interface MedicationEntry {
  id?: number
  patientId: number
  sortOrder?: number
  medication: string
  dose: string
  route: string
  frequency: string
  note: string
  status: 'active' | 'discontinued' | 'completed'
  createdAt: string
}

export interface LabEntry {
  id?: number
  patientId: number
  date: string
  time?: string
  templateId: string
  results: Record<string, string>
  note: string
  createdAt: string
}

export interface OrderEntry {
  id?: number
  patientId: number
  orderDate: string
  orderTime: string
  service: string
  orderText: string
  status: 'active' | 'carriedOut' | 'discontinued'
  note: string
  createdAt: string
}

export type PhotoCategory =
  | 'profile'
  | 'problems'
  | 'vitals'
  | 'medications'
  | 'labs'
  | 'orders'

export interface PhotoAttachment {
  id?: number
  patientId: number
  category: PhotoCategory
  title: string
  /** True while `title` still equals the auto-generated default for this batch's upload
   * group — flips to false permanently once the user edits the title away from that default.
   * Drives same-day collision lettering ("Profile_08-11a", "Profile_08-11b", ...), which must
   * only ever touch batches still at their default title. */
  isDefaultTitle?: boolean
  uploadGroupId?: string
  selectionOrderInGroup?: number
  mimeType: string
  width: number
  height: number
  byteSize: number
  imageBlob: Blob
  createdAt: string
}

/** Single-value fields with no date dimension — inserted inline as plain text at a Format Pattern
 * placeholder. `admissionDiagnosis`/`dischargeDiagnosis` split what issue #82 originally specified
 * as one "Diagnosis" variable, matching the per-service Admission/Discharge Diagnosis model this
 * app actually has (see Patient.admissionDiagnosisByService et al.). `currentDate`/`currentTime`
 * don't come from patient data at all — they're captured once at the start of report generation. */
export type FlatVariableId =
  | 'roomNumber'
  | 'ward'
  | 'lastName'
  | 'firstName'
  | 'middleName'
  | 'age'
  | 'sex'
  | 'mainService'
  | 'referralService'
  | 'admissionDiagnosis'
  | 'dischargeDiagnosis'
  | 'clinicalSummary'
  | 'admitDate'
  | 'admitTime'
  | 'referralDate'
  | 'referralTime'
  | 'dischargeDate'
  | 'dischargeTime'
  | 'database'
  | 'currentDate'
  | 'currentTime'

/** Fields with a date dimension — multiple dated entries over the admission — inserted as a
 * (potentially multi-line) formatted block per `BlockVariableConfig`. Medications is here (rather
 * than a Flat variable) because it's multi-entry too, even though entries carry no date/time of
 * their own — see the medications-only config fields below for how it's scoped instead. */
export type BlockVariableId = 'vitals' | 'labs' | 'problems' | 'checklist' | 'orders' | 'medications'

/** 'latest' was removed as a distinct mode — it was exactly equivalent to 'numberOfEntries' with
 * entryCount 1 (or, for date-grouped record types, the single most recent day), so existing rows
 * migrate to that instead of keeping a redundant option in the UI. */
export type BlockVariableRangeMode = 'dateRange' | 'numberOfEntries'

export type RelativeDateRangeMode = 'fixed' | 'sinceAdmission' | 'lastNDays'

/** Vitals entry-level fields — meaningful only inside a Vitals Block variable's own
 * `entryPatternText`/`entryFieldIds`, never inserted directly into a template's Format Pattern. */
export type VitalsEntryFieldId = 'entryDate' | 'entryTime' | 'bp' | 'hr' | 'rr' | 'temp' | 'spo2' | 'note'
export type OrdersEntryFieldId = 'entryDate' | 'entryTime' | 'service' | 'orderText' | 'status' | 'note'
/** `resolvedMarker` resolves to `resolvedGlyph`/`unresolvedGlyph` on the config, same pattern as
 * Checklist's Checkbox field — e.g. " (resolved)"/"" (default) or "✅"/"⭕". */
export type ProblemsEntryFieldId = 'problemIndex' | 'problemTitle' | 'problemNotes' | 'resolvedMarker'
export type ChecklistEntryFieldId = 'checkbox' | 'itemText'
/** `statusMarker` is a fixed literal (" (discontinued)" / " (completed)" / "" for active) — unlike
 * Checklist/Problems' two-state markers, Medications has three statuses, so a simple glyph pair
 * doesn't fit; not user-configurable for now. */
export type MedicationsEntryFieldId = 'medication' | 'dose' | 'route' | 'frequency' | 'note' | 'statusMarker'

/** How multiple entries (or, for Problems/Checklist/Labs, multiple date-groups) join together. */
export type BlockJoinMode = 'lineBreak' | 'blankLine' | 'space' | 'custom'

/** Labs only: how the date is displayed across multiple result blocks — each block shows its own
 * date (matches every other record type's default), no date at all, or one date header shared by
 * every same-day block (mirrors Problems/Checklist's date-group header). */
export type LabsDateDisplayMode = 'perEntry' | 'none' | 'groupedByDate'

/** Set once when a Block variable is placed into a template and saved as part of that specific
 * placeholder — never re-prompted at generation time. */
export interface BlockVariableConfig {
  rangeMode: BlockVariableRangeMode
  /** Only meaningful when rangeMode === 'numberOfEntries'. Feeding exactly 2 into Labs reuses the
   * existing 2-entry comparison-mode formatting unchanged. */
  entryCount: number
  /** Only meaningful when rangeMode === 'dateRange'. */
  relativeMode: RelativeDateRangeMode
  /** Only meaningful when relativeMode === 'fixed'. Unlike every other date field in this app,
   * blank is not a valid saved state for `fixedDateFrom`/`fixedTimeFrom` — the settings UI requires
   * the user to type a start before it'll save. `fixedDateTo`/`fixedTimeTo` DO default when left
   * blank, but that default is resolved once and baked into the saved config at save time (not
   * recomputed at generation time), so a template's output stays stable across later uses
   * regardless of when it's actually generated. */
  fixedDateFrom: string
  fixedTimeFrom: string
  fixedDateTo: string
  fixedTimeTo: string
  /** Only meaningful when relativeMode === 'lastNDays'. */
  lastNDays: number
  /** How a single matched entry renders — a mini Format Pattern (same `{{var:<id>}}` token syntax
   * as the top-level pattern) scoped to this record type's own fields, keyed into `entryFieldIds`
   * rather than a full `TemplateVariableInstance` map since entry-level fields carry no config of
   * their own beyond an optional Date/Time Format (see `entryFieldDateTimeFormats`). Not used by
   * 'labs', whose formatting is algorithmic (see `buildLabReportBlocks`) rather than
   * field-composable. */
  entryPatternText: string
  entryFieldIds: Record<string, string>
  /** Per-chip Date/Time Format override, keyed by the same chip id as `entryFieldIds` — only
   * meaningful for a chip whose fieldId is date/time-typed (Vitals/Orders' Entry Date/Entry Time).
   * Unset uses that field's own built-in default formatting. */
  entryFieldDateTimeFormats: Record<string, string>
  entrySeparator: BlockJoinMode
  /** Only meaningful when entrySeparator === 'custom'. */
  customEntrySeparator: string
  /** Problems/Checklist only: whether each date-group is preceded by a date header line. */
  showGroupHeader: boolean
  /** Problems/Checklist/Labs only: which saved Date/Time Format renders the date — the shared
   * date-group header for Problems/Checklist and Labs' 'groupedByDate' mode, or each individual
   * result's own date line for Labs' 'perEntry' mode. Unset uses that context's built-in default. */
  groupHeaderDateFormatId?: string
  /** Problems/Checklist only: how consecutive date-groups join. */
  groupSeparator: BlockJoinMode
  customGroupSeparator: string
  /** Checklist only: the glyph the "Checkbox" entry field resolves to for a checked/unchecked item
   * — e.g. "x"/" " (default, reproducing the classic `[x]`/`[ ]`) or "✅"/"⭕". No effect unless the
   * entry pattern actually includes the Checkbox field. */
  checkedGlyph: string
  uncheckedGlyph: string
  /** Problems only: same idea as checkedGlyph/uncheckedGlyph, for the "Resolved Marker" field. */
  resolvedGlyph: string
  unresolvedGlyph: string
  /** Medications only: which statuses to include — MedicationEntry carries no date, so there's no
   * range mode to filter by; this is the equivalent axis. */
  includeActiveMedications: boolean
  includeDiscontinuedMedications: boolean
  includeCompletedMedications: boolean
  /** Medications only: whether/where the freeform Medications-tab text (`Patient.medications`,
   * not a MedicationEntry) appears relative to the structured entries. */
  includeMedicationNotes: boolean
  medicationNotesPosition: 'before' | 'after'
  /** Labs only. */
  labsDateDisplayMode: LabsDateDisplayMode
}

/** Tags is a Flat variable (single inline placement) but — uniquely among Flat variables — carries
 * its own per-placeholder settings, so it gets its own segment type instead of being lumped in
 * with the configless FlatVariableId list. */
export interface TagsVariableConfig {
  /** True includes every tag currently visible on the patient card at that placement (Issue 1's
   * `visibleOnPatientCard`), ignoring tagIds/groupIds below. */
  includeAll: boolean
  tagIds: number[]
  groupIds: number[]
  /** Text-with-Color tags always render as their plain name regardless of this setting — only
   * Emoji-type tags are affected. */
  emojiRendering: 'emoji' | 'name'
}

/** What a single `{{var:<id>}}` token in `ReportTemplate.patternText` resolves to — looked up by
 * the id embedded in the token, not by position, so editing the surrounding text never disturbs a
 * variable's own settings. */
export type TemplateVariableInstance =
  | { kind: 'flat'; variableId: FlatVariableId; /** Only meaningful for a date/time-typed FlatVariableId (admitDate/referralDate/dischargeDate/currentDate/currentTime). Unset uses that field's own built-in default formatting. */ dateTimeFormatId?: string }
  | { kind: 'block'; variableId: BlockVariableId; config: BlockVariableConfig }
  | { kind: 'tags'; config: TagsVariableConfig }

/**
 * A user-defined, savable report format (issue #82). `patternText` is the single source of truth
 * for both content and spacing — literal text and line breaks (`\n`) typed directly, the same as
 * any other free-text field in this app, with a variable placeholder marked inline as
 * `{{var:<id>}}` wherever the user inserted one via "Add Variable". `variables` holds that
 * placeholder's actual settings, keyed by the same id — there is no separate field-list-plus-
 * separator setting; the pattern text itself controls both content and spacing.
 */
export interface ReportTemplate {
  id?: number
  name: string
  patternText: string
  variables: Record<string, TemplateVariableInstance>
  sortOrder: number
  createdAt: string
  /** True only for the built-in "Labs" template, whose if/then comparison-mode formatting isn't
   * field-composable — hides Edit/Delete in Manage Templates. The user can still choose whether to
   * include it in a generated report, exactly like any other template. */
  locked?: boolean
  /** How separate patients' generated blocks join together for a Per-Patient template — meaningless
   * for Prints Once, which only ever produces one block regardless of how many patients are selected. */
  patientSeparator: BlockJoinMode
  customPatientSeparator: string
  /** Prints exactly once, before the entire generated output (never per patient) — literal text
   * plus, optionally, Current Date/Current Time chips only. No patient-dependent variable is ever
   * offered here, since this content isn't associated with any one patient. */
  headerPatternText: string
  headerVariables: Record<string, TemplateVariableInstance>
  /** Same as the header, but printed once at the very end. */
  footerPatternText: string
  footerVariables: Record<string, TemplateVariableInstance>
}

/** A named, savable date/time display format (e.g. "MMM D, YYYY") — selectable wherever a
 * date/time-typed template variable is configured. Mirrors `ReportTemplate`'s own patternText +
 * variables shape (same `{{var:<id>}}` token syntax), just against a much smaller, configless
 * component catalog — every component resolves the same way regardless of where it's used, so
 * there's no per-instance config to store beyond which component it is. */
export type DateTimeComponentId =
  | 'year4' | 'year2'
  | 'monthNum2' | 'monthAbbrev' | 'monthFull'
  | 'day2' | 'dayNoLeadingZero'
  | 'weekdayAbbrev' | 'weekdayFull'
  | 'hour24' | 'hour12' | 'hour12NoLeadingZero'
  | 'minute2'
  | 'meridiemUpper' | 'meridiemLower'

export interface DateTimeFormatDefinition {
  id?: number
  name: string
  patternText: string
  componentIds: Record<string, DateTimeComponentId>
  sortOrder: number
  createdAt: string
}
