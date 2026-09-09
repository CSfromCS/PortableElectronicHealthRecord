import { useMemo, useState } from 'react'
import { ChevronLeft, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import { cn } from '@/lib/utils'
import type { DateTimeComponentId, DateTimeFormatDefinition } from '@/types'
import { ChipTextEditor, type ChipCatalogEntry } from './ChipTextEditor'
import { DATE_TIME_COMPONENT_LABELS, DATE_TIME_COMPONENT_ORDER, renderDateTimeFormat } from './templateEngine'

const COMPONENT_CATALOG: ChipCatalogEntry[] = DATE_TIME_COMPONENT_ORDER.map((id) => ({ id, label: DATE_TIME_COMPONENT_LABELS[id] }))

type FormatFormState = {
  name: string
  patternText: string
  componentIds: Record<string, DateTimeComponentId>
}

const formatToForm = (format: DateTimeFormatDefinition): FormatFormState => ({
  name: format.name,
  patternText: format.patternText,
  componentIds: { ...format.componentIds },
})

const blankForm = (): FormatFormState => ({ name: '', patternText: '', componentIds: {} })

const FormatEditor = ({
  initial,
  onCancel,
  onSave,
}: {
  initial: FormatFormState
  onCancel: () => void
  onSave: (form: FormatFormState) => void
}) => {
  const [form, setForm] = useState<FormatFormState>(initial)

  const preview = useMemo(
    () => renderDateTimeFormat({ name: form.name, patternText: form.patternText, componentIds: form.componentIds, sortOrder: 0, createdAt: '' }, new Date()),
    [form.name, form.patternText, form.componentIds],
  )

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <Label htmlFor='format-name'>Format name</Label>
        <Input id='format-name' value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder='e.g. MMM D, YYYY' />
      </div>

      <div className='space-y-1.5'>
        <Label>Pattern</Label>
        <ChipTextEditor
          key={JSON.stringify(initial)}
          initialPatternText={form.patternText}
          initialFieldIds={form.componentIds}
          catalog={COMPONENT_CATALOG}
          addButtonLabel='Add Component'
          pickerTitle='Add date/time component'
          onChange={(patternText, fieldIds) => setForm((previous) => ({ ...previous, patternText, componentIds: fieldIds as Record<string, DateTimeComponentId> }))}
        />
      </div>

      <div className='space-y-1'>
        <Label>Live preview</Label>
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

export const ManageDateTimeFormatsScreen = ({
  formats,
  onBack,
}: {
  formats: DateTimeFormatDefinition[]
  onBack: () => void
}) => {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DateTimeFormatDefinition | null>(null)
  const ordered = useMemo(() => [...formats].sort((a, b) => a.sortOrder - b.sortOrder), [formats])

  const editingFormat = editingId === 'new' || editingId === null
    ? null
    : (ordered.find((format) => format.id === editingId) ?? null)

  const saveFormat = async (form: FormatFormState) => {
    const name = form.name.trim()
    if (!name) return
    if (editingId !== 'new' && editingId !== null) {
      await db.dateTimeFormats.update(editingId, { name, patternText: form.patternText, componentIds: form.componentIds })
    } else {
      const nextSortOrder = formats.length > 0 ? Math.max(...formats.map((format) => format.sortOrder)) + 1 : 0
      await db.dateTimeFormats.add({ name, patternText: form.patternText, componentIds: form.componentIds, sortOrder: nextSortOrder, createdAt: new Date().toISOString() })
    }
    setEditingId(null)
  }

  const duplicateFormat = async (format: DateTimeFormatDefinition) => {
    const nextSortOrder = formats.length > 0 ? Math.max(...formats.map((f) => f.sortOrder)) + 1 : 0
    const newId = await db.dateTimeFormats.add({
      name: `${format.name} (Copy)`,
      patternText: format.patternText,
      componentIds: { ...format.componentIds },
      sortOrder: nextSortOrder,
      createdAt: new Date().toISOString(),
    })
    setEditingId(newId as number)
  }

  const confirmDelete = async () => {
    if (deleteTarget?.id === undefined) return
    await db.dateTimeFormats.delete(deleteTarget.id)
    setDeleteTarget(null)
  }

  const reorderFormats = async (sourceId: number, targetId: number) => {
    const reordered = moveItemByKey(ordered, (format) => format.id, sourceId, targetId)
    await Promise.all(
      reordered.map((format, index) =>
        format.id === undefined || format.sortOrder === index ? Promise.resolve() : db.dateTimeFormats.update(format.id, { sortOrder: index }),
      ),
    )
  }
  const formatDrag = useDragReorder(ordered.map((format) => format.id as number), (source, target) => void reorderFormats(source, target))

  return (
    <Card className='bg-white/80 border-clay/25 shadow-sm'>
      <CardHeader className='py-3 px-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 w-7 p-0'
            aria-label={editingId !== null ? 'Back to formats list' : 'Back to Manage Templates'}
            onClick={() => (editingId !== null ? setEditingId(null) : onBack())}
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <CardTitle className='text-base text-espresso'>
            {editingId === null ? 'Date & Time Formats' : editingId === 'new' ? 'New format' : `Edit "${editingFormat?.name ?? ''}"`}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className='px-4 pb-4 space-y-4'>
        {editingId === null ? (
          <>
            <div className='flex items-center justify-between'>
              <p className='text-xs text-clay max-w-[70%]'>
                Saved formats appear as options wherever a date/time variable is configured in a template.
              </p>
              <Button size='sm' onClick={() => setEditingId('new')}>
                <Plus className='h-3.5 w-3.5' aria-hidden='true' /> New format
              </Button>
            </div>
            {ordered.length === 0 ? (
              <p className='text-sm text-clay'>No saved formats yet.</p>
            ) : (
              <div className='space-y-2'>
                {ordered.map((format) => (
                  <div
                    key={format.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-clay/25 bg-white/70 px-3 py-2 transition-shadow',
                      formatDrag.isDragging(format.id as number) && 'opacity-50',
                      formatDrag.isDropTarget(format.id as number) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
                    )}
                    {...formatDrag.getItemProps(format.id as number)}
                  >
                    <DragHandle label={`Drag to reorder ${format.name}`} dragProps={formatDrag.getHandleProps(format.id as number)} />
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-semibold text-espresso truncate'>{format.name}</p>
                      <p className='text-xs text-clay truncate'>{renderDateTimeFormat(format, new Date())}</p>
                    </div>
                    <Button size='sm' variant='outline' className='h-7 text-xs' aria-label={`Edit ${format.name}`} onClick={() => setEditingId(format.id as number)}>
                      <Pencil className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
                    <Button size='sm' variant='outline' className='h-7 text-xs' aria-label={`Duplicate ${format.name}`} onClick={() => void duplicateFormat(format)}>
                      <Copy className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
                    <Button size='sm' variant='destructive' className='h-7 text-xs' aria-label={`Delete ${format.name}`} onClick={() => setDeleteTarget(format)}>
                      <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <FormatEditor
            key={editingId}
            initial={editingFormat ? formatToForm(editingFormat) : blankForm()}
            onCancel={() => setEditingId(null)}
            onSave={(form) => void saveFormat(form)}
          />
        )}
      </CardContent>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>Any template variable currently using this format will fall back to its built-in default.</p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='ghost' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => void confirmDelete()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
