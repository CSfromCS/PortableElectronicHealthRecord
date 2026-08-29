import { ChevronLeft, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import {
  DEFAULT_PATIENT_TAB_SETTINGS,
  PATIENT_TAB_DESCRIPTIONS,
  PATIENT_TAB_LABELS,
  type PatientTabId,
  type PatientTabSetting,
} from './tabConfig'

export const TabSettingsScreen = ({
  settings,
  onChange,
  onBack,
}: {
  settings: PatientTabSetting[]
  onChange: (next: PatientTabSetting[]) => void
  onBack: () => void
}) => {
  const toggleVisible = (id: PatientTabId) => {
    onChange(settings.map((tab) => (tab.id === id ? { ...tab, visible: !tab.visible } : tab)))
  }

  const reorderTabs = (sourceId: PatientTabId, targetId: PatientTabId) => {
    onChange(moveItemByKey(settings, (tab) => tab.id, sourceId, targetId))
  }

  const drag = useDragReorder(settings.map((tab) => tab.id), reorderTabs)

  const visibleCount = settings.filter((tab) => tab.visible).length

  return (
    <Card className='bg-white/80 border-clay/25 shadow-sm'>
      <CardHeader className='py-3 px-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' className='h-7 w-7 p-0' onClick={onBack} aria-label='Back to Settings'>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <CardTitle className='text-base text-espresso'>Patient Tabs</CardTitle>
        </div>
      </CardHeader>
      <CardContent className='px-4 pb-4 space-y-3'>
        <p className='text-xs text-clay'>
          Drag to reorder, or hide a tab to remove it from the patient view. Hiding a tab never deletes its data — turn it back on any time to see everything that was recorded while it was hidden.
        </p>

        <div className='flex flex-col gap-1.5'>
          {settings.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-clay/20 bg-warm-ivory px-2.5 py-2 transition-shadow',
                drag.isDragging(tab.id) && 'opacity-50',
                drag.isDropTarget(tab.id) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
                !tab.visible && 'opacity-60',
              )}
              {...drag.getItemProps(tab.id)}
            >
              <DragHandle label={`Drag to reorder ${PATIENT_TAB_LABELS[tab.id]} tab`} dragProps={drag.getHandleProps(tab.id)} />
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium text-espresso'>{PATIENT_TAB_LABELS[tab.id]}</p>
                <p className='text-[11px] text-clay leading-snug'>{PATIENT_TAB_DESCRIPTIONS[tab.id]}</p>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-8 gap-1.5 px-2 text-xs shrink-0'
                aria-pressed={tab.visible}
                aria-label={tab.visible ? `Hide ${PATIENT_TAB_LABELS[tab.id]} tab` : `Show ${PATIENT_TAB_LABELS[tab.id]} tab`}
                disabled={tab.visible && visibleCount <= 1}
                onClick={() => toggleVisible(tab.id)}
              >
                {tab.visible ? <Eye className='h-3.5 w-3.5' aria-hidden='true' /> : <EyeOff className='h-3.5 w-3.5' aria-hidden='true' />}
                {tab.visible ? 'Visible' : 'Hidden'}
              </Button>
            </div>
          ))}
        </div>

        <Button
          type='button'
          variant='outline'
          size='sm'
          className='gap-1.5'
          onClick={() => onChange(DEFAULT_PATIENT_TAB_SETTINGS)}
        >
          <RotateCcw className='h-3.5 w-3.5' aria-hidden='true' />
          Reset to default order & visibility
        </Button>
      </CardContent>
    </Card>
  )
}
