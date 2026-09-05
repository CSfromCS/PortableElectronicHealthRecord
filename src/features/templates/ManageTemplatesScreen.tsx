import { useMemo, useState } from 'react'
import { ChevronLeft, Copy, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { cn } from '@/lib/utils'
import type {
  BlockVariableConfig,
  BlockVariableId,
  BlockVariableRangeMode,
  FlatVariableId,
  RelativeDateRangeMode,
  ReportTemplate,
  TagDefinition,
  TagGroupDefinition,
  TagsVariableConfig,
  TemplateSegment,
} from '@/types'
import { bucketTagsByGroup } from '@/features/tags/tagUtils'
import {
  BLOCK_VARIABLE_LABELS,
  DEFAULT_BLOCK_VARIABLE_CONFIG,
  DEFAULT_TAGS_VARIABLE_CONFIG,
  FLAT_VARIABLE_LABELS,
  classifyTemplateRepeatMode,
  createSegmentId,
  renderTemplateForPatient,
} from './templateEngine'
import { SAMPLE_PREVIEW_PATIENT, buildSamplePreviewContext } from './samplePreviewData'

const FLAT_VARIABLE_ORDER: FlatVariableId[] = [
  'roomNumber', 'ward', 'lastName', 'firstName', 'middleName', 'age', 'sex',
  'mainService', 'admissionDiagnosis', 'dischargeDiagnosis', 'clinicalSummary',
  'admitDate', 'referralDate', 'dischargeDate', 'medications', 'database',
  'currentDate', 'currentTime',
]

const BLOCK_VARIABLE_ORDER: BlockVariableId[] = ['vitals', 'labs', 'problems', 'checklist', 'orders']

type TemplateFormState = {
  name: string
  segments: TemplateSegment[]
}

const templateToForm = (template: ReportTemplate): TemplateFormState => ({
  name: template.name,
  segments: template.segments.map((segment) => ({ ...segment })),
})

const blankForm = (): TemplateFormState => ({ name: '', segments: [] })

const segmentSummary = (segment: TemplateSegment, tagsById: Map<number, TagDefinition>): string => {
  switch (segment.type) {
    case 'text': return segment.text || '(empty text)'
    case 'lineBreak': return '↵ Line break'
    case 'flatVariable': return FLAT_VARIABLE_LABELS[segment.variableId]
    case 'blockVariable': return BLOCK_VARIABLE_LABELS[segment.variableId]
    case 'tagsVariable': {
      if (segment.config.includeAll) return 'Tags (all)'
      const names = [
        ...segment.config.tagIds.map((id) => tagsById.get(id)?.name).filter((name): name is string => Boolean(name)),
      ]
      return names.length > 0 ? `Tags (${names.join(', ')})` : 'Tags (none selected)'
    }
    default: return ''
  }
}

const describeBlockConfig = (config: BlockVariableConfig): string => {
  if (config.rangeMode === 'latest') return 'Latest'
  if (config.rangeMode === 'numberOfEntries') return `Last ${config.entryCount} entries`
  if (config.relativeMode === 'sinceAdmission') return 'Since Admission Date'
  if (config.relativeMode === 'lastNDays') return `Last ${config.lastNDays} days`
  return `${config.fixedDateFrom || '…'} to ${config.fixedDateTo || '…'}`
}

/** A Block variable's Latest/Date Range/Number of Entries setting, prompted right when the
 * variable is placed and saved as part of that specific placeholder (point 2 of issue #82). */
const BlockVariableConfigDialog = ({
  open,
  variableId,
  initialConfig,
  onCancel,
  onSave,
}: {
  open: boolean
  variableId: BlockVariableId | null
  initialConfig: BlockVariableConfig
  onCancel: () => void
  onSave: (config: BlockVariableConfig) => void
}) => {
  const [config, setConfig] = useState<BlockVariableConfig>(initialConfig)

  if (!open || variableId === null) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{BLOCK_VARIABLE_LABELS[variableId]} settings</DialogTitle>
        </DialogHeader>
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
                {mode === 'latest' ? 'Latest' : mode === 'numberOfEntries' ? 'Number of Entries' : 'Date Range'}
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
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={onCancel}>Cancel</Button>
          <Button type='button' onClick={() => onSave(config)}>Insert</Button>
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
      <DialogContent className='max-w-md'>
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
          <Button type='button' onClick={() => onSave(config)}>Insert</Button>
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
    <DialogContent className='max-w-md'>
      <DialogHeader>
        <DialogTitle>Add variable</DialogTitle>
      </DialogHeader>
      <ScrollArea className='max-h-[60vh] pr-3'>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Flat</p>
            <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-2 py-1'>
              {FLAT_VARIABLE_ORDER.map((variableId) => (
                <button
                  key={variableId}
                  type='button'
                  className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                  onClick={() => onPickFlat(variableId)}
                >
                  {FLAT_VARIABLE_LABELS[variableId]}
                </button>
              ))}
              <button
                type='button'
                className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                onClick={onPickTags}
              >
                Tags
              </button>
            </div>
          </div>
          <div className='space-y-1.5'>
            <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Block (dated)</p>
            <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-2 py-1'>
              {BLOCK_VARIABLE_ORDER.map((variableId) => (
                <button
                  key={variableId}
                  type='button'
                  className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                  onClick={() => onPickBlock(variableId)}
                >
                  {BLOCK_VARIABLE_LABELS[variableId]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
      <div className='flex justify-end pt-2'>
        <Button type='button' variant='ghost' onClick={onClose}>Cancel</Button>
      </div>
    </DialogContent>
  </Dialog>
)

const TemplateEditor = ({
  initial,
  tags,
  groups,
  tagsById,
  onCancel,
  onSave,
}: {
  initial: TemplateFormState
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  tagsById: Map<number, TagDefinition>
  onCancel: () => void
  onSave: (form: TemplateFormState) => void
}) => {
  const [form, setForm] = useState<TemplateFormState>(initial)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingBlockVariable, setPendingBlockVariable] = useState<BlockVariableId | null>(null)
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false)

  const addSegment = (segment: TemplateSegment) => {
    setForm((previous) => ({ ...previous, segments: [...previous.segments, segment] }))
  }
  const removeSegment = (id: string) => {
    setForm((previous) => ({ ...previous, segments: previous.segments.filter((segment) => segment.id !== id) }))
  }
  const updateTextSegment = (id: string, text: string) => {
    setForm((previous) => ({
      ...previous,
      segments: previous.segments.map((segment) => (segment.id === id && segment.type === 'text' ? { ...segment, text } : segment)),
    }))
  }
  const reorderSegments = (sourceId: string, targetId: string) => {
    setForm((previous) => ({ ...previous, segments: moveItemByKey(previous.segments, (segment) => segment.id, sourceId, targetId) }))
  }
  const segmentDrag = useDragReorder(form.segments.map((segment) => segment.id), reorderSegments)

  const [editingBlockSegmentId, setEditingBlockSegmentId] = useState<string | null>(null)
  const [editingTagsSegmentId, setEditingTagsSegmentId] = useState<string | null>(null)

  const openBlockConfigFor = (segmentId: string, variableId: BlockVariableId) => {
    setEditingBlockSegmentId(segmentId)
    setPendingBlockVariable(variableId)
  }
  const openTagsConfigFor = (segmentId: string) => {
    setEditingTagsSegmentId(segmentId)
    setTagsDialogOpen(true)
  }

  const currentEditingBlockConfig = useMemo(() => {
    const segment = form.segments.find((s) => s.id === editingBlockSegmentId)
    return segment && segment.type === 'blockVariable' ? segment.config : DEFAULT_BLOCK_VARIABLE_CONFIG
  }, [form.segments, editingBlockSegmentId])

  const currentEditingTagsConfig = useMemo(() => {
    const segment = form.segments.find((s) => s.id === editingTagsSegmentId)
    return segment && segment.type === 'tagsVariable' ? segment.config : DEFAULT_TAGS_VARIABLE_CONFIG
  }, [form.segments, editingTagsSegmentId])

  const preview = useMemo(() => {
    const draftTemplate: ReportTemplate = { name: form.name, segments: form.segments, sortOrder: 0, createdAt: '' }
    return renderTemplateForPatient(draftTemplate, SAMPLE_PREVIEW_PATIENT, buildSamplePreviewContext())
  }, [form.name, form.segments])

  const repeatMode = useMemo(
    () => classifyTemplateRepeatMode({ name: form.name, segments: form.segments, sortOrder: 0, createdAt: '' }),
    [form.name, form.segments],
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
        <div className='space-y-1'>
          {form.segments.length === 0 ? (
            <p className='text-xs text-clay'>No segments yet — add literal text, a line break, or a variable below.</p>
          ) : null}
          {form.segments.map((segment) => (
            <div
              key={segment.id}
              className={cn(
                'flex items-center gap-2 rounded border border-clay/30 bg-warm-ivory px-2 py-1.5 transition-shadow',
                segmentDrag.isDragging(segment.id) && 'opacity-50',
                segmentDrag.isDropTarget(segment.id) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
              )}
              {...segmentDrag.getItemProps(segment.id)}
            >
              <DragHandle label={`Drag to reorder ${segmentSummary(segment, tagsById)}`} dragProps={segmentDrag.getHandleProps(segment.id)} />
              <div className='flex-1 min-w-0'>
                {segment.type === 'text' ? (
                  <AutoGrowTextField
                    value={segment.text}
                    onChange={(value) => updateTextSegment(segment.id, value)}
                    placeholder='Literal text…'
                  />
                ) : segment.type === 'blockVariable' ? (
                  <button
                    type='button'
                    className='w-full text-left text-sm text-espresso hover:underline'
                    onClick={() => openBlockConfigFor(segment.id, segment.variableId)}
                  >
                    {BLOCK_VARIABLE_LABELS[segment.variableId]} — <span className='text-clay'>{describeBlockConfig(segment.config)}</span>
                  </button>
                ) : segment.type === 'tagsVariable' ? (
                  <button
                    type='button'
                    className='w-full text-left text-sm text-espresso hover:underline'
                    onClick={() => openTagsConfigFor(segment.id)}
                  >
                    {segmentSummary(segment, tagsById)}
                  </button>
                ) : (
                  <p className='text-sm text-espresso'>{segmentSummary(segment, tagsById)}</p>
                )}
              </div>
              <Button type='button' variant='ghost' className='h-6 w-6 shrink-0 p-0 text-clay' aria-label='Remove segment' onClick={() => removeSegment(segment.id)}>
                <X className='h-3.5 w-3.5' aria-hidden='true' />
              </Button>
            </div>
          ))}
        </div>
        <div className='flex flex-wrap gap-2 pt-1'>
          <Button type='button' size='sm' variant='outline' onClick={() => addSegment({ id: createSegmentId(), type: 'text', text: '' })}>
            <Plus className='h-3.5 w-3.5' aria-hidden='true' /> Text
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={() => addSegment({ id: createSegmentId(), type: 'lineBreak' })}>
            <Plus className='h-3.5 w-3.5' aria-hidden='true' /> Line break
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={() => setPickerOpen(true)}>
            <Plus className='h-3.5 w-3.5' aria-hidden='true' /> Variable
          </Button>
        </div>
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

      <VariablePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPickFlat={(variableId) => {
          addSegment({ id: createSegmentId(), type: 'flatVariable', variableId })
          setPickerOpen(false)
        }}
        onPickTags={() => {
          setPickerOpen(false)
          setEditingTagsSegmentId(null)
          setTagsDialogOpen(true)
        }}
        onPickBlock={(variableId) => {
          setPickerOpen(false)
          setEditingBlockSegmentId(null)
          setPendingBlockVariable(variableId)
        }}
      />

      <BlockVariableConfigDialog
        open={pendingBlockVariable !== null}
        variableId={pendingBlockVariable}
        initialConfig={currentEditingBlockConfig}
        onCancel={() => { setPendingBlockVariable(null); setEditingBlockSegmentId(null) }}
        onSave={(config) => {
          if (pendingBlockVariable === null) return
          if (editingBlockSegmentId !== null) {
            setForm((previous) => ({
              ...previous,
              segments: previous.segments.map((segment) =>
                segment.id === editingBlockSegmentId && segment.type === 'blockVariable' ? { ...segment, config } : segment,
              ),
            }))
          } else {
            addSegment({ id: createSegmentId(), type: 'blockVariable', variableId: pendingBlockVariable, config })
          }
          setPendingBlockVariable(null)
          setEditingBlockSegmentId(null)
        }}
      />

      <TagsVariableConfigDialog
        open={tagsDialogOpen}
        initialConfig={currentEditingTagsConfig}
        tags={tags}
        groups={groups}
        onCancel={() => { setTagsDialogOpen(false); setEditingTagsSegmentId(null) }}
        onSave={(config) => {
          if (editingTagsSegmentId !== null) {
            setForm((previous) => ({
              ...previous,
              segments: previous.segments.map((segment) =>
                segment.id === editingTagsSegmentId && segment.type === 'tagsVariable' ? { ...segment, config } : segment,
              ),
            }))
          } else {
            addSegment({ id: createSegmentId(), type: 'tagsVariable', config })
          }
          setTagsDialogOpen(false)
          setEditingTagsSegmentId(null)
        }}
      />
    </div>
  )
}

export const ManageTemplatesScreen = ({
  templates,
  tags,
  groups,
  onBack,
}: {
  templates: ReportTemplate[]
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onBack: () => void
}) => {
  const [editingTemplateId, setEditingTemplateId] = useState<number | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReportTemplate | null>(null)
  const tagsById = useMemo(() => new Map(tags.filter((tag) => tag.id !== undefined).map((tag) => [tag.id as number, tag])), [tags])
  const ordered = useMemo(() => [...templates].sort((a, b) => a.sortOrder - b.sortOrder), [templates])

  const editingTemplate = editingTemplateId === 'new' || editingTemplateId === null
    ? null
    : (ordered.find((template) => template.id === editingTemplateId) ?? null)

  const saveTemplate = async (form: TemplateFormState) => {
    const name = form.name.trim()
    if (!name) return
    if (editingTemplateId !== 'new' && editingTemplateId !== null) {
      await db.reportTemplates.update(editingTemplateId, { name, segments: form.segments })
    } else {
      const nextSortOrder = templates.length > 0 ? Math.max(...templates.map((template) => template.sortOrder)) + 1 : 0
      await db.reportTemplates.add({ name, segments: form.segments, sortOrder: nextSortOrder, createdAt: new Date().toISOString() })
    }
    setEditingTemplateId(null)
  }

  const duplicateTemplate = async (template: ReportTemplate) => {
    const nextSortOrder = templates.length > 0 ? Math.max(...templates.map((t) => t.sortOrder)) + 1 : 0
    const newId = await db.reportTemplates.add({
      name: `${template.name} (Copy)`,
      segments: template.segments.map((segment) => ({ ...segment, id: createSegmentId() })),
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
            <div className='flex items-center justify-between'>
              <p className='text-xs text-clay max-w-[70%]'>
                Templates control which fields appear in a report and in what arrangement — replacing the old fixed export formats.
              </p>
              <Button size='sm' onClick={() => setEditingTemplateId('new')}>
                <Plus className='h-3.5 w-3.5' aria-hidden='true' /> New template
              </Button>
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
                      <p className='text-sm font-semibold text-espresso truncate'>{template.name}</p>
                      <p className='text-xs text-clay'>{classifyTemplateRepeatMode(template) === 'per-patient' ? 'Per-Patient' : 'Prints Once'}</p>
                    </div>
                    <Button size='sm' variant='outline' className='h-7 text-xs' aria-label={`Edit ${template.name}`} onClick={() => setEditingTemplateId(template.id as number)}>
                      <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
                    <Button size='sm' variant='outline' className='h-7 text-xs' aria-label={`Duplicate ${template.name}`} onClick={() => void duplicateTemplate(template)}>
                      <Copy className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
                    <Button size='sm' variant='destructive' className='h-7 text-xs' aria-label={`Delete ${template.name}`} onClick={() => setDeleteTarget(template)}>
                      <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
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
            tagsById={tagsById}
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
