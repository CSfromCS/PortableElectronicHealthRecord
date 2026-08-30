import type { ChangeEvent } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type AutoGrowTextFieldProps = {
  value: string
  onChange: (nextValue: string) => void
  id?: string
  className?: string
  placeholder?: string
  'aria-label'?: string
  autoFocus?: boolean
}

/**
 * A single-line-looking text field that wraps instead of scrolling horizontally once its
 * content exceeds the visible width, and grows taller to fit — a plain `<input>` never
 * wraps, so any content wider than the box would otherwise scroll text out of view.
 */
export const AutoGrowTextField = ({ value, onChange, className, ...props }: AutoGrowTextFieldProps) => (
  <div className='autogrow-field' data-grow-value={value}>
    <Textarea
      {...props}
      rows={1}
      value={value}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
      className={cn('min-h-0', className)}
    />
  </div>
)
