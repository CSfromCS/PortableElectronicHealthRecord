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
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import { cn } from '@/lib/utils'
import type {
  BlockJoinMode,
  BlockVariableConfig,
  BlockVariableId,
  BlockVariableRangeMode,
  DateTimeFormatDefinition,
  FlatVariableId,
  RelativeDateRangeMode,
  ReportTemplate,
  TagDefinition,
  TagGroupDefinition,
  TagsVariableConfig,
  TemplateVariableInstance,
} from '@/types'
import { bucketTagsByGroup } from '@/features/tags/tagUtils'
import { ChipTextEditor, type ChipCatalogEntry } from './ChipTextEditor'
import {
  BLOCK_JOIN_MODE_LABELS,
  BLOCK_VARIABLE_LABELS,
  DATE_TIME_CAPABLE_FLAT_VARIABLE_IDS,
  DEFAULT_TAGS_VARIABLE_CONFIG,
  ENTRY_FIELD_LABELS_BY_BLOCK,
  ENTRY_FIELD_ORDER_BY_BLOCK,
  FLAT_VARIABLE_LABELS,
  buildDefaultBlockVariableConfig,
  buildVariableToken,
  classifyTemplateRepeatMode,
  createVariableId,
  describeBlockConfig,
  describeVariableInstance,
  renderTemplateForPatient,
  tokenizePatternText,
} from './templateEngine'
import { SAMPLE_PREVIEW_PATIENT, buildSamplePreviewContext } from './samplePreviewData'

const BLOCK_VARIABLE_ORDER: BlockVariableId[] = ['vitals', 'labs', 'problems', 'checklist', 'orders']

type PickerTab = {
  id: string
  label: string
  flatIds?: FlatVariableId[]
}

/** Grouped so it's obvious at a glance which category of information a variable pulls from,
 * rather than one long undifferentiated list. */
const PICKER_TABS: PickerTab[] = [
  { id: 'identity', label: 'Identity', flatIds: ['roomNumber', 'ward', 'lastName', 'firstName', 'middleName', 'age', 'sex'] },
  { id: 'clinical', label: 'Clinical', flatIds: ['mainService', 'admissionDiagnosis', 'dischargeDiagnosis', 'clinicalSummary', 'medications', 'database'] },
  { id: 'dates', label: 'Dates', flatIds: ['admitDate', 'referralDate', 'dischargeDate', 'currentDate', 'currentTime'] },
  { id: 'tags', label: 'Tags' },
  { id: 'records', label: 'Records' },
]

type TemplateFormState = {
  name: string
  patternText: string
  variables: Record<string, TemplateVariableInstance>
}

const templateToForm = (template: ReportTemplate): TemplateFormState => ({
  name: template.name,
  patternText: template.patternText,
  variables: { ...template.variables },
})

const blankForm = (): TemplateFormState => ({ name: '', patternText: '', variables: {} })

const JOIN_MODE_ORDER: BlockJoinMode[] = ['lineBreak', 'blankLine', 'space', 'custom']

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
      <Input value={custom} onChange={(event) => onCustomChange(event.target.value)} placeholder='e.g. ; ' />
    ) : null}
  </div>
)

const NO_FORMAT_VALUE = '__default__'

/** Lets the user pick a saved Date & Time Format for one date/time-typed chip — or leave it on
 * "Default" to keep that field's own built-in formatting. Kept as its own small dialog rather than
 * folded into the flat-variable insertion flow, so choosing a format is optional and never blocks
 * inserting a date variable in the first place. */
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

