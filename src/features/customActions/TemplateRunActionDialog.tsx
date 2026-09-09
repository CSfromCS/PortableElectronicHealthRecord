import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatFullName, joinNonBlank } from '@/lib/patientIdentity'
import { classifyTemplateRepeatMode } from '@/features/templates/templateEngine'
import type { CustomAction, Patient, ReportTemplate } from '@/types'

export const TemplateRunActionDialog = ({
  open,
  onOpenChange,
  action,
  template,
  patients,
  onGenerate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: CustomAction | null
  template: ReportTemplate | null
  patients: Patient[]
  onGenerate: (selectedPatients: Patient[]) => void
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Every matching patient starts selected — it's impossible to know at setup time which ones
  // should be excluded, so the default is "all", adjustable each time this runs.
  useEffect(() => {
    if (!open) return
    setSelectedIds(new Set(patients.map((patient) => patient.id).filter((id): id is number => id !== undefined)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed selection when the dialog opens for a (possibly new) action, not on every patients/action re-render
  }, [open, action?.id])

  const toggle = (patientId: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(patientId)) next.delete(patientId)
      else next.add(patientId)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(patients.map((patient) => patient.id).filter((id): id is number => id !== undefined)))
  const deselectAll = () => setSelectedIds(new Set())

  const selectedPatients = patients.filter((patient) => patient.id !== undefined && selectedIds.has(patient.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{action?.name ?? 'Run template'}</DialogTitle>
        </DialogHeader>
        {!template ? (
          <p className='text-sm text-action-danger'>This action's template no longer exists — edit it in Manage Custom Actions to pick a new one.</p>
        ) : (
          <>
            <p className='text-xs text-clay -mt-2'>
              Runs "{template.name}" and copies the result to the clipboard. Every patient matching this action's saved filter is included by default — deselect any that don't belong this time.
            </p>
            <div className='flex items-center justify-between gap-2'>
              <p className='text-xs text-clay'>{selectedPatients.length} of {patients.length} selected</p>
              <div className='flex gap-1.5'>
                <Button type='button' size='sm' variant='outline' className='h-7 text-xs' onClick={selectAll}>Select all</Button>
                <Button type='button' size='sm' variant='outline' className='h-7 text-xs' onClick={deselectAll}>Deselect all</Button>
              </div>
            </div>
            <ScrollArea className='max-h-[40vh] pr-3'>
              {patients.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {patients.map((patient) => {
                    if (patient.id === undefined) return null
                    const patientId = patient.id
                    const isSelected = selectedIds.has(patientId)
                    return (
                      <Button
                        key={patientId}
                        type='button'
                        size='sm'
                        variant={isSelected ? 'default' : 'secondary'}
                        onClick={() => toggle(patientId)}
                      >
                        {joinNonBlank([patient.roomNumber, formatFullName(patient)], ' — ')}
                      </Button>
                    )
                  })}
                </div>
              ) : (
                <p className='text-sm text-clay'>No patients currently match this action's filter.</p>
              )}
            </ScrollArea>
          </>
        )}
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type='button'
            disabled={!template || (classifyTemplateRepeatMode(template) === 'per-patient' && selectedPatients.length === 0)}
            onClick={() => template && onGenerate(selectedPatients)}
          >
            Generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
