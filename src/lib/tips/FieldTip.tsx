import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useHideTips } from './useHideTips'

/** Wraps a small explanatory tip (what a field or function is for) so the "Hide field tips"
 * setting (Settings → Patient Tabs) can suppress it app-wide. Not for empty-state messages,
 * counts, or data values — those stay visible regardless of the setting. */
export const FieldTip = ({
  as: Tag = 'p',
  className,
  children,
}: {
  as?: ElementType
  className?: string
  children: ReactNode
}) => {
  const hideTips = useHideTips()
  if (hideTips) return null
  return <Tag className={cn('text-xs text-clay', className)}>{children}</Tag>
}
