import { useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatFlexibleDateConfirmation, parseFlexibleDate } from '@/lib/dateTime'

/**
 * Free-typed date entry: accepts permissive formats ("jan 1", "1/1", "january 1 2026", …),
 * shows the fully resolved date once parsed, and keeps unparseable text on screen with an
 * inline error instead of clearing it. A calendar icon still opens the native date picker
 * as a secondary input path; picking a date there overwrites the typed text.
 */
export function FlexibleDateInput({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder = 'e.g. 1 Jan 2026',
  className,
}: {
  id?: string
  value: string
  onChange: (isoDate: string) => void
  ariaLabel: string
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(() => (value ? formatFlexibleDateConfirmation(value) : ''))
  const [error, setError] = useState<string | null>(null)
  const [resolvedIso, setResolvedIso] = useState<string | null>(value || null)
  const [committedValue, setCommittedValue] = useState(value)
  const nativeInputRef = useRef<HTMLInputElement>(null)

  // Reset the draft to match `value` only when it changed from outside this component (e.g. a
  // different record was loaded) — not when it changed because we just committed it ourselves,
  // which would otherwise stomp the user's raw typed text with the resolved format mid-edit.
  if (value !== committedValue) {
    setCommittedValue(value)
    setDraft(value ? formatFlexibleDateConfirmation(value) : '')
    setResolvedIso(value || null)
    setError(null)
  }

  const commitDraft = (raw: string) => {
    setDraft(raw)
    if (!raw.trim()) {
      setError(null)
      setResolvedIso(null)
      return
    }

    const result = parseFlexibleDate(raw)
    if (result.ok) {
      setError(null)
      setResolvedIso(result.iso)
      setCommittedValue(result.iso)
      onChange(result.iso)
    } else {
      setError(result.error)
      setResolvedIso(null)
    }
  }

  const openNativePicker = () => {
    const input = nativeInputRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') {
      input.showPicker()
    } else {
      input.click()
    }
  }

  return (
    <div className={cn('space-y-1', className)}>
      <div className='flex items-center gap-1.5'>
        <Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => commitDraft(event.target.value)}
          className={cn(error && 'border-action-danger focus-visible:ring-action-danger/40')}
        />
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='relative shrink-0'
          aria-label={`Open calendar for ${ariaLabel}`}
          onClick={openNativePicker}
        >
          <CalendarDays className='h-4 w-4' aria-hidden='true' />
          <input
            ref={nativeInputRef}
            type='date'
            value={value}
            onChange={(event) => {
              if (!event.target.value) return
              commitDraft(formatFlexibleDateConfirmation(event.target.value))
            }}
            className='sr-only'
            tabIndex={-1}
            aria-hidden='true'
          />
        </Button>
      </div>
      {error ? (
        <p className='text-xs text-action-danger'>{error}</p>
      ) : resolvedIso ? (
        <p className='text-xs text-clay'>{formatFlexibleDateConfirmation(resolvedIso)}</p>
      ) : null}
    </div>
  )
}
