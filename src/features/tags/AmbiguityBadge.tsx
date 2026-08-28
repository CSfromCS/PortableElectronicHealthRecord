import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AUTOMATION_ROLE_FAMILY_LABELS } from './tagConstants'
import type { TagAmbiguity } from './tagUtils'

export const AmbiguityBadge = ({ ambiguity }: { ambiguity: TagAmbiguity }) => {
  const [open, setOpen] = useState(false)
  const hasConflicts = ambiguity.terminalConflicts.length > 0 || ambiguity.automationRoleConflicts.size > 0
  if (!hasConflicts) return null

  return (
    <>
      <button
        type='button'
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        className='inline-flex items-center justify-center rounded-full p-0.5 text-amber-600 hover:text-amber-700'
        aria-label='Tag conflict — tap for details'
        title='Tag conflict — tap for details'
      >
        <AlertTriangle className='h-4 w-4' />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conflicting tags</DialogTitle>
          </DialogHeader>
          <div className='space-y-3 text-sm text-espresso'>
            {ambiguity.terminalConflicts.length > 0 ? (
              <div>
                <p className='font-semibold'>Multiple Terminal tags applied:</p>
                <p className='text-clay'>{ambiguity.terminalConflicts.map((tag) => tag.name).join(', ')}</p>
                <p className='text-xs text-clay mt-1'>The patient is excluded from active views regardless — this only flags which terminal state applies.</p>
              </div>
            ) : null}
            {Array.from(ambiguity.automationRoleConflicts.entries()).map(([family, tags]) => (
              <div key={family}>
                <p className='font-semibold'>Multiple {AUTOMATION_ROLE_FAMILY_LABELS[family]} tags applied:</p>
                <p className='text-clay'>{tags.map((tag) => tag.name).join(', ')}</p>
              </div>
            ))}
            <p className='text-xs text-clay'>This is informational only — it does not hide the patient or block editing.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
