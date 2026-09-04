/** Plain-text readout of the properties a view's filter is currently using — one line per active facet — so it's visible at a glance without opening the filter dialog. Renders nothing when `lines` is empty. */
export const FilterSummary = ({ lines }: { lines: string[] }) => {
  if (lines.length === 0) return null

  return (
    <div className='flex flex-col gap-0.5 px-1'>
      {lines.map((line) => (
        <p key={line} className='text-xs text-clay'>{line}</p>
      ))}
    </div>
  )
}