/** A Block variable's Latest/Date Range/Number of Entries setting, prompted right when the
 * variable is placed and saved as part of that specific placeholder (point 2 of issue #82) — plus,
 * for record types other than Labs (whose formatting is algorithmic, not field-composable), how
 * each entry (and, for Problems/Checklist, each date-group) is formatted. */
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

  useEffect(() => {
    if (open) setConfig(initialConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the draft only when the dialog (re)opens, not on every initialConfig identity change
  }, [open])

  if (!open || variableId === null) return null

  const entryCatalog: ChipCatalogEntry[] = (ENTRY_FIELD_ORDER_BY_BLOCK[variableId] ?? [])
    .map((fieldId) => ({ id: fieldId, label: ENTRY_FIELD_LABELS_BY_BLOCK[variableId][fieldId] }))
  const supportsEntryPattern = variableId !== 'labs'
  const isGrouped = variableId === 'problems' || variableId === 'checklist'

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className='max-w-md' onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{BLOCK_VARIABLE_LABELS[variableId]} settings</DialogTitle>
        </DialogHeader>
        <ScrollArea className='max-h-[65vh] pr-3'>
          <div className='space-y-4'>
            <div className='space-y-3'>
              <div className='flex gap-1 rounded-lg border border-clay/20 bg-warm-ivory p-1'>
                {(['latest', 'numberOfEntries', 'dateRange'] as BlockVariableRangeMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type='button'
                    size='sm'
                    variant={config.rangeMode === mode ? 'default' : 'ghost'}
                    className='flex-1 text-xs'
                    onClick={() => setConfig((previous) => ({ ...previous, rangeMode: mode }))}
                  >
                    {mode === 'latest' ? 'Most Recent' : mode === 'numberOfEntries' ? 'Number of Entries' : 'Date Range'}
                  </Button>
                ))}
              </div>

              {config.rangeMode === 'latest' ? (
                <p className='text-xs text-clay'>
                  {isGrouped
                    ? `Shows only the ${BLOCK_VARIABLE_LABELS[variableId]} entries from the single most recent day they were last saved — not the full history.`
                    : `Shows only the single most recent ${BLOCK_VARIABLE_LABELS[variableId]} entry on file, by date and time — not the full history.`}
                </p>
              ) : null}

              {config.rangeMode === 'numberOfEntries' ? (
                <div className='space-y-1'>
                  <Label className='text-xs'>Number of most recent entries</Label>
                  <Input
                    type='number'
                    min={1}
                    value={config.entryCount}
                    onChange={(event) => setConfig((previous) => ({ ...previous, entryCount: Math.max(1, Number.parseInt(event.target.value, 10) || 1) }))}
                  />
                  <p className='text-xs text-clay'>Setting this to 2 for Labs keeps the existing side-by-side comparison formatting.</p>
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
                    <div className='grid grid-cols-2 gap-2'>
                      <div className='space-y-1'>
                        <Label className='text-xs'>From date</Label>
                        <Input
                          type='date'
                          value={config.fixedDateFrom}
                          onChange={(event) => setConfig((previous) => ({ ...previous, fixedDateFrom: event.target.value }))}
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-xs'>Until date</Label>
                        <Input
                          type='date'
                          value={config.fixedDateTo}
                          onChange={(event) => setConfig((previous) => ({ ...previous, fixedDateTo: event.target.value }))}
                        />
                      </div>
                    </div>
                  ) : null}
                  <p className='text-xs text-clay'>A fixed date range only produces useful output on dates within it — prefer a relative option for a template you'll reuse.</p>
                </div>
              ) : null}
            </div>

            {supportsEntryPattern ? (
              <>
                <div className='border-t border-clay/15 pt-3 space-y-1.5'>
                  <Label className='text-xs'>How each entry renders</Label>
                  <ChipTextEditor
                    key={variableId}
                    initialPatternText={config.entryPatternText}
                    initialFieldIds={config.entryFieldIds}
                    catalog={entryCatalog}
                    addButtonLabel='Add Field'
                    pickerTitle={`Add ${BLOCK_VARIABLE_LABELS[variableId]} field`}
                    onChange={(entryPatternText, entryFieldIds) => setConfig((previous) => ({ ...previous, entryPatternText, entryFieldIds }))}
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

                <JoinModePicker
                  label={isGrouped ? 'Between entries in the same day' : 'Between entries'}
                  mode={config.entrySeparator}
                  custom={config.customEntrySeparator}
                  onModeChange={(entrySeparator) => setConfig((previous) => ({ ...previous, entrySeparator }))}
                  onCustomChange={(customEntrySeparator) => setConfig((previous) => ({ ...previous, customEntrySeparator }))}
                />

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
              <p className='text-xs text-clay border-t border-clay/15 pt-3'>
                Labs' comparison-mode formatting is generated automatically and isn't user-composable — use the built-in "Labs" template if you want the exact current formatting.
              </p>
            )}
          </div>
        </ScrollArea>
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={onCancel}>Cancel</Button>
          <Button type='button' onClick={() => onSave(config)}>{describeBlockConfig(config) ? 'Save' : 'Insert'}</Button>
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

