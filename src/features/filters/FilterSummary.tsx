import { Clock } from 'lucide-react'

/** Plain-text readout of the properties a view's filter is currently using — one line per active
 * facet — so it's visible at a glance without opening the filter dialog. `specialLine` (the
 * Special/Timebound Filter, census picker only) renders in its own tinted callout, visually set
 * apart from the plain Tag/Ward lines, matching the same treatment inside the filter dialog. */
export const FilterSummary = ({ lines, specialLine }: { lines: string[]; specialLine?: string }) => {
  if (lines.length === 0 && !specialLine) return null

  return (
    <div className='flex flex-col gap-1 px-1'>
      {lines.length > 0 ? (
        <div className='flex flex-col gap-0.5'>
          {lines.map((line) => (
            <p key={line} className='text-xs text-clay'>{line}</p>
          ))}
        </div>
      ) : null}
      {specialLine ? (
        <div className='flex items-center gap-1.5 rounded-lg border border-dashed border-action-primary/50 bg-action-primary/5 px-2 py-1'>
          <Clock className='h-3 w-3 text-action-primary shrink-0' aria-hidden='true' />
          <p className='text-xs text-action-primary'>{specialLine}</p>
        </div>
      ) : null}
    </div>
  )
}
