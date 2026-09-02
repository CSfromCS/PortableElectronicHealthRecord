import { useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatClock, parseFlexibleTime } from '@/lib/dateTime'

/**
 * Free-typed time entry: accepts permissive formats ("8pm", "730 pm", "15:00", "1500H", …),
 * shows the fully resolved time once parsed, and keeps unparseable text on screen with an
 * inline error instead of clearing it. A clock icon still opens the native time picker as a
 * secondary input path; picking a time there overwrites the typed text.
 */
export function FlexibleTimeInput({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder = 'e.g. 3:30 pm',
  className,
  defaultHhmm = null,
  emitEmptyOnClear = false,
}: {
  id?: string
  value: string
  onChange: (hhmm: string) => void
  ariaLabel: string
  placeholder?: string
  className?: string
  /** When `value` is empty, shows this time below the field labeled "(Default)" instead of showing nothing — for fields that fall back to a computed value (usually the current time) until the user explicitly types an override. */
  defaultHhmm?: string | null
  /** When true, clearing the field calls onChange('') so the parent's stored value actually reverts to empty (and therefore back to `defaultHhmm`) instead of silently keeping the last committed value. Off by default so required time fields can't be blanked by a stray clear. */
  emitEmptyOnClear?: boolean
}) {
  const [draft, setDraft] = useState(() => (value ? formatClock(value) : ''))
  const [error, setError] = useState<string | null>(null)
  const [resolvedHhmm, setResolvedHhmm] = useState<string | null>(value || null)
  const [committedValue, setCommittedValue] = useState(value)
  const nativeInputRef = useRef<HTMLInputElement>(null)

  // Reset the draft to match `value` only when it changed from outside this component (e.g. a
  // different record was loaded) — not when it changed because we just committed it ourselves,
  // which would otherwise stomp the user's raw typed text with the resolved format mid-edit.
  if (value !== committedValue) {
    setCommittedValue(value)
    setDraft(value ? formatClock(value) : '')
    setResolvedHhmm(value || null)
    setError(null)
  }

  const commitDraft = (raw: string) => {
    setDraft(raw)
    if (!raw.trim()) {
      setError(null)
      setResolvedHhmm(null)
      if (emitEmptyOnClear) {
        setCommittedValue('')
        onChange('')
      }
      return
    }

    const result = parseFlexibleTime(raw)
    if (result.ok) {
      setError(null)
      setResolvedHhmm(result.hhmm)
      setCommittedValue(result.hhmm)
      onChange(result.hhmm)
    } else {
      setError(result.error)
      setResolvedHhmm(null)
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
    <div className={cn('min-w-0 space-y-1', className)}>
      <div className='flex min-w-0 items-center gap-1.5'>
        <Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => commitDraft(event.target.value)}
          className={cn('min-w-0', error && 'border-action-danger focus-visible:ring-action-danger/40')}
        />
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='relative shrink-0'
          aria-label={`Open time picker for ${ariaLabel}`}
          onClick={openNativePicker}
        >
          <Clock className='h-4 w-4' aria-hidden='true' />
          <input
            ref={nativeInputRef}
            type='time'
            value={value}
            onChange={(event) => {
              if (!event.target.value) return
              commitDraft(formatClock(event.target.value))
            }}
            className='sr-only'
            tabIndex={-1}
            aria-hidden='true'
          />
        </Button>
      </div>
      {error ? (
        <p className='text-xs text-action-danger'>{error}</p>
      ) : resolvedHhmm ? (
        <p className='text-xs text-clay'>{formatClock(resolvedHhmm)}</p>
      ) : defaultHhmm ? (
        <p className='text-xs text-clay'>{formatClock(defaultHhmm)} (Default)</p>
      ) : null}
    </div>
  )
}