const VariablePickerDialog = ({
  open,
  onClose,
  onPickFlat,
  onPickTags,
  onPickBlock,
}: {
  open: boolean
  onClose: () => void
  onPickFlat: (variableId: FlatVariableId) => void
  onPickTags: () => void
  onPickBlock: (variableId: BlockVariableId) => void
}) => (
  <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent className='max-w-md' onCloseAutoFocus={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Add variable</DialogTitle>
      </DialogHeader>
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
}: {
  initialPatternText: string
  initialVariables: Record<string, TemplateVariableInstance>
  onChange: (patternText: string, variables: Record<string, TemplateVariableInstance>) => void
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  dateTimeFormats: DateTimeFormatDefinition[]
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
        if (instance) container.appendChild(buildChipElement(part.id, instance))
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
          patternText += node.textContent ?? ''
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

  /** Whether the caret sits immediately before/after a chip — browsers are inconsistent about
   * deleting an atomic contentEditable=false node with a single Backspace/Delete press, so this
   * is checked explicitly rather than relying on native contentEditable delete behavior. */
  const getAdjacentChip = (direction: 'before' | 'after'): HTMLElement | null => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
    const { startContainer, startOffset } = selection.getRangeAt(0)
    if (!container.contains(startContainer)) return null

    if (startContainer.nodeType === Node.TEXT_NODE) {
      const sibling = direction === 'before'
        ? (startOffset === 0 ? startContainer.previousSibling : null)
        : (startOffset === (startContainer.textContent?.length ?? 0) ? startContainer.nextSibling : null)
      return sibling instanceof HTMLElement && sibling.dataset.variableId ? sibling : null
    }
    const node = direction === 'before'
      ? startContainer.childNodes[startOffset - 1]
      : startContainer.childNodes[startOffset]
    return node instanceof HTMLElement && node.dataset.variableId ? node : null
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      document.execCommand('insertLineBreak')
      emitChange()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const chip = getAdjacentChip(event.key === 'Backspace' ? 'before' : 'after')
      if (chip) {
        event.preventDefault()
        chip.remove()
        emitChange()
      }
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    emitChange()
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

    const spacer = document.createTextNode('')
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

  return (
    <div className='space-y-1.5'>
      <div
        ref={containerRef}
        role='textbox'
        aria-multiline='true'
        aria-label='Format Pattern'
        contentEditable
        suppressContentEditableWarning
        className='min-h-24 whitespace-pre-wrap break-words rounded-lg border border-clay/25 bg-white px-3 py-2 text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={handleContainerClick}
      />
      <div className='flex flex-wrap gap-2'>
        <Button type='button' size='sm' variant='outline' onClick={() => setPickerOpen(true)}>
          <Plus className='h-3.5 w-3.5' aria-hidden='true' /> Add Variable
        </Button>
      </div>
      <p className='text-xs text-clay'>Type directly, press Enter for a new line, and click "Add Variable" to drop one in at your cursor. Click an inserted Vitals/Labs/Problems/Checklist/Orders/Tags block — or a date/time variable — to change its settings.</p>

      <VariablePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPickFlat={(variableId) => {
          setPickerOpen(false)
          insertInstanceAtSavedRange({ kind: 'flat', variableId })
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
          if (pendingDateTimeFlatId === null || reconfiguringId === null) return
          updateExistingChip(reconfiguringId, { kind: 'flat', variableId: pendingDateTimeFlatId, dateTimeFormatId })
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

  const preview = useMemo(() => {
    const draftTemplate: ReportTemplate = { name: form.name, patternText: form.patternText, variables: form.variables, sortOrder: 0, createdAt: '' }
    return renderTemplateForPatient(draftTemplate, SAMPLE_PREVIEW_PATIENT, buildSamplePreviewContext(dateTimeFormatsById))
  }, [form.name, form.patternText, form.variables, dateTimeFormatsById])

  const repeatMode = useMemo(
    () => classifyTemplateRepeatMode({ name: form.name, patternText: form.patternText, variables: form.variables, sortOrder: 0, createdAt: '' }),
    [form.name, form.patternText, form.variables],
  )

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <Label htmlFor='template-name'>Template name</Label>
        <Input id='template-name' value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder='e.g. OB Rotation Format' />
      </div>

      <div className='space-y-1.5'>
        <div className='flex items-center justify-between'>
          <Label>Format Pattern</Label>
          <span className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>
            {repeatMode === 'per-patient' ? 'Per-Patient' : 'Prints Once'}
          </span>
        </div>
        <FormatPatternEditor
          initialPatternText={form.patternText}
          initialVariables={form.variables}
          tags={tags}
          groups={groups}
          dateTimeFormats={dateTimeFormats}
          onChange={(patternText, variables) => setForm((previous) => ({ ...previous, patternText, variables }))}
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
    if (editingTemplateId !== 'new' && editingTemplateId !== null) {
      await db.reportTemplates.update(editingTemplateId, { name, patternText: form.patternText, variables: form.variables })
    } else {
      const nextSortOrder = templates.length > 0 ? Math.max(...templates.map((template) => template.sortOrder)) + 1 : 0
      await db.reportTemplates.add({ name, patternText: form.patternText, variables: form.variables, sortOrder: nextSortOrder, createdAt: new Date().toISOString() })
    }
    setEditingTemplateId(null)
  }

  const duplicateTemplate = async (template: ReportTemplate) => {
    const nextSortOrder = templates.length > 0 ? Math.max(...templates.map((t) => t.sortOrder)) + 1 : 0
    // Regenerate every variable id (and rewrite the pattern's tokens to match) so the duplicate's
    // chips are fully independent of the original's — editing one can never affect the other.
    const idMap = new Map<string, string>()
    const nextVariables: Record<string, TemplateVariableInstance> = {}
    Object.entries(template.variables).forEach(([oldId, instance]) => {
      const newId = createVariableId()
      idMap.set(oldId, newId)
      nextVariables[newId] = instance
    })
    const nextPatternText = tokenizePatternText(template.patternText)
      .map((part) => {
        if (part.type === 'text') return part.text
        if (part.type === 'lineBreak') return '\n'
        const newId = idMap.get(part.id)
        return newId ? buildVariableToken(newId) : ''
      })
      .join('')

    // Deliberately omits `locked` — a duplicate of the built-in Labs template is a normal,
    // fully-editable template like any other.
    const newId = await db.reportTemplates.add({
      name: `${template.name} (Copy)`,
      patternText: nextPatternText,
      variables: nextVariables,
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

  const reorderTemplates = async (sourceId: number, targetId: number) => {
    const reordered = moveItemByKey(ordered, (template) => template.id, sourceId, targetId)
    await Promise.all(
      reordered.map((template, index) =>
        template.id === undefined || template.sortOrder === index ? Promise.resolve() : db.reportTemplates.update(template.id, { sortOrder: index }),
      ),
    )
  }
  const templateDrag = useDragReorder(ordered.map((template) => template.id as number), (source, target) => void reorderTemplates(source, target))

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
            <div className='flex items-center justify-between gap-2'>
              <p className='text-xs text-clay max-w-[55%]'>
                Templates control which fields appear in a report and in what arrangement — replacing the old fixed export formats.
              </p>
              <div className='flex gap-2'>
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
                      templateDrag.isDropTarget(template.id as number) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
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
