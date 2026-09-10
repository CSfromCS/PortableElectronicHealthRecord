import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronLeft, Copy, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { useDragReorder, dropIndicatorClassName, type DropPosition } from '@/lib/dnd/useDragReorder'
import { toLocalISODate, toLocalTime } from '@/lib/dateTime'
import { FlexibleDateInput } from '@/lib/date/FlexibleDateInput'
import { FlexibleTimeInput } from '@/lib/date/FlexibleTimeInput'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { cn } from '@/lib/utils'
import type {
  BlockJoinMode,
  BlockVariableConfig,
  BlockVariableId,
  BlockVariableRangeMode,
  CensusGroupCombineMode,
  DateTimeFormatDefinition,
  FlatVariableId,
  GroupVariableInstance,
  LabsDateDisplayMode,
  RelativeDateRangeMode,
  ReportTemplate,
  TagComboGroupSeed,
  TagDefinition,
  TagGroupDefinition,
  TagsVariableConfig,
  TemplateVariableInstance,
} from '@/types'
import { bucketTagsByGroup } from '@/features/tags/tagUtils'
import { BulkTagPicker } from '@/features/tags/BulkTagPicker'
import { ChipTextEditor, type ChipCatalogEntry } from './ChipTextEditor'
import {
  BLOCK_JOIN_MODE_LABELS,
  BLOCK_VARIABLE_LABELS,
  DATE_TIME_CAPABLE_FLAT_VARIABLE_IDS,
  DEFAULT_TAGS_VARIABLE_CONFIG,
  ENTRY_FIELD_LABELS_BY_BLOCK,
  ENTRY_FIELD_ORDER_BY_BLOCK,
  FLAT_VARIABLE_LABELS,
  GROUP_FIELD_LABELS,
  GROUP_FIELD_ORDER,
  buildDefaultBlockVariableConfig,
  buildGroupVariableInstanceForField,
  buildVariableToken,
  classifyTemplateRepeatMode,
  createVariableId,
  describeBlockConfig,
  describeVariableInstance,
  groupFieldIdForInstance,
  isDateTimeCapableEntryField,
  renderGroupedBody,
  renderTemplateForPatient,
  tokenizePatternText,
  type GroupFieldId,
} from './templateEngine'
import { buildSamplePreviewContext, buildSamplePreviewPatient } from './samplePreviewData'

const BLOCK_VARIABLE_ORDER: BlockVariableId[] = ['vitals', 'labs', 'problems', 'checklist', 'orders', 'medications']

type PickerTab = {
  id: string
  label: string
  flatIds?: FlatVariableId[]
}

/** Grouped so it's obvious at a glance which category of information a variable pulls from,
 * rather than one long undifferentiated list. */
const PICKER_TABS: PickerTab[] = [
  { id: 'identity', label: 'Identity', flatIds: ['roomNumber', 'ward', 'lastName', 'firstName', 'middleName', 'age', 'sex'] },
  { id: 'clinical', label: 'Clinical', flatIds: ['mainService', 'referralService', 'admissionDiagnosis', 'dischargeDiagnosis', 'clinicalSummary', 'database'] },
  { id: 'dates', label: 'Dates', flatIds: ['admitDate', 'admitTime', 'referralDate', 'referralTime', 'dischargeDate', 'dischargeTime', 'currentDate', 'currentTime'] },
  { id: 'tags', label: 'Tags' },
  { id: 'records', label: 'Records' },
]

type TemplateFormState = {
  name: string
  patternText: string
  variables: Record<string, TemplateVariableInstance>
  patientSeparator: BlockJoinMode
  customPatientSeparator: string
  headerPatternText: string
  headerVariables: Record<string, TemplateVariableInstance>
  footerPatternText: string
  footerVariables: Record<string, TemplateVariableInstance>
  groupingEnabled: boolean
  groupSelectionMode: 'automatic' | 'manual'
  groupTagIds: number[]
  groupCombineMode: CensusGroupCombineMode
  groupTagLabelSeparator: string
  groupManualCombos: TagComboGroupSeed[]
  groupLookbackHours: number
  groupListOpenText: string
  groupListCloseText: string
  groupShowListBracketsWhenEmpty: boolean
  groupPatternText: string
  groupVariables: Record<string, GroupVariableInstance>
  groupSeparator: BlockJoinMode
  customGroupSeparator: string
}

const templateToForm = (template: ReportTemplate): TemplateFormState => ({
  name: template.name,
  patternText: template.patternText,
  variables: { ...template.variables },
  patientSeparator: template.patientSeparator,
  customPatientSeparator: template.customPatientSeparator,
  headerPatternText: template.headerPatternText,
  headerVariables: { ...template.headerVariables },
  footerPatternText: template.footerPatternText,
  footerVariables: { ...template.footerVariables },
  groupingEnabled: template.groupingEnabled,
  groupSelectionMode: template.groupSelectionMode,
  groupTagIds: [...template.groupTagIds],
  groupCombineMode: template.groupCombineMode,
  groupTagLabelSeparator: template.groupTagLabelSeparator,
  groupManualCombos: template.groupManualCombos.map((combo) => ({ ...combo })),
  groupLookbackHours: template.groupLookbackHours,
  groupListOpenText: template.groupListOpenText,
  groupListCloseText: template.groupListCloseText,
  groupShowListBracketsWhenEmpty: template.groupShowListBracketsWhenEmpty,
  groupPatternText: template.groupPatternText,
  groupVariables: { ...template.groupVariables },
  groupSeparator: template.groupSeparator,
  customGroupSeparator: template.customGroupSeparator,
})

const blankForm = (): TemplateFormState => ({
  name: '',
  patternText: '',
  variables: {},
  patientSeparator: 'blankLine',
  customPatientSeparator: '',
  headerPatternText: '',
  headerVariables: {},
  footerPatternText: '',
  footerVariables: {},
  groupingEnabled: false,
  groupSelectionMode: 'automatic',
  groupTagIds: [],
  groupCombineMode: 'OR',
  groupTagLabelSeparator: ', ',
  groupManualCombos: [],
  groupLookbackHours: 12,
  groupListOpenText: ' (',
  groupListCloseText: ')',
  groupShowListBracketsWhenEmpty: false,
  groupPatternText: '',
  groupVariables: {},
  groupSeparator: 'blankLine',
  customGroupSeparator: '',
})

const JOIN_MODE_ORDER: BlockJoinMode[] = ['lineBreak', 'blankLine', 'space', 'custom']

const TEXTAREA_CLASS = 'flex min-h-[3rem] w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

const JoinModePicker = ({
  label,
  mode,
  custom,
  onModeChange,
  onCustomChange,
}: {
  label: string
  mode: BlockJoinMode
  custom: string
  onModeChange: (mode: BlockJoinMode) => void
  onCustomChange: (value: string) => void
}) => (
  <div className='space-y-1'>
    <Label className='text-xs'>{label}</Label>
    <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
      {JOIN_MODE_ORDER.map((option) => (
        <Button
          key={option}
          type='button'
          size='sm'
          variant={mode === option ? 'default' : 'ghost'}
          className='flex-1 text-xs px-1'
          onClick={() => onModeChange(option)}
        >
          {BLOCK_JOIN_MODE_LABELS[option]}
        </Button>
      ))}
    </div>
    {mode === 'custom' ? (
      <>
        <textarea
          rows={2}
          className={TEXTAREA_CLASS}
          value={custom}
          onChange={(event) => onCustomChange(event.target.value)}
          placeholder={'e.g. ";" or a line break plus more text'}
        />
        <p className='text-xs text-clay'>Press Enter here for an actual line break between entries.</p>
      </>
    ) : null}
  </div>
)

const NO_FORMAT_VALUE = '__default__'

/** Lets the user pick a saved Date & Time Format for one date/time-typed chip — or leave it on
 * "Default" to keep that field's own built-in formatting. Used both right when a date/time
 * variable is first inserted (so choosing a format is part of adding one, not an easy-to-miss
 * afterthought) and again later by clicking an already-inserted chip. */
