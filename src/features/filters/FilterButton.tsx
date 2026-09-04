import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/** Filter icon/button with a badge showing the combined count of active filter selections (point 7 of issue #81). */
export const FilterButton = ({
  activeCount,
  onClick,
  className,
}: {
  activeCount: number
  onClick: () => void
  className?: string
}) => (
  <Button type='button' variant='outline' size='sm' className={className} onClick={onClick}>
    <Filter className='h-3.5 w-3.5' aria-hidden='true' />
    Filter
    {activeCount > 0 ? (
      <Badge variant='default' className='ml-1 h-4 min-w-4 px-1 text-[10px] leading-none'>
        {activeCount}
      </Badge>
    ) : null}
  </Button>
)
