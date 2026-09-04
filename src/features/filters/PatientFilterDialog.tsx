import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Label } from '@/components/ui/label'
import { FlexibleDateInput } from '@/lib/date/FlexibleDateInput'
import { FlexibleTimeInput } from '@/lib/date/FlexibleTimeInput'
import { BulkTagPicker } from '@/features/tags/BulkTagPicker'
import { cn } from '@/lib/utils'
import type { TagDefinition, TagGroupDefinition } from '@/types'
import { PATIENT_POOL_CRITERIA, patientPoolCriteriaNeedWindow } from './patientFilterUtils'
import type { DateTimeWindow, PatientPoolCriterion, TagFilterMode, TagWardFilterState } from './patientFilterUtils'

export type PatientPoolFacetProps = {
  criteria: PatientPoolCriterion[]
  onChangeCriteria: (criteria: PatientPoolCriterion[]) => void
  /** Whether the shared window below actually narrows Admitted/Discharged/Referred/MGH. False means those criteria match regardless of when (issue #81's "if no window is set" fallback). */
  useWindow: boolean
  onChangeUseWindow: (useWindow: boolean) => void
  /** Raw, independently-blankable fields — a blank field falls back to the matching field in `defaults` (last 12 hours, ending now), same as any other optional date/time field in this app. */
  window: DateTimeWindow
  onChangeWindow: (window: DateTimeWindow) => void
  /** The computed "(Default)" values shown when a field above is blank. */
  defaults: DateTimeWindow
}