const DateTimeFormatPickerDialog = ({
  open,
  variableId,
  initialFormatId,
  formats,
  onCancel,
  onSave,
}: {
  open: boolean
  variableId: FlatVariableId | null
  initialFormatId: string | undefined
  formats: DateTimeFormatDefinition[]
  onCancel: () => void
  onSave: (formatId: string | undefined) => void
}) => {
  const [selected, setSelected] = useState(initialFormatId ?? NO_FORMAT_VALUE)

  useEffect(() => {
    if (open) setSelected(initialFormatId ?? NO_FORMAT_VALUE)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the draft only when the dialog (re)opens
  }, [open])

  if (!open || variableId === null) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className='max-w-sm' onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{FLAT_VARIABLE_LABELS[variableId]} format</DialogTitle>
        </DialogHeader>
        <div className='space-y-2'>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FORMAT_VALUE}>Default</SelectItem>
              {formats.map((format) => (
                <SelectItem key={format.id} value={String(format.id)}>{format.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formats.length === 0 ? (
            <p className='text-xs text-clay'>No saved Date & Time Formats yet — add one from Manage Templates to see it here.</p>
          ) : null}
        </div>
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={onCancel}>Cancel</Button>
          <Button type='button' onClick={() => onSave(selected === NO_FORMAT_VALUE ? undefined : selected)}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const CENSUS_GROUP_COMBINE_MODE_ORDER: CensusGroupCombineMode[] = ['OR', 'AND']

const CENSUS_GROUP_COMBINE_MODE_LABELS: Record<CensusGroupCombineMode, string> = {
  OR: 'Any (OR)',
  AND: 'All (AND)',
}

const GROUP_FORMAT_CATALOG: ChipCatalogEntry[] = GROUP_FIELD_ORDER.map((fieldId) => ({
  id: fieldId,
  label: GROUP_FIELD_LABELS[fieldId],
  dateTimeCapable: fieldId === 'currentDate' || fieldId === 'currentTime',
}))

const createTagComboGroupId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `combo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** One row of Tag Combo Grouping's manual-mode combo list — a specific hand-picked set of tags
 * plus a hand-typed label, reordered via drag. Mirrors Custom Actions' condition editor (same
 * `BulkTagPicker` + `DragHandle` pattern), just without the checklist-items/tag-effects/date
 * machinery a condition also carries. */
const ManualComboRow = ({
  combo,
  index,
  tags,
  groups,
  onChange,
  onRemove,
  dragHandleProps,
}: {
  combo: TagComboGroupSeed
  index: number
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onChange: (next: TagComboGroupSeed) => void
  onRemove: () => void
  dragHandleProps: ReturnType<ReturnType<typeof useDragReorder<string>>['getHandleProps']>
}) => {
  const toggleTag = (tag: TagDefinition) => {
    if (tag.id === undefined) return
    const tagId = tag.id
    onChange({
      ...combo,
      tagIds: combo.tagIds.includes(tagId) ? combo.tagIds.filter((id) => id !== tagId) : [...combo.tagIds, tagId],
    })
  }

  return (
    <div className='space-y-2 rounded-xl border border-clay/25 bg-blush-sand/20 p-3'>
      <div className='flex items-center gap-2'>
        <DragHandle label={`Drag to reorder combo ${index + 1}`} dragProps={dragHandleProps} />
        <Input
          value={combo.label}
          onChange={(event) => onChange({ ...combo, label: event.target.value })}
          placeholder={`Combo ${index + 1} label`}
          className='flex-1'
        />
        <Button type='button' variant='ghost' size='sm' className='h-8 w-8 p-0 text-action-danger' aria-label={`Remove combo ${index + 1}`} onClick={onRemove}>
          <Trash2 className='h-3.5 w-3.5' />
        </Button>
      </div>
      <BulkTagPicker tags={tags} groups={groups} selectedTagIds={new Set(combo.tagIds)} onToggle={toggleTag} collapsible />
    </div>
  )
}

/** Tag Combo Grouping (issue #145) — an optional segment between a template's Header and Main
 * Template sections. Buckets patients by tag combo (automatic: selected tags + AND/OR, same
 * mechanics Census Summary always used; manual: a hand-picked, hand-labeled, reorderable combo
 * list, same editing pattern as a Custom Action's conditions) and renders a group-level format
 * that can embed the Main Template's own per-patient format via a "Patient Info" chip. */
const GroupingSegment = ({
  form,
  tags,
  groups,
  dateTimeFormats,
  onChange,
}: {
  form: TemplateFormState
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  dateTimeFormats: DateTimeFormatDefinition[]
  onChange: (patch: Partial<TemplateFormState>) => void
}) => {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]))
  const representedGroupIds = new Set(form.groupTagIds.map((id) => tagsById.get(id)?.groupId ?? 'ungrouped'))

  const toggleAutomaticTag = (tag: TagDefinition) => {
    if (tag.id === undefined) return
    const tagId = tag.id
    onChange({ groupTagIds: form.groupTagIds.includes(tagId) ? form.groupTagIds.filter((id) => id !== tagId) : [...form.groupTagIds, tagId] })
  }

  const reorderCombos = (sourceId: string, targetId: string, position: DropPosition) => {
    onChange({ groupManualCombos: moveItemByKey(form.groupManualCombos, (combo) => combo.id, sourceId, targetId, position) })
  }
  const comboDrag = useDragReorder(form.groupManualCombos.map((combo) => combo.id), reorderCombos)

  const initialGroupFieldIds: Record<string, string> = {}
  const initialGroupFieldFormats: Record<string, string> = {}
  Object.entries(form.groupVariables).forEach(([chipId, instance]) => {
    initialGroupFieldIds[chipId] = groupFieldIdForInstance(instance)
    if (instance.kind === 'flat' && instance.dateTimeFormatId) initialGroupFieldFormats[chipId] = instance.dateTimeFormatId
  })

  return (
    <div className='space-y-3 rounded-lg border border-dashed border-clay/20 bg-warm-ivory/40 p-2.5'>
      <label className='flex items-center gap-2.5 py-1 cursor-pointer'>
        <input
          type='checkbox'
          className='h-4 w-4 accent-action-primary'
          checked={form.groupingEnabled}
          onChange={(event) => onChange({ groupingEnabled: event.target.checked })}
        />
        <span className='text-sm font-semibold text-espresso'>Enable tag combo grouping for this template</span>
      </label>
      <p className='text-xs text-clay'>
        Buckets patients by tag combo before the Main Template below renders — each group can show a label, a
        patient tally, the matching patients themselves (via Main Template), and new-admission/referral/
        discharge/sign-out/expired tallies and lists, each independently windowed.
      </p>

      {form.groupingEnabled ? (
        <div className='space-y-4 border-t border-clay/15 pt-3'>
          <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
            <Button type='button' size='sm' variant={form.groupSelectionMode === 'automatic' ? 'default' : 'ghost'} className='flex-1 text-xs' onClick={() => onChange({ groupSelectionMode: 'automatic' })}>Automatic</Button>
            <Button type='button' size='sm' variant={form.groupSelectionMode === 'manual' ? 'default' : 'ghost'} className='flex-1 text-xs' onClick={() => onChange({ groupSelectionMode: 'manual' })}>Manual</Button>
          </div>

          {form.groupSelectionMode === 'automatic' ? (
            <div className='space-y-3'>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Which tags group patients</Label>
                <BulkTagPicker tags={tags} groups={groups} selectedTagIds={new Set(form.groupTagIds)} onToggle={toggleAutomaticTag} collapsible />
                <p className='text-xs text-clay'>Each selected tag becomes its own output group, covering patients currently carrying that tag.</p>
              </div>

              {representedGroupIds.size > 1 ? (
                <div className='space-y-1'>
                  <Label className='text-xs'>Selected tags span more than one Tag Group — combine them with</Label>
                  <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                    {CENSUS_GROUP_COMBINE_MODE_ORDER.map((mode) => (
                      <Button
                        key={mode}
                        type='button'
                        size='sm'
                        variant={form.groupCombineMode === mode ? 'default' : 'ghost'}
                        className='flex-1 text-xs'
                        onClick={() => onChange({ groupCombineMode: mode })}
                      >
                        {CENSUS_GROUP_COMBINE_MODE_LABELS[mode]}
                      </Button>
                    ))}
                  </div>
                  <p className='text-xs text-clay'>
                    {form.groupCombineMode === 'OR'
                      ? 'One group per selected tag, regardless of which Tag Group it came from.'
                      : 'One group per combination of one tag from each represented Tag Group — a patient only counts in a combo group if they carry every tag in it.'}
                  </p>
                </div>
              ) : null}

              <div className='space-y-1'>
                <Label className='text-xs'>Group label separator</Label>
                <TapToEditField
                  className='rounded-md border border-input bg-white'
                  ariaLabel='Group label separator'
                  emptyText='Tap to set a separator'
                  value={form.groupTagLabelSeparator}
                  onCommit={(groupTagLabelSeparator) => onChange({ groupTagLabelSeparator })}
                  renderEditor={({ value, onChange: onEditorChange }) => (
                    <AutoGrowTextField aria-label='Group label separator' value={value} onChange={onEditorChange} placeholder='e.g. ", "' />
                  )}
                />
                <p className='text-xs text-clay'>Joins a combo group's tag names into its label, e.g. "CD, Main".</p>
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              {form.groupManualCombos.map((combo, index) => (
                <div
                  key={combo.id}
                  className={cn(
                    comboDrag.isDragging(combo.id) && 'opacity-50',
                    dropIndicatorClassName(comboDrag.dropIndicator(combo.id)),
                  )}
                  {...comboDrag.getItemProps(combo.id)}
                >
                  <ManualComboRow
                    combo={combo}
                    index={index}
                    tags={tags}
                    groups={groups}
                    onChange={(next) => onChange({ groupManualCombos: form.groupManualCombos.map((c) => (c.id === combo.id ? next : c)) })}
                    onRemove={() => onChange({ groupManualCombos: form.groupManualCombos.filter((c) => c.id !== combo.id) })}
                    dragHandleProps={comboDrag.getHandleProps(combo.id)}
                  />
                </div>
              ))}
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => onChange({
                  groupManualCombos: [
                    ...form.groupManualCombos,
                    { id: createTagComboGroupId(), tagIds: [], label: '', sortOrder: form.groupManualCombos.length },
                  ],
                })}
              >
                <Plus className='h-3.5 w-3.5' aria-hidden='true' /> Add combo
              </Button>
            </div>
          )}

          <div className='space-y-1 border-t border-clay/15 pt-3'>
            <Label className='text-xs'>How far back each status looks (hours)</Label>
            <Input
              type='number'
              min={1}
              value={form.groupLookbackHours}
              onChange={(event) => onChange({ groupLookbackHours: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })}
            />
            <p className='text-xs text-clay'>Measured back from the moment the report is generated, not frozen at save time — shared by New Admissions/Referrals/Discharged/Signed Out/Expired.</p>
          </div>

          <div className='space-y-1.5 border-t border-clay/15 pt-3'>
            <Label className='text-xs'>Group format — one evaluation per output group</Label>
            <ChipTextEditor
              initialPatternText={form.groupPatternText}
              initialFieldIds={initialGroupFieldIds}
              initialFieldFormats={initialGroupFieldFormats}
              catalog={GROUP_FORMAT_CATALOG}
              dateTimeFormats={dateTimeFormats}
              addButtonLabel='Add Field'
              pickerTitle='Add group field'
              onChange={(groupPatternText, fieldIds, fieldFormats) => {
                const groupVariables: Record<string, GroupVariableInstance> = {}
                Object.entries(fieldIds).forEach(([chipId, fieldId]) => {
                  const instance = buildGroupVariableInstanceForField(fieldId as GroupFieldId)
                  groupVariables[chipId] = instance.kind === 'flat' && fieldFormats[chipId]
                    ? { ...instance, dateTimeFormatId: fieldFormats[chipId] }
                    : instance
                })
                onChange({ groupPatternText, groupVariables })
              }}
            />
            <p className='text-xs text-clay'>
              "Patient Info" and each status's "(list)" field render their matching patients through the Main
              Template below, joined the same way as "Between patients" — a list resolves to nothing when empty,
              so a required separator placed right next to one can vanish along with it.
            </p>
          </div>

          <JoinModePicker
            label='Between groups'
            mode={form.groupSeparator}
            custom={form.customGroupSeparator}
            onModeChange={(groupSeparator) => onChange({ groupSeparator })}
            onCustomChange={(customGroupSeparator) => onChange({ customGroupSeparator })}
          />

          <div className='space-y-2 border-t border-clay/15 pt-3'>
            <Label className='text-xs'>Wrap each patient list with</Label>
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <Label className='text-xs text-clay'>Start text</Label>
                <TapToEditField
                  className='rounded-md border border-input bg-white'
                  ariaLabel='Start text'
                  emptyText='Tap to add start text'
                  value={form.groupListOpenText}
                  onCommit={(groupListOpenText) => onChange({ groupListOpenText })}
                  renderEditor={({ value, onChange: onEditorChange }) => (
                    <AutoGrowTextField aria-label='Start text' value={value} onChange={onEditorChange} placeholder='e.g. " ("' />
                  )}
                />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs text-clay'>End text</Label>
                <TapToEditField
                  className='rounded-md border border-input bg-white'
                  ariaLabel='End text'
                  emptyText='Tap to add end text'
                  value={form.groupListCloseText}
                  onCommit={(groupListCloseText) => onChange({ groupListCloseText })}
                  renderEditor={({ value, onChange: onEditorChange }) => (
                    <AutoGrowTextField aria-label='End text' value={value} onChange={onEditorChange} placeholder='e.g. ")"' />
                  )}
                />
              </div>
            </div>
            <label className='flex items-center gap-2.5 py-1 cursor-pointer'>
              <input
                type='checkbox'
                className='h-4 w-4 accent-action-primary'
                checked={form.groupShowListBracketsWhenEmpty}
                onChange={(event) => onChange({ groupShowListBracketsWhenEmpty: event.target.checked })}
              />
              <span className='text-sm text-espresso'>Show start/end text even when a list is empty</span>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** A Block variable's Number of Entries/Date Range setting (Medications instead gets a
 * status-inclusion filter — MedicationEntry carries no date), prompted right when the variable is
 * placed and saved as part of that specific placeholder (point 2 of issue #82) — plus, for record
 * types other than Labs (whose formatting is algorithmic, not field-composable), how each entry
 * (and, for Problems/Checklist, each date-group) is formatted. */
const BlockVariableConfigDialog = ({
  open,
  variableId,
  initialConfig,
  dateTimeFormats,
  onCancel,
  onSave,
}: {
  open: boolean
  variableId: BlockVariableId | null
  initialConfig: BlockVariableConfig
  dateTimeFormats: DateTimeFormatDefinition[]
  onCancel: () => void
  onSave: (config: BlockVariableConfig) => void
}) => {
  const [config, setConfig] = useState<BlockVariableConfig>(initialConfig)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setConfig(initialConfig)
      setSaveError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the draft only when the dialog (re)opens, not on every initialConfig identity change
  }, [open])

  if (!open || variableId === null) return null

  const entryCatalog: ChipCatalogEntry[] = (ENTRY_FIELD_ORDER_BY_BLOCK[variableId] ?? [])
    .map((fieldId) => ({
      id: fieldId,
      label: ENTRY_FIELD_LABELS_BY_BLOCK[variableId][fieldId],
      dateTimeCapable: isDateTimeCapableEntryField(variableId, fieldId),
    }))
  const isLabs = variableId === 'labs'
  const isMedications = variableId === 'medications'
  const supportsEntryPattern = !isLabs
  const isGrouped = variableId === 'problems' || variableId === 'checklist'

  const handleSaveClick = () => {
    if (!isMedications && config.rangeMode === 'dateRange' && config.relativeMode === 'fixed') {
      if (!config.fixedDateFrom || !config.fixedTimeFrom) {
        setSaveError('Enter a start date and time for Fixed Dates — unlike the "until" side, the start has no automatic default.')
        return
      }
      if (!config.fixedDateTo || !config.fixedTimeTo) {
        const now = new Date()
        onSave({
          ...config,
          fixedDateTo: config.fixedDateTo || toLocalISODate(now),
          fixedTimeTo: config.fixedTimeTo || toLocalTime(now),
        })
        return
      }
    }
    onSave(config)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className='max-w-md' onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{BLOCK_VARIABLE_LABELS[variableId]} settings</DialogTitle>
        </DialogHeader>
        <ScrollArea className='max-h-[65vh] pr-3'>
          <div className='space-y-4'>
            {isMedications ? (
              <div className='space-y-1.5'>
                <Label className='text-xs'>Include medications with status</Label>
                <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
                  <label className='flex items-center gap-2.5 py-1 cursor-pointer'>
                    <input type='checkbox' className='h-4 w-4 accent-action-primary' checked={config.includeActiveMedications} onChange={(event) => setConfig((previous) => ({ ...previous, includeActiveMedications: event.target.checked }))} />
                    <span className='text-sm text-espresso'>Active</span>
                  </label>
                  <label className='flex items-center gap-2.5 py-1 cursor-pointer'>
                    <input type='checkbox' className='h-4 w-4 accent-action-primary' checked={config.includeDiscontinuedMedications} onChange={(event) => setConfig((previous) => ({ ...previous, includeDiscontinuedMedications: event.target.checked }))} />
                    <span className='text-sm text-espresso'>Discontinued</span>
                  </label>
                  <label className='flex items-center gap-2.5 py-1 cursor-pointer'>
                    <input type='checkbox' className='h-4 w-4 accent-action-primary' checked={config.includeCompletedMedications} onChange={(event) => setConfig((previous) => ({ ...previous, includeCompletedMedications: event.target.checked }))} />
                    <span className='text-sm text-espresso'>Completed</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className='space-y-3'>
                <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                  {(['numberOfEntries', 'dateRange'] as BlockVariableRangeMode[]).map((mode) => (
                    <Button
                      key={mode}
                      type='button'
                      size='sm'
                      variant={config.rangeMode === mode ? 'default' : 'ghost'}
                      className='flex-1 text-xs'
                      onClick={() => setConfig((previous) => ({ ...previous, rangeMode: mode }))}
                    >
                      {mode === 'numberOfEntries' ? 'Number of Entries' : 'Date Range'}
                    </Button>
                  ))}
                </div>

                {config.rangeMode === 'numberOfEntries' ? (
                  <div className='space-y-1'>
                    <Label className='text-xs'>Number of most recent entries</Label>
                    <Input
                      type='number'
                      min={1}
                      value={config.entryCount}
                      onChange={(event) => setConfig((previous) => ({ ...previous, entryCount: Math.max(1, Number.parseInt(event.target.value, 10) || 1) }))}
                    />
                    <p className='text-xs text-clay'>
                      {isGrouped
                        ? 'Set to 1 for just the single most recent day.'
                        : 'Set to 1 for just the single most recent entry. Setting this to 2 for Labs keeps the existing side-by-side comparison formatting.'}
                    </p>
                  </div>
                ) : null}

                {config.rangeMode === 'dateRange' ? (
                  <div className='space-y-2'>
                    <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                      {(['sinceAdmission', 'lastNDays', 'fixed'] as RelativeDateRangeMode[]).map((mode) => (
                        <Button
                          key={mode}
                          type='button'
                          size='sm'
                          variant={config.relativeMode === mode ? 'default' : 'ghost'}
                          className='flex-1 text-xs'
                          onClick={() => setConfig((previous) => ({ ...previous, relativeMode: mode }))}
                        >
                          {mode === 'sinceAdmission' ? 'Since Admission' : mode === 'lastNDays' ? 'Last N days' : 'Fixed dates'}
                        </Button>
                      ))}
                    </div>
                    {config.relativeMode === 'lastNDays' ? (
                      <div className='space-y-1'>
                        <Label className='text-xs'>Number of days</Label>
                        <Input
                          type='number'
                          min={1}
                          value={config.lastNDays}
                          onChange={(event) => setConfig((previous) => ({ ...previous, lastNDays: Math.max(1, Number.parseInt(event.target.value, 10) || 1) }))}
                        />
                      </div>
                    ) : null}
                    {config.relativeMode === 'fixed' ? (
                      <div className='space-y-2'>
                        <div className='grid grid-cols-2 gap-2'>
                          <div className='space-y-1'>
                            <Label className='text-xs'>From date</Label>
                            <FlexibleDateInput
                              ariaLabel='From date'
                              value={config.fixedDateFrom}
                              onChange={(isoDate) => setConfig((previous) => ({ ...previous, fixedDateFrom: isoDate }))}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label className='text-xs'>From time</Label>
                            <FlexibleTimeInput
                              ariaLabel='From time'
                              value={config.fixedTimeFrom}
                              onChange={(hhmm) => setConfig((previous) => ({ ...previous, fixedTimeFrom: hhmm }))}
                            />
                          </div>
                        </div>
                        <div className='grid grid-cols-2 gap-2'>
                          <div className='space-y-1'>
                            <Label className='text-xs'>Until date</Label>
                            <FlexibleDateInput
                              ariaLabel='Until date'
                              value={config.fixedDateTo}
                              defaultIso={toLocalISODate()}
                              emitEmptyOnClear
                              onChange={(isoDate) => setConfig((previous) => ({ ...previous, fixedDateTo: isoDate }))}
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label className='text-xs'>Until time</Label>
                            <FlexibleTimeInput
                              ariaLabel='Until time'
                              value={config.fixedTimeTo}
                              defaultHhmm={toLocalTime()}
                              emitEmptyOnClear
                              onChange={(hhmm) => setConfig((previous) => ({ ...previous, fixedTimeTo: hhmm }))}
                            />
                          </div>
                        </div>
                        <p className='text-xs text-clay'>
                          A start date and time are required. Leaving "Until" blank fills it in with the exact date and time you save this — so the template keeps showing the same fixed window every time it's used later, rather than always meaning "up to whenever it happens to run."
                        </p>
                      </div>
                    ) : null}
                    <p className='text-xs text-clay'>A fixed date range only produces useful output on dates within it — prefer a relative option for a template you'll reuse.</p>
                  </div>
                ) : null}
              </div>
            )}

            {supportsEntryPattern ? (
              <>
                <div className='border-t border-clay/15 pt-3 space-y-1.5'>
                  <Label className='text-xs'>How each entry renders</Label>
                  <ChipTextEditor
                    key={variableId}
                    initialPatternText={config.entryPatternText}
                    initialFieldIds={config.entryFieldIds}
                    initialFieldFormats={config.entryFieldDateTimeFormats}
                    catalog={entryCatalog}
                    dateTimeFormats={dateTimeFormats}
                    addButtonLabel='Add Field'
                    pickerTitle={`Add ${BLOCK_VARIABLE_LABELS[variableId]} field`}
                    onChange={(entryPatternText, entryFieldIds, entryFieldDateTimeFormats) => setConfig((previous) => ({ ...previous, entryPatternText, entryFieldIds, entryFieldDateTimeFormats }))}
                  />
                </div>

                {variableId === 'checklist' ? (
                  <div className='grid grid-cols-2 gap-2'>
                    <div className='space-y-1'>
                      <Label className='text-xs'>Checked glyph</Label>
                      <Input value={config.checkedGlyph} onChange={(event) => setConfig((previous) => ({ ...previous, checkedGlyph: event.target.value }))} />
                    </div>
                    <div className='space-y-1'>
                      <Label className='text-xs'>Unchecked glyph</Label>
                      <Input value={config.uncheckedGlyph} onChange={(event) => setConfig((previous) => ({ ...previous, uncheckedGlyph: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {variableId === 'problems' ? (
                  <div className='grid grid-cols-2 gap-2'>
                    <div className='space-y-1'>
                      <Label className='text-xs'>Resolved glyph</Label>
                      <Input value={config.resolvedGlyph} onChange={(event) => setConfig((previous) => ({ ...previous, resolvedGlyph: event.target.value }))} />
                    </div>
                    <div className='space-y-1'>
                      <Label className='text-xs'>Unresolved glyph</Label>
                      <Input value={config.unresolvedGlyph} onChange={(event) => setConfig((previous) => ({ ...previous, unresolvedGlyph: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                <JoinModePicker
                  label={isGrouped ? 'Between entries in the same day' : 'Between entries'}
                  mode={config.entrySeparator}
                  custom={config.customEntrySeparator}
                  onModeChange={(entrySeparator) => setConfig((previous) => ({ ...previous, entrySeparator }))}
                  onCustomChange={(customEntrySeparator) => setConfig((previous) => ({ ...previous, customEntrySeparator }))}
                />

                {isMedications ? (
                  <div className='border-t border-clay/15 pt-3 space-y-2'>
                    <label className='flex items-center gap-2.5 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={config.includeMedicationNotes}
                        onChange={(event) => setConfig((previous) => ({ ...previous, includeMedicationNotes: event.target.checked }))}
                      />
                      <span className='text-sm text-espresso'>Include the freeform Medications-tab notes</span>
                    </label>
                    {config.includeMedicationNotes ? (
                      <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                        <Button type='button' size='sm' variant={config.medicationNotesPosition === 'before' ? 'default' : 'ghost'} className='flex-1 text-xs' onClick={() => setConfig((previous) => ({ ...previous, medicationNotesPosition: 'before' }))}>Before the list</Button>
                        <Button type='button' size='sm' variant={config.medicationNotesPosition === 'after' ? 'default' : 'ghost'} className='flex-1 text-xs' onClick={() => setConfig((previous) => ({ ...previous, medicationNotesPosition: 'after' }))}>After the list</Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isGrouped ? (
                  <div className='border-t border-clay/15 pt-3 space-y-3'>
                    <label className='flex items-center gap-2.5 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={config.showGroupHeader}
                        onChange={(event) => setConfig((previous) => ({ ...previous, showGroupHeader: event.target.checked }))}
                      />
                      <span className='text-sm text-espresso'>Show a date header above each day's entries</span>
                    </label>

                    {config.showGroupHeader ? (
                      <div className='space-y-1'>
                        <Label className='text-xs'>Date header format</Label>
                        <Select
                          value={config.groupHeaderDateFormatId ?? NO_FORMAT_VALUE}
                          onValueChange={(value) => setConfig((previous) => ({ ...previous, groupHeaderDateFormatId: value === NO_FORMAT_VALUE ? undefined : value }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_FORMAT_VALUE}>Default (MM-DD-YYYY)</SelectItem>
                            {dateTimeFormats.map((format) => (
                              <SelectItem key={format.id} value={String(format.id)}>{format.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <JoinModePicker
                      label='Between days'
                      mode={config.groupSeparator}
                      custom={config.customGroupSeparator}
                      onModeChange={(groupSeparator) => setConfig((previous) => ({ ...previous, groupSeparator }))}
                      onCustomChange={(customGroupSeparator) => setConfig((previous) => ({ ...previous, customGroupSeparator }))}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className='border-t border-clay/15 pt-3 space-y-3'>
                <p className='text-xs text-clay'>
                  Labs' comparison-mode formatting is generated automatically and isn't field-composable — but how the date shows, and how results are separated, still are.
                </p>
                <div className='space-y-1'>
                  <Label className='text-xs'>Date display</Label>
                  <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                    {(['perEntry', 'none', 'groupedByDate'] as LabsDateDisplayMode[]).map((mode) => (
                      <Button
                        key={mode}
                        type='button'
                        size='sm'
                        variant={config.labsDateDisplayMode === mode ? 'default' : 'ghost'}
                        className='flex-1 text-xs px-1'
                        onClick={() => setConfig((previous) => ({ ...previous, labsDateDisplayMode: mode }))}
                      >
                        {mode === 'perEntry' ? 'With each result' : mode === 'none' ? "Don't show" : 'Group by date'}
                      </Button>
                    ))}
                  </div>
                </div>

                {config.labsDateDisplayMode !== 'none' ? (
                  <div className='space-y-1'>
                    <Label className='text-xs'>{config.labsDateDisplayMode === 'groupedByDate' ? 'Date header format' : 'Date format'}</Label>
                    <Select
                      value={config.groupHeaderDateFormatId ?? NO_FORMAT_VALUE}
                      onValueChange={(value) => setConfig((previous) => ({ ...previous, groupHeaderDateFormatId: value === NO_FORMAT_VALUE ? undefined : value }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_FORMAT_VALUE}>Default (MM-DD-YYYY)</SelectItem>
                        {dateTimeFormats.map((format) => (
                          <SelectItem key={format.id} value={String(format.id)}>{format.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <JoinModePicker
                  label={config.labsDateDisplayMode === 'groupedByDate' ? 'Between results on the same day' : 'Between results'}
                  mode={config.entrySeparator}
                  custom={config.customEntrySeparator}
                  onModeChange={(entrySeparator) => setConfig((previous) => ({ ...previous, entrySeparator }))}
                  onCustomChange={(customEntrySeparator) => setConfig((previous) => ({ ...previous, customEntrySeparator }))}
                />

                {config.labsDateDisplayMode === 'groupedByDate' ? (
                  <JoinModePicker
                    label='Between days'
                    mode={config.groupSeparator}
                    custom={config.customGroupSeparator}
                    onModeChange={(groupSeparator) => setConfig((previous) => ({ ...previous, groupSeparator }))}
                    onCustomChange={(customGroupSeparator) => setConfig((previous) => ({ ...previous, customGroupSeparator }))}
                  />
                ) : null}
              </div>
            )}
          </div>
        </ScrollArea>
        {saveError ? <p className='text-xs text-red-600 pt-2'>{saveError}</p> : null}
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={onCancel}>Cancel</Button>
          <Button type='button' onClick={handleSaveClick}>{describeBlockConfig(config) ? 'Save' : 'Insert'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Tags-specific settings (point 2's Tags bullet): which tags/groups to include, independent of
 * Issue 1's "Visible on Patient Card" toggle, and whether Emoji-type tags render as glyph or name. */
const TagsVariableConfigDialog = ({
  open,
  initialConfig,
  tags,
  groups,
  onCancel,
  onSave,
}: {
  open: boolean
  initialConfig: TagsVariableConfig
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onCancel: () => void
  onSave: (config: TagsVariableConfig) => void
}) => {
  const [config, setConfig] = useState<TagsVariableConfig>(initialConfig)

  useEffect(() => {
    if (open) setConfig(initialConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the draft only when the dialog (re)opens
  }, [open])

  const buckets = bucketTagsByGroup(tags, groups)

  if (!open) return null

  const toggleTag = (tagId: number) => {
    setConfig((previous) => ({
      ...previous,
      tagIds: previous.tagIds.includes(tagId) ? previous.tagIds.filter((id) => id !== tagId) : [...previous.tagIds, tagId],
    }))
  }
  const toggleGroup = (groupId: number) => {
    setConfig((previous) => ({
      ...previous,
      groupIds: previous.groupIds.includes(groupId) ? previous.groupIds.filter((id) => id !== groupId) : [...previous.groupIds, groupId],
    }))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className='max-w-md' onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Tags settings</DialogTitle>
        </DialogHeader>
        <ScrollArea className='max-h-[55vh] pr-3'>
          <div className='space-y-3'>
            <label className='flex items-center gap-2.5 cursor-pointer'>
              <input
                type='checkbox'
                className='h-4 w-4 accent-action-primary'
                checked={config.includeAll}
                onChange={(event) => setConfig((previous) => ({ ...previous, includeAll: event.target.checked }))}
              />
              <span className='text-sm text-espresso'>Include every applied tag</span>
            </label>

            {!config.includeAll ? (
              <div className='space-y-3'>
                {buckets.map((bucket) => (
                  <div key={bucket.groupId ?? 'ungrouped'} className='space-y-1.5'>
                    <div className='flex items-center justify-between'>
                      <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>{bucket.groupName}</p>
                      {bucket.groupId !== null ? (
                        <label className='flex items-center gap-1.5 cursor-pointer'>
                          <input
                            type='checkbox'
                            className='h-3.5 w-3.5 accent-action-primary'
                            checked={config.groupIds.includes(bucket.groupId)}
                            onChange={() => toggleGroup(bucket.groupId as number)}
                          />
                          <span className='text-xs text-clay'>Whole group</span>
                        </label>
                      ) : null}
                    </div>
                    <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
                      {bucket.tags.map((tag) => (
                        <label key={tag.id} className='flex items-center gap-2.5 py-1 cursor-pointer'>
                          <input
                            type='checkbox'
                            className='h-4 w-4 accent-action-primary'
                            checked={tag.id !== undefined && config.tagIds.includes(tag.id)}
                            onChange={() => tag.id !== undefined && toggleTag(tag.id)}
                          />
                          <span className='text-sm text-espresso'>{tag.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className='space-y-1.5'>
              <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Emoji tags render as</p>
              <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                <Button type='button' size='sm' variant={config.emojiRendering === 'emoji' ? 'default' : 'ghost'} className='flex-1 text-xs' onClick={() => setConfig((previous) => ({ ...previous, emojiRendering: 'emoji' }))}>Emoji glyph</Button>
                <Button type='button' size='sm' variant={config.emojiRendering === 'name' ? 'default' : 'ghost'} className='flex-1 text-xs' onClick={() => setConfig((previous) => ({ ...previous, emojiRendering: 'name' }))}>Plain name</Button>
              </div>
              <p className='text-xs text-clay'>Text-with-Color tags always render as their plain name.</p>
            </div>
          </div>
        </ScrollArea>
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={onCancel}>Cancel</Button>
          <Button type='button' onClick={() => onSave(config)}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const CURRENT_DATE_TIME_FLAT_IDS: FlatVariableId[] = ['currentDate', 'currentTime']

const VariablePickerDialog = ({
  open,
  onClose,
  onPickFlat,
  onPickTags,
  onPickBlock,
  restrictToCurrentDateTime = false,
}: {
  open: boolean
  onClose: () => void
  onPickFlat: (variableId: FlatVariableId) => void
  onPickTags: () => void
  onPickBlock: (variableId: BlockVariableId) => void
  /** Header/Footer content prints once per run, not per patient, so only Current Date/Current
   * Time (plus whatever literal text is typed) make sense there — every other variable reads from
   * a specific patient and is left out of the picker entirely in this mode. */
  restrictToCurrentDateTime?: boolean
}) => (
  <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent className='max-w-md' onCloseAutoFocus={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Add variable</DialogTitle>
      </DialogHeader>
      {restrictToCurrentDateTime ? (
        <ScrollArea className='max-h-[50vh] pr-3'>
          <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-2 py-1'>
            {CURRENT_DATE_TIME_FLAT_IDS.map((variableId) => (
              <button
                key={variableId}
                type='button'
                className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                onClick={() => onPickFlat(variableId)}
              >
                {FLAT_VARIABLE_LABELS[variableId]}
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <Tabs defaultValue='identity'>
          <TabsList className='flex-wrap h-auto'>
            {PICKER_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className='text-xs'>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
          {PICKER_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id}>
              <ScrollArea className='max-h-[50vh] pr-3'>
                <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-2 py-1'>
                  {tab.id === 'tags' ? (
                    <button
                      type='button'
                      className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                      onClick={onPickTags}
                    >
                      Tags
                    </button>
                  ) : tab.id === 'records' ? (
                    BLOCK_VARIABLE_ORDER.map((variableId) => (
                      <button
                        key={variableId}
                        type='button'
                        className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                        onClick={() => onPickBlock(variableId)}
                      >
                        {BLOCK_VARIABLE_LABELS[variableId]}
                      </button>
                    ))
                  ) : (
                    (tab.flatIds ?? []).map((variableId) => (
                      <button
                        key={variableId}
                        type='button'
                        className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                        onClick={() => onPickFlat(variableId)}
                      >
                        {FLAT_VARIABLE_LABELS[variableId]}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      )}
      <div className='flex justify-end pt-2'>
        <Button type='button' variant='ghost' onClick={onClose}>Cancel</Button>
      </div>
    </DialogContent>
  </Dialog>
)

const CHIP_CLASS = 'inline-flex items-center rounded-full bg-action-primary/15 px-2 py-0.5 text-xs font-semibold text-action-primary align-baseline mx-0.5 cursor-pointer select-none whitespace-nowrap'

const buildChipElement = (id: string, instance: TemplateVariableInstance): HTMLSpanElement => {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.dataset.variableId = id
  chip.className = CHIP_CLASS
  chip.textContent = describeVariableInstance(instance)
  return chip
}

// A caret-anchoring spacer placed beside every chip (see the mount effect and
// insertInstanceAtSavedRange below) — a zero-width space rather than a truly empty string, since
// an empty text node isn't reliably hit-testable by the browser's own click-to-caret resolution
// (`caretRangeFromPoint`/`caretPositionFromPoint`), which is exactly what made a chip that's first
// on its line unclickable on its left. Renders as nothing; stripped back out in `serialize` below
// so it never leaks into the saved pattern text.
const CARET_SPACER = '\u200B'

const isSpacerTextNode = (node: Node | null): node is Text =>
  node !== null && node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').split(CARET_SPACER).join('').length === 0

/** Walks past any number of consecutive spacer-only text nodes to the nearest real node (a chip,
 * a <br>, or actual text) — clicking directly on a chip's edge (see handleContainerMouseDown)
 * lands the caret at a container child-offset pointing at the chip itself, with its spacer as the
 * immediate sibling rather than the <br>/chip the spacer was placed beside, so a single-sibling
 * check isn't enough to find it. */
const skipSpacers = (node: Node | null, direction: 'before' | 'after'): Node | null => {
  let current = node
  while (isSpacerTextNode(current)) {
    current = direction === 'before' ? current.previousSibling : current.nextSibling
  }
  return current
}

/**
 * A free-text editing surface — type any string, press Enter for a new line — with variable
 * placeholders rendered as inline, non-editable "chip" blocks instead of raw `{{var:...}}` text.
 * Mirrors this app's existing @-mention text fields (PhotoMentionField): the canonical value is
 * still a plain string with embedded tokens, this component just also keeps a live DOM view of it.
 */
const FormatPatternEditor = ({
  initialPatternText,
  initialVariables,
  onChange,
  tags,
  groups,
  dateTimeFormats,
  variableScope = 'full',
}: {
  initialPatternText: string
  initialVariables: Record<string, TemplateVariableInstance>
  onChange: (patternText: string, variables: Record<string, TemplateVariableInstance>) => void
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  dateTimeFormats: DateTimeFormatDefinition[]
  /** 'currentDateTimeOnly' restricts the Add Variable picker to just Current Date/Current Time —
   * for a template's Header/Footer, which prints once per run rather than once per patient, so no
   * patient-dependent variable belongs there. */
  variableScope?: 'full' | 'currentDateTimeOnly'
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const variablesRef = useRef<Record<string, TemplateVariableInstance>>(initialVariables)
  const savedRangeRef = useRef<Range | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingBlockVariable, setPendingBlockVariable] = useState<BlockVariableId | null>(null)
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false)
  const [pendingDateTimeFlatId, setPendingDateTimeFlatId] = useState<FlatVariableId | null>(null)
  /** Non-null while the config dialog is editing an EXISTING chip (clicked in the editor) rather
   * than about to insert a brand-new one from the picker. */
  const [reconfiguringId, setReconfiguringId] = useState<string | null>(null)

  // Builds the initial DOM once on mount. A `key` prop from the parent (the template being
  // edited) forces a remount whenever a different template is loaded, so this never needs to
  // reconcile against a changed `initialPatternText` after the fact.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    tokenizePatternText(initialPatternText).forEach((part) => {
      if (part.type === 'text') {
        container.appendChild(document.createTextNode(part.text))
      } else if (part.type === 'lineBreak') {
        container.appendChild(document.createElement('br'))
      } else {
        const instance = initialVariables[part.id]
        if (instance) {
          // A leading spacer gives the caret somewhere to land immediately before the chip even
          // when nothing else precedes it (e.g. right after a <br>, i.e. the chip is first on its
          // line) — without it, that position isn't reliably clickable or keyboard-reachable, and
          // Backspace there falls through to the browser's native handling, which can end up
          // deleting the chip along with the line break instead of just the break.
          container.appendChild(document.createTextNode(CARET_SPACER))
          container.appendChild(buildChipElement(part.id, instance))
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs once per mount only; see comment above
  }, [])

  // Tracks the caret continuously (rather than only on click/keyup) so "Add Variable" always
  // inserts where the user last left the cursor, including right after a typed character —
  // input events don't reliably follow every selection change, but selectionchange does.
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (containerRef.current?.contains(range.startContainer)) {
        savedRangeRef.current = range.cloneRange()
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  const serialize = (): { patternText: string; variables: Record<string, TemplateVariableInstance> } => {
    const container = containerRef.current
    let patternText = ''
    const usedIds = new Set<string>()
    if (container) {
      container.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          patternText += (node.textContent ?? '').split(CARET_SPACER).join('')
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement
          if (element.tagName === 'BR') {
            patternText += '\n'
          } else if (element.dataset.variableId) {
            patternText += buildVariableToken(element.dataset.variableId)
            usedIds.add(element.dataset.variableId)
          }
        }
      })
    }
    const nextVariables: Record<string, TemplateVariableInstance> = {}
    usedIds.forEach((id) => {
      const instance = variablesRef.current[id]
      if (instance) nextVariables[id] = instance
    })
    variablesRef.current = nextVariables
    return { patternText, variables: nextVariables }
  }

  const emitChange = () => {
    const { patternText, variables } = serialize()
    onChange(patternText, variables)
  }

  /** The nearest real node (chip, <br>, or actual text) immediately before/after the caret,
   * however it's currently anchored — inside a text node, or directly in the container/a block
   * element between two other nodes (e.g. right after clicking a chip's edge, see
   * handleContainerMouseDown). A spacer text node has no real position to be "inside" of — any
   * offset within one (including both of a single zero-width character's two offsets, which are
   * visually indistinguishable to a click) counts as sitting at its edge, so skipSpacers always
   * walks past it to whatever's actually beside it. */
  const getAdjacentNode = (direction: 'before' | 'after'): Node | null => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
    const { startContainer, startOffset } = selection.getRangeAt(0)
    if (!container.contains(startContainer)) return null

    if (startContainer.nodeType === Node.TEXT_NODE) {
      const atEdge = isSpacerTextNode(startContainer)
        || (direction === 'before' ? startOffset === 0 : startOffset === (startContainer.textContent?.length ?? 0))
      if (!atEdge) return null
      const sibling = direction === 'before' ? startContainer.previousSibling : startContainer.nextSibling
      return skipSpacers(sibling, direction)
    }
    const sibling = direction === 'before' ? startContainer.childNodes[startOffset - 1] ?? null : startContainer.childNodes[startOffset] ?? null
    return skipSpacers(sibling, direction)
  }

  /** Whether the caret sits immediately before/after a chip — browsers are inconsistent about
   * deleting an atomic contentEditable=false node with a single Backspace/Delete press, so this
   * is checked explicitly rather than relying on native contentEditable delete behavior. */
  const getAdjacentChip = (direction: 'before' | 'after'): HTMLElement | null => {
    const node = getAdjacentNode(direction)
    return node instanceof HTMLElement && node.dataset.variableId ? node : null
  }

  /** Same idea as `getAdjacentChip`, for a <br> — Backspace/Delete right next to a chip's leading
   * spacer (see the mount effect above) would otherwise fall through to the browser's native
   * handling, which can delete the line break AND the adjacent chip in one go instead of just the
   * break. Checked only once `getAdjacentChip` has ruled out a chip being the adjacent node. */
  const getAdjacentLineBreak = (direction: 'before' | 'after'): HTMLElement | null => {
    const node = getAdjacentNode(direction)
    return node instanceof HTMLElement && node.tagName === 'BR' ? node : null
  }

  /**
   * Inserts a <br> at the caret via the standard, spec-defined Range API instead of the
   * deprecated `document.execCommand('insertLineBreak')` — execCommand's exact behavior (where
   * the <br> lands, what it does to a text node it splits, where the caret ends up afterward)
   * isn't reliably consistent across browsers, which is what made Enter near an existing chip's
   * spacer produce an unpredictable DOM shape the adjacency checks below couldn't always account
   * for. This makes the result fully deterministic: exactly `<br>` followed by one fresh spacer,
   * with the caret placed in that spacer — the same anchor a chip gets when inserted.
   */
  const insertLineBreakAtCaret = () => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection) return
    const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const range = currentRange && container.contains(currentRange.startContainer) ? currentRange : (() => {
      const fallback = document.createRange()
      fallback.selectNodeContents(container)
      fallback.collapse(false)
      return fallback
    })()

    range.deleteContents()
    const br = document.createElement('br')
    range.insertNode(br)

    const spacer = document.createTextNode(CARET_SPACER)
    br.parentNode?.insertBefore(spacer, br.nextSibling)
    const newRange = document.createRange()
    newRange.setStart(spacer, 0)
    newRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(newRange)
    savedRangeRef.current = newRange.cloneRange()
  }

  const isAtomicNode = (node: Node | null): node is HTMLElement =>
    node !== null && node.nodeType === Node.ELEMENT_NODE
    && ((node as HTMLElement).dataset.variableId !== undefined || (node as HTMLElement).tagName === 'BR')

  /**
   * Moves the caret one full chip or <br> at a time instead of one DOM position at a time — left
   * to native ArrowLeft/ArrowRight, every chip and line break now costs 3 presses to get past (its
   * leading spacer, itself, its trailing spacer) since each spacer is a real, if invisible,
   * character. A chip is meant to read as a single character and a line break as a single line
   * boundary, so this collapses each crossing back down to one press — mirroring how
   * getAdjacentChip/getAdjacentLineBreak above already treat a spacer as "no real content here"
   * for Backspace/Delete. Only intercepts a plain arrow press at a boundary; an unmodified move in
   * the middle of ordinary text, or any modified (shift/ctrl/alt/meta) press, is left to the
   * browser so selection-extension and word-jump keep working normally.
   */
  const moveCaretPastBoundary = (direction: 'before' | 'after'): boolean => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
    const { startContainer, startOffset } = selection.getRangeAt(0)
    if (!container.contains(startContainer)) return false

    let searchFrom: Node | null
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const atEdge = isSpacerTextNode(startContainer)
        || (direction === 'before' ? startOffset === 0 : startOffset === (startContainer.textContent?.length ?? 0))
      if (!atEdge) return false
      searchFrom = direction === 'before' ? startContainer.previousSibling : startContainer.nextSibling
    } else {
      searchFrom = direction === 'before' ? startContainer.childNodes[startOffset - 1] ?? null : startContainer.childNodes[startOffset] ?? null
    }

    const node = skipSpacers(searchFrom, direction)
    const range = document.createRange()

    if (node === null) {
      range.setStart(container, direction === 'before' ? 0 : container.childNodes.length)
    } else if (isAtomicNode(node)) {
      const beyond = direction === 'before' ? node.previousSibling : node.nextSibling
      const landing = skipSpacers(beyond, direction)
      if (landing === null) {
        range.setStart(container, direction === 'before' ? 0 : container.childNodes.length)
      } else if (landing.nodeType === Node.TEXT_NODE) {
        range.setStart(landing, direction === 'before' ? (landing.textContent?.length ?? 0) : 0)
      } else if (direction === 'before') {
        range.setStartAfter(landing)
      } else {
        range.setStartBefore(landing)
      }
    } else {
      range.setStart(node, direction === 'before' ? (node.textContent?.length ?? 0) : 0)
    }

    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    savedRangeRef.current = range.cloneRange()
    return true
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      insertLineBreakAtCaret()
      emitChange()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const adjacentDirection = event.key === 'Backspace' ? 'before' : 'after'
      const chip = getAdjacentChip(adjacentDirection)
      if (chip) {
        event.preventDefault()
        chip.remove()
        emitChange()
        return
      }
      const lineBreak = getAdjacentLineBreak(adjacentDirection)
      if (lineBreak) {
        event.preventDefault()
        lineBreak.remove()
        emitChange()
      }
      return
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const direction = event.key === 'ArrowLeft' ? 'before' : 'after'
      if (moveCaretPastBoundary(direction)) event.preventDefault()
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    emitChange()
  }

  /**
   * Places the caret immediately before/after a clicked chip. A contentEditable=false element
   * can't itself host a caret, and left to the browser's default mousedown handling, clicking one
   * directly can leave the Selection pointing at an unrelated, stale position elsewhere on the
   * page (outside this editor entirely) — so a Backspace right after appears to silently do
   * nothing. Intercepting mousedown and resolving the position ourselves avoids that; the click
   * handler below (which fires after mousedown) still separately opens the reconfigure dialog.
   */
  const handleContainerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const chipEl = target.closest('[data-variable-id]') as HTMLElement | null
    if (!chipEl || !containerRef.current?.contains(chipEl)) return
    event.preventDefault()
    const rect = chipEl.getBoundingClientRect()
    const clickedRightHalf = event.clientX > rect.left + rect.width / 2
    const range = document.createRange()
    if (clickedRightHalf) range.setStartAfter(chipEl)
    else range.setStartBefore(chipEl)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    savedRangeRef.current = range.cloneRange()
    containerRef.current.focus()
  }

  const handleContainerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const chipEl = target.closest('[data-variable-id]') as HTMLElement | null
    const id = chipEl?.dataset.variableId
    if (!id) return
    const instance = variablesRef.current[id]
    if (!instance) return
    if (instance.kind === 'block') {
      setReconfiguringId(id)
      setPendingBlockVariable(instance.variableId)
    } else if (instance.kind === 'tags') {
      setReconfiguringId(id)
      setTagsDialogOpen(true)
    } else if (instance.kind === 'flat' && DATE_TIME_CAPABLE_FLAT_VARIABLE_IDS.has(instance.variableId)) {
      setReconfiguringId(id)
      setPendingDateTimeFlatId(instance.variableId)
    }
  }

  const insertInstanceAtSavedRange = (instance: TemplateVariableInstance) => {
    const container = containerRef.current
    if (!container) return
    const id = createVariableId()
    const chip = buildChipElement(id, instance)
    variablesRef.current = { ...variablesRef.current, [id]: instance }

    let range = savedRangeRef.current
    if (!range || !container.contains(range.startContainer)) {
      range = document.createRange()
      range.selectNodeContents(container)
      range.collapse(false)
    }
    range.deleteContents()
    range.insertNode(chip)
    // Leading spacer mirrors the one in the mount effect above — same reasoning: gives the caret
    // somewhere to land immediately before the chip even if it ends up first on its line.
    chip.parentNode?.insertBefore(document.createTextNode(CARET_SPACER), chip)

    const spacer = document.createTextNode(CARET_SPACER)
    chip.parentNode?.insertBefore(spacer, chip.nextSibling)
    const newRange = document.createRange()
    newRange.setStart(spacer, 0)
    newRange.collapse(true)

    savedRangeRef.current = newRange.cloneRange()
    const restoreCaret = () => {
      container.focus()
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(newRange)
    }
    restoreCaret()
    // The variable picker is a Radix Dialog with a ~200ms close transition; its FocusScope keeps
    // reclaiming focus for the duration of that animation, so a rAF-timed retry isn't late enough.
    // Reasserting after the transition settles wins reliably regardless of animation timing quirks.
    window.setTimeout(restoreCaret, 260)
    emitChange()
  }

  const updateExistingChip = (id: string, instance: TemplateVariableInstance) => {
    variablesRef.current = { ...variablesRef.current, [id]: instance }
    const chipEl = containerRef.current?.querySelector<HTMLElement>(`[data-variable-id="${id}"]`)
    if (chipEl) chipEl.textContent = describeVariableInstance(instance)
    emitChange()
  }

  const currentBlockConfig = (() => {
    if (reconfiguringId !== null) {
      const instance = variablesRef.current[reconfiguringId]
      if (instance?.kind === 'block') return instance.config
    }
    return buildDefaultBlockVariableConfig(pendingBlockVariable ?? 'vitals')
  })()

  const currentTagsConfig = (() => {
    if (reconfiguringId === null) return DEFAULT_TAGS_VARIABLE_CONFIG
    const instance = variablesRef.current[reconfiguringId]
    return instance?.kind === 'tags' ? instance.config : DEFAULT_TAGS_VARIABLE_CONFIG
  })()

  const currentDateTimeFormatId = (() => {
    if (reconfiguringId === null) return undefined
    const instance = variablesRef.current[reconfiguringId]
    return instance?.kind === 'flat' ? instance.dateTimeFormatId : undefined
  })()

  const isHeaderFooter = variableScope === 'currentDateTimeOnly'

  return (
    <div className='space-y-1.5'>
      <div
        ref={containerRef}
        role='textbox'
        aria-multiline='true'
        aria-label='Format Pattern'
        contentEditable
        suppressContentEditableWarning
        className={cn(
          'whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          isHeaderFooter
            ? 'min-h-12 border border-dashed border-clay/25 bg-warm-ivory/60'
            : 'min-h-24 border border-clay/25 bg-white',
        )}
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onMouseDown={handleContainerMouseDown}
        onClick={handleContainerClick}
      />
      <div className='flex flex-wrap gap-2'>
        <Button type='button' size='sm' variant='outline' onClick={() => setPickerOpen(true)}>
          <Plus className='h-3.5 w-3.5' aria-hidden='true' /> Add Variable
        </Button>
      </div>
      <p className='text-xs text-clay'>
        {variableScope === 'currentDateTimeOnly'
          ? 'Type directly, press Enter for a new line, and click "Add Variable" for Current Date/Current Time — this prints once per run, so no patient-specific variable is available here.'
          : 'Type directly, press Enter for a new line, and click "Add Variable" to drop one in at your cursor. Click an inserted Vitals/Labs/Problems/Checklist/Orders/Medications/Tags block — or a date/time variable — to change its settings.'}
      </p>

      <VariablePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        restrictToCurrentDateTime={variableScope === 'currentDateTimeOnly'}
        onPickFlat={(variableId) => {
          setPickerOpen(false)
          if (DATE_TIME_CAPABLE_FLAT_VARIABLE_IDS.has(variableId)) {
            setReconfiguringId(null)
            setPendingDateTimeFlatId(variableId)
          } else {
            insertInstanceAtSavedRange({ kind: 'flat', variableId })
          }
        }}
        onPickTags={() => {
          setPickerOpen(false)
          setReconfiguringId(null)
          setTagsDialogOpen(true)
        }}
        onPickBlock={(variableId) => {
          setPickerOpen(false)
          setReconfiguringId(null)
          setPendingBlockVariable(variableId)
        }}
      />

      <BlockVariableConfigDialog
        open={pendingBlockVariable !== null}
        variableId={pendingBlockVariable}
        initialConfig={currentBlockConfig}
        dateTimeFormats={dateTimeFormats}
        onCancel={() => { setPendingBlockVariable(null); setReconfiguringId(null) }}
        onSave={(config) => {
          if (pendingBlockVariable === null) return
          const instance: TemplateVariableInstance = { kind: 'block', variableId: pendingBlockVariable, config }
          if (reconfiguringId !== null) {
            updateExistingChip(reconfiguringId, instance)
          } else {
            insertInstanceAtSavedRange(instance)
          }
          setPendingBlockVariable(null)
          setReconfiguringId(null)
        }}
      />

      <TagsVariableConfigDialog
        open={tagsDialogOpen}
        initialConfig={currentTagsConfig}
        tags={tags}
        groups={groups}
        onCancel={() => { setTagsDialogOpen(false); setReconfiguringId(null) }}
        onSave={(config) => {
          const instance: TemplateVariableInstance = { kind: 'tags', config }
          if (reconfiguringId !== null) {
            updateExistingChip(reconfiguringId, instance)
          } else {
            insertInstanceAtSavedRange(instance)
          }
          setTagsDialogOpen(false)
          setReconfiguringId(null)
        }}
      />

      <DateTimeFormatPickerDialog
        open={pendingDateTimeFlatId !== null}
        variableId={pendingDateTimeFlatId}
        initialFormatId={currentDateTimeFormatId}
        formats={dateTimeFormats}
        onCancel={() => { setPendingDateTimeFlatId(null); setReconfiguringId(null) }}
        onSave={(dateTimeFormatId) => {
          if (pendingDateTimeFlatId === null) return
          const instance: TemplateVariableInstance = { kind: 'flat', variableId: pendingDateTimeFlatId, dateTimeFormatId }
          if (reconfiguringId !== null) {
            updateExistingChip(reconfiguringId, instance)
          } else {
            insertInstanceAtSavedRange(instance)
          }
          setPendingDateTimeFlatId(null)
          setReconfiguringId(null)
        }}
      />

    </div>
  )
}

const TemplateEditor = ({
  initial,
  tags,
  groups,
  dateTimeFormats,
  onCancel,
  onSave,
}: {
  initial: TemplateFormState
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  dateTimeFormats: DateTimeFormatDefinition[]
  onCancel: () => void
  onSave: (form: TemplateFormState) => void
}) => {
  const [form, setForm] = useState<TemplateFormState>(initial)

  const dateTimeFormatsById = useMemo(() => new Map(dateTimeFormats.map((format) => [String(format.id), format])), [dateTimeFormats])
  const tagsById = useMemo(() => new Map(tags.filter((tag) => tag.id !== undefined).map((tag) => [tag.id as number, tag])), [tags])

  const repeatMode = useMemo(
    () => classifyTemplateRepeatMode({ patternText: form.patternText, variables: form.variables, groupingEnabled: form.groupingEnabled }),
    [form.patternText, form.variables, form.groupingEnabled],
  )

  const preview = useMemo(() => {
    // Real tag/group definitions (not real PATIENT data) so Tag Combo Grouping's selected tags,
    // and the preview patient's own Main/Referral service, actually resolve in the preview — see
    // buildSamplePreviewContext/buildSamplePreviewPatient's own comments.
    const previewPatient = buildSamplePreviewPatient(tagsById, groups)
    const ctx = buildSamplePreviewContext(dateTimeFormatsById, tagsById, groups, previewPatient)
    const headerText = form.headerPatternText ? renderTemplateForPatient({ patternText: form.headerPatternText, variables: form.headerVariables }, previewPatient, ctx) : ''
    // Grouping only ever has the one sample patient to work with here — same limitation every
    // other multi-entry preview in this editor already has (Block variables only show a couple of
    // sample rows too), just surfaced across a whole group instead of one field.
    const bodyText = form.groupingEnabled
      ? renderGroupedBody(form, [previewPatient], ctx)
      : renderTemplateForPatient({ patternText: form.patternText, variables: form.variables }, previewPatient, ctx)
    const footerText = form.footerPatternText ? renderTemplateForPatient({ patternText: form.footerPatternText, variables: form.footerVariables }, previewPatient, ctx) : ''
    return [headerText, bodyText, footerText].filter((part) => part.trim() !== '').join('\n')
  }, [form, dateTimeFormatsById, tagsById, groups])

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <Label htmlFor='template-name'>Template name</Label>
        <Input id='template-name' value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder='e.g. OB Rotation Format' />
      </div>

      <div className='space-y-1.5 rounded-lg border border-dashed border-clay/20 bg-warm-ivory/40 p-2.5'>
        <Label className='text-[11px] uppercase tracking-wide text-clay/70'>Header <span className='font-normal normal-case text-clay/70'>— prints once, at the very start</span></Label>
        <FormatPatternEditor
          initialPatternText={initial.headerPatternText}
          initialVariables={initial.headerVariables}
          tags={tags}
          groups={groups}
          dateTimeFormats={dateTimeFormats}
          variableScope='currentDateTimeOnly'
          onChange={(headerPatternText, headerVariables) => setForm((previous) => ({ ...previous, headerPatternText, headerVariables }))}
        />
      </div>

      <GroupingSegment
        form={form}
        tags={tags}
        groups={groups}
        dateTimeFormats={dateTimeFormats}
        onChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))}
      />

      <Card className='border-action-primary/25 shadow-sm'>
        <CardHeader className='py-3 px-4 pb-2'>
          <div className='flex items-center justify-between'>
            <CardTitle className='text-base'>Main Template</CardTitle>
            <span className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>
              {repeatMode === 'per-patient' ? 'Per-Patient' : 'Prints Once'}
            </span>
          </div>
        </CardHeader>
        <CardContent className='px-4 pb-4 space-y-1.5'>
          <FormatPatternEditor
            initialPatternText={form.patternText}
            initialVariables={form.variables}
            tags={tags}
            groups={groups}
            dateTimeFormats={dateTimeFormats}
            onChange={(patternText, variables) => setForm((previous) => ({ ...previous, patternText, variables }))}
          />
        </CardContent>
      </Card>

      {repeatMode === 'per-patient' ? (
        <JoinModePicker
          label='Between patients'
          mode={form.patientSeparator}
          custom={form.customPatientSeparator}
          onModeChange={(patientSeparator) => setForm((previous) => ({ ...previous, patientSeparator }))}
          onCustomChange={(customPatientSeparator) => setForm((previous) => ({ ...previous, customPatientSeparator }))}
        />
      ) : null}

      <div className='space-y-1.5 rounded-lg border border-dashed border-clay/20 bg-warm-ivory/40 p-2.5'>
        <Label className='text-[11px] uppercase tracking-wide text-clay/70'>Footer <span className='font-normal normal-case text-clay/70'>— prints once, at the very end</span></Label>
        <FormatPatternEditor
          initialPatternText={initial.footerPatternText}
          initialVariables={initial.footerVariables}
          tags={tags}
          groups={groups}
          dateTimeFormats={dateTimeFormats}
          variableScope='currentDateTimeOnly'
          onChange={(footerPatternText, footerVariables) => setForm((previous) => ({ ...previous, footerPatternText, footerVariables }))}
        />
      </div>

      <div className='space-y-1'>
        <Label>Live preview (sample patient)</Label>
        <pre className='whitespace-pre-wrap break-words rounded-lg border border-clay/20 bg-white/70 px-3 py-2 text-sm text-espresso font-sans'>
          {preview || '(nothing to preview yet)'}
        </pre>
      </div>

      <div className='flex justify-end gap-2 pt-2'>
        <Button type='button' variant='ghost' onClick={onCancel}>Cancel</Button>
        <Button type='button' disabled={!form.name.trim()} onClick={() => onSave(form)}>Save</Button>
      </div>
    </div>
  )
}

export const ManageTemplatesScreen = ({
  templates,
  tags,
  groups,
  dateTimeFormats,
  onManageDateTimeFormats,
  onBack,
}: {
  templates: ReportTemplate[]
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  dateTimeFormats: DateTimeFormatDefinition[]
  onManageDateTimeFormats: () => void
  onBack: () => void
}) => {
  const [editingTemplateId, setEditingTemplateId] = useState<number | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReportTemplate | null>(null)
  const ordered = useMemo(() => [...templates].sort((a, b) => a.sortOrder - b.sortOrder), [templates])

  const editingTemplate = editingTemplateId === 'new' || editingTemplateId === null
    ? null
    : (ordered.find((template) => template.id === editingTemplateId) ?? null)

  const saveTemplate = async (form: TemplateFormState) => {
    const name = form.name.trim()
    if (!name) return
    const fields = {
      name,
      patternText: form.patternText,
      variables: form.variables,
      patientSeparator: form.patientSeparator,
      customPatientSeparator: form.customPatientSeparator,
      headerPatternText: form.headerPatternText,
      headerVariables: form.headerVariables,
      footerPatternText: form.footerPatternText,
      footerVariables: form.footerVariables,
      groupingEnabled: form.groupingEnabled,
      groupSelectionMode: form.groupSelectionMode,
      groupTagIds: form.groupTagIds,
      groupCombineMode: form.groupCombineMode,
      groupTagLabelSeparator: form.groupTagLabelSeparator,
      groupManualCombos: form.groupManualCombos,
      groupLookbackHours: form.groupLookbackHours,
      groupListOpenText: form.groupListOpenText,
      groupListCloseText: form.groupListCloseText,
      groupShowListBracketsWhenEmpty: form.groupShowListBracketsWhenEmpty,
      groupPatternText: form.groupPatternText,
      groupVariables: form.groupVariables,
      groupSeparator: form.groupSeparator,
      customGroupSeparator: form.customGroupSeparator,
    }
    if (editingTemplateId !== 'new' && editingTemplateId !== null) {
      await db.reportTemplates.update(editingTemplateId, fields)
    } else {
      const nextSortOrder = templates.length > 0 ? Math.max(...templates.map((template) => template.sortOrder)) + 1 : 0
      await db.reportTemplates.add({ ...fields, sortOrder: nextSortOrder, createdAt: new Date().toISOString() })
    }
    setEditingTemplateId(null)
  }

  const duplicateTemplate = async (template: ReportTemplate) => {
    const nextSortOrder = templates.length > 0 ? Math.max(...templates.map((t) => t.sortOrder)) + 1 : 0
    // Regenerate every variable id (and rewrite the pattern's tokens to match) so the duplicate's
    // chips are fully independent of the original's — editing one can never affect the other.
    // Applied separately to the main pattern and the Header/Footer, which each have their own
    // independent id namespace.
    const remap = (patternText: string, variables: Record<string, TemplateVariableInstance>) => {
      const idMap = new Map<string, string>()
      const nextVariables: Record<string, TemplateVariableInstance> = {}
      Object.entries(variables).forEach(([oldId, instance]) => {
        const newId = createVariableId()
        idMap.set(oldId, newId)
        nextVariables[newId] = instance
      })
      const nextPatternText = tokenizePatternText(patternText)
        .map((part) => {
          if (part.type === 'text') return part.text
          if (part.type === 'lineBreak') return '\n'
          const newId = idMap.get(part.id)
          return newId ? buildVariableToken(newId) : ''
        })
        .join('')
      return { patternText: nextPatternText, variables: nextVariables }
    }

    const remapGroup = (patternText: string, variables: Record<string, GroupVariableInstance>) => {
      const idMap = new Map<string, string>()
      const nextVariables: Record<string, GroupVariableInstance> = {}
      Object.entries(variables).forEach(([oldId, instance]) => {
        const newId = createVariableId()
        idMap.set(oldId, newId)
        nextVariables[newId] = instance
      })
      const nextPatternText = tokenizePatternText(patternText)
        .map((part) => {
          if (part.type === 'text') return part.text
          if (part.type === 'lineBreak') return '\n'
          const newId = idMap.get(part.id)
          return newId ? buildVariableToken(newId) : ''
        })
        .join('')
      return { patternText: nextPatternText, variables: nextVariables }
    }

    const body = remap(template.patternText, template.variables)
    const header = remap(template.headerPatternText, template.headerVariables)
    const footer = remap(template.footerPatternText, template.footerVariables)
    const group = remapGroup(template.groupPatternText, template.groupVariables)

    // Deliberately omits `locked` — a duplicate of the built-in Labs template is a normal,
    // fully-editable template like any other.
    const newId = await db.reportTemplates.add({
      name: `${template.name} (Copy)`,
      patternText: body.patternText,
      variables: body.variables,
      patientSeparator: template.patientSeparator,
      customPatientSeparator: template.customPatientSeparator,
      headerPatternText: header.patternText,
      headerVariables: header.variables,
      footerPatternText: footer.patternText,
      footerVariables: footer.variables,
      groupingEnabled: template.groupingEnabled,
      groupSelectionMode: template.groupSelectionMode,
      groupTagIds: [...template.groupTagIds],
      groupCombineMode: template.groupCombineMode,
      groupTagLabelSeparator: template.groupTagLabelSeparator,
      groupManualCombos: template.groupManualCombos.map((combo) => ({ ...combo, id: createTagComboGroupId() })),
      groupLookbackHours: template.groupLookbackHours,
      groupListOpenText: template.groupListOpenText,
      groupListCloseText: template.groupListCloseText,
      groupShowListBracketsWhenEmpty: template.groupShowListBracketsWhenEmpty,
      groupPatternText: group.patternText,
      groupVariables: group.variables,
      groupSeparator: template.groupSeparator,
      customGroupSeparator: template.customGroupSeparator,
      sortOrder: nextSortOrder,
      createdAt: new Date().toISOString(),
    })
    setEditingTemplateId(newId as number)
  }

  const confirmDelete = async () => {
    if (deleteTarget?.id === undefined) return
    await db.reportTemplates.delete(deleteTarget.id)
    setDeleteTarget(null)
  }

  const reorderTemplates = async (sourceId: number, targetId: number, position: DropPosition) => {
    const reordered = moveItemByKey(ordered, (template) => template.id, sourceId, targetId, position)
    await Promise.all(
      reordered.map((template, index) =>
        template.id === undefined || template.sortOrder === index ? Promise.resolve() : db.reportTemplates.update(template.id, { sortOrder: index }),
      ),
    )
  }
  const templateDrag = useDragReorder(ordered.map((template) => template.id as number), (source, target, position) => void reorderTemplates(source, target, position))

  return (
    <Card className='bg-white/80 border-clay/25 shadow-sm'>
      <CardHeader className='py-3 px-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 w-7 p-0'
            aria-label={editingTemplateId !== null ? 'Back to templates list' : 'Back to Settings'}
            onClick={() => (editingTemplateId !== null ? setEditingTemplateId(null) : onBack())}
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <CardTitle className='text-base text-espresso'>
            {editingTemplateId === null ? 'Manage Templates' : editingTemplateId === 'new' ? 'New template' : `Edit "${editingTemplate?.name ?? ''}"`}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className='px-4 pb-4 space-y-4'>
        {editingTemplateId === null ? (
          <>
            <div className='flex items-center justify-between gap-2 flex-wrap'>
              <p className='text-xs text-clay max-w-[55%]'>
                Templates control which fields appear in a report and in what arrangement — replacing the old fixed export formats.
              </p>
              <div className='flex gap-2 flex-wrap justify-end'>
                <Button size='sm' variant='outline' onClick={onManageDateTimeFormats}>Date & Time Formats</Button>
                <Button size='sm' onClick={() => setEditingTemplateId('new')}>
                  <Plus className='h-3.5 w-3.5' aria-hidden='true' /> New template
                </Button>
              </div>
            </div>
            {ordered.length === 0 ? (
              <p className='text-sm text-clay'>No templates yet.</p>
            ) : (
              <div className='space-y-2'>
                {ordered.map((template) => (
                  <div
                    key={template.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-clay/25 bg-white/70 px-3 py-2 transition-shadow',
                      templateDrag.isDragging(template.id as number) && 'opacity-50',
                      dropIndicatorClassName(templateDrag.dropIndicator(template.id as number)),
                    )}
                    {...templateDrag.getItemProps(template.id as number)}
                  >
                    <DragHandle label={`Drag to reorder ${template.name}`} dragProps={templateDrag.getHandleProps(template.id as number)} />
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-semibold text-espresso truncate flex items-center gap-1.5'>
                        {template.name}
                        {template.locked ? <Lock className='h-3 w-3 text-clay/60' aria-label='Built-in, cannot be edited or deleted' /> : null}
                      </p>
                      <p className='text-xs text-clay'>{classifyTemplateRepeatMode(template) === 'per-patient' ? 'Per-Patient' : 'Prints Once'}</p>
                    </div>
                    {!template.locked ? (
                      <Button size='sm' variant='outline' className='h-7 text-xs' aria-label={`Edit ${template.name}`} onClick={() => setEditingTemplateId(template.id as number)}>
                        <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
                      </Button>
                    ) : null}
                    <Button size='sm' variant='outline' className='h-7 text-xs' aria-label={`Duplicate ${template.name}`} onClick={() => void duplicateTemplate(template)}>
                      <Copy className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
                    {!template.locked ? (
                      <Button size='sm' variant='destructive' className='h-7 text-xs' aria-label={`Delete ${template.name}`} onClick={() => setDeleteTarget(template)}>
                        <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <TemplateEditor
            key={editingTemplateId}
            initial={editingTemplate ? templateToForm(editingTemplate) : blankForm()}
            tags={tags}
            groups={groups}
            dateTimeFormats={dateTimeFormats}
            onCancel={() => setEditingTemplateId(null)}
            onSave={(form) => void saveTemplate(form)}
          />
        )}
      </CardContent>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>This cannot be undone.</p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='ghost' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => void confirmDelete()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
