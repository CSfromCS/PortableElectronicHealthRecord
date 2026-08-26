import type { ComponentProps } from 'react'
import { GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const DragHandle = ({
  label,
  className,
  dragProps,
}: {
  label: string
  className?: string
  dragProps: ComponentProps<typeof Button>
}) => (
  <Button
    type='button'
    variant='ghost'
    className={cn('h-6 w-6 shrink-0 p-0 text-clay cursor-grab active:cursor-grabbing touch-none', className)}
    aria-label={label}
    {...dragProps}
  >
    <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
  </Button>
)