export const PatientFilterDialog = ({
  open,
  onOpenChange,
  title,
  tags,
  groups,
  wards,
  filter,
  onChangeFilter,
  pool,
  onClear,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  wards: string[]
  filter: TagWardFilterState
  onChangeFilter: (filter: TagWardFilterState) => void
  pool?: PatientPoolFacetProps
  onClear: () => void
}) => {
  const toggleTag = (tag: TagDefinition) => {
    if (tag.id === undefined) return
    const tagId = tag.id
    onChangeFilter({
      ...filter,
      tagIds: filter.tagIds.includes(tagId)
        ? filter.tagIds.filter((id) => id !== tagId)
        : [...filter.tagIds, tagId],
    })
  }

  const setTagMode = (mode: TagFilterMode) => onChangeFilter({ ...filter, tagMode: mode })

  const toggleWard = (ward: string) => {
    onChangeFilter({
      ...filter,
      wards: filter.wards.includes(ward) ? filter.wards.filter((w) => w !== ward) : [...filter.wards, ward],
    })
  }

  const togglePoolCriterion = (criterion: PatientPoolCriterion) => {
    if (!pool) return
    pool.onChangeCriteria(
      pool.criteria.includes(criterion)
        ? pool.criteria.filter((c) => c !== criterion)
        : [...pool.criteria, criterion],
    )
  }

  const showPoolWindow = pool ? patientPoolCriteriaNeedWindow(pool.criteria) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className='max-h-[65vh] pr-3'>
          <div className='space-y-5'>
            <div className='space-y-1.5'>
              <div className='flex items-center justify-between'>
                <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Tags</p>
                <div className='flex gap-0.5 bg-blush-sand/60 rounded-lg p-0.5 border border-clay/15'>
                  <Button
                    type='button'
                    size='sm'
                    variant={filter.tagMode === 'OR' ? 'default' : 'ghost'}
                    className='h-6 px-2 text-[11px]'
                    onClick={() => setTagMode('OR')}
                  >
                    Any (OR)
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant={filter.tagMode === 'AND' ? 'default' : 'ghost'}
                    className='h-6 px-2 text-[11px]'
                    onClick={() => setTagMode('AND')}
                  >
                    All (AND)
                  </Button>
                </div>
              </div>
              <BulkTagPicker
                tags={tags}
                groups={groups}
                selectedTagIds={new Set(filter.tagIds)}
                onToggle={toggleTag}
              />
            </div>

            <div className='space-y-1.5'>
              <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Ward</p>
              {wards.length === 0 ? (
                <p className='text-xs text-clay'>No wards recorded yet.</p>
              ) : (
                <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
                  {wards.map((ward) => (
                    <label key={ward} className='flex items-center gap-2.5 py-1 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={filter.wards.includes(ward)}
                        onChange={() => toggleWard(ward)}
                        aria-label={`Toggle ward ${ward}`}
                      />
                      <span className='text-sm text-espresso'>{ward}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {pool ? (
              <div className='space-y-2 rounded-xl border-2 border-dashed border-action-primary/50 bg-action-primary/5 p-3'>
                <div className='flex items-center gap-1.5'>
                  <Clock className='h-3.5 w-3.5 text-action-primary shrink-0' aria-hidden='true' />
                  <p className='text-[11px] font-bold uppercase tracking-widest text-action-primary'>Special/Timebound Filter</p>
                </div>
                <p className='text-xs text-clay'>
                  Unique to this picker — not available on the Patients list or Master Checklist filters. Narrows the pool by clinical status (Active/Admitted/Discharged/Referred/MGH), optionally within a shared time window.
                </p>
                <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
                  {PATIENT_POOL_CRITERIA.map((criterion) => (
                    <label key={criterion.id} className='flex items-center gap-2.5 py-1 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={pool.criteria.includes(criterion.id)}
                        onChange={() => togglePoolCriterion(criterion.id)}
                        aria-label={`Toggle patient pool ${criterion.label}`}
                      />
                      <span className='text-sm text-espresso'>{criterion.label}</span>
                    </label>
                  ))}
                </div>
                {showPoolWindow ? (
                  <div className={cn('space-y-2 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2')}>
                    <label className='flex items-center gap-2.5 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={pool.useWindow}
                        onChange={(event) => pool.onChangeUseWindow(event.target.checked)}
                        aria-label='Apply time window to Admitted/Discharged/Referred/MGH'
                      />
                      <span className='text-sm text-espresso'>Limit to a time window</span>
                    </label>
                    <p className='text-xs text-clay'>
                      {pool.useWindow
                        ? 'Shared window for Admitted/Discharged/Referred/MGH. Leave a field blank to use its default (last 12 hours, ending now).'
                        : 'Unchecked: Admitted/Discharged/Referred/MGH match regardless of when.'}
                    </p>
                    <div className={cn('grid grid-cols-2 gap-2', !pool.useWindow && 'opacity-40 pointer-events-none')}>
                      <div className='space-y-1'>
                        <Label className='text-xs'>From date</Label>
                        <FlexibleDateInput
                          ariaLabel='Patient pool window from date'
                          value={pool.window.dateFrom}
                          onChange={(isoDate) => pool.onChangeWindow({ ...pool.window, dateFrom: isoDate })}
                          defaultIso={pool.defaults.dateFrom}
                          emitEmptyOnClear
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-xs'>From time</Label>
                        <FlexibleTimeInput
                          ariaLabel='Patient pool window from time'
                          value={pool.window.timeFrom}
                          onChange={(hhmm) => pool.onChangeWindow({ ...pool.window, timeFrom: hhmm })}
                          defaultHhmm={pool.defaults.timeFrom}
                          emitEmptyOnClear
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-xs'>Until date</Label>
                        <FlexibleDateInput
                          ariaLabel='Patient pool window until date'
                          value={pool.window.dateTo}
                          onChange={(isoDate) => pool.onChangeWindow({ ...pool.window, dateTo: isoDate })}
                          defaultIso={pool.defaults.dateTo}
                          emitEmptyOnClear
                        />
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-xs'>Until time</Label>
                        <FlexibleTimeInput
                          ariaLabel='Patient pool window until time'
                          value={pool.window.timeTo}
                          onChange={(hhmm) => pool.onChangeWindow({ ...pool.window, timeTo: hhmm })}
                          defaultHhmm={pool.defaults.timeTo}
                          emitEmptyOnClear
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </ScrollArea>
        <div className='flex justify-between gap-2 pt-2'>
          <Button type='button' variant='ghost' onClick={onClear}>Clear filter</Button>
          <Button type='button' onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
