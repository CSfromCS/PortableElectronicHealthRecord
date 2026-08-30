import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 1200
const BLUR_CHECK_DELAY_MS = 120

type TapToEditFieldProps = {
  value: string
  onCommit: (nextValue: string) => void
  ariaLabel: string
  emptyText: string
  className?: string
  renderView?: (value: string) => ReactNode
  renderEditor: (params: { value: string; onChange: (nextValue: string) => void; autoFocus: boolean }) => ReactNode
}

type EditorHostProps = {
  draft: string
  onChange: (nextValue: string) => void
  renderEditor: TapToEditFieldProps['renderEditor']
}

// Isolated from TapToEditField's own refs so the render-prop call below can't be mistaken
// for a same-scope ref read by the react-hooks/refs rule.
const EditorHost = ({ draft, onChange, renderEditor }: EditorHostProps) => (
  <>{renderEditor({ value: draft, onChange, autoFocus: true })}</>
)

/**
 * Tapping the displayed text swaps it for the live editor in place; edits autosave via
 * `onCommit` after a short typing pause and immediately on blur — no Save button, no modal.
 */
export const TapToEditField = ({
  value,
  onCommit,
  ariaLabel,
  emptyText,
  className,
  renderView,
  renderEditor,
}: TapToEditFieldProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const debounceRef = useRef<number | null>(null)
  const lastCommittedRef = useRef(value)

  const clearDebounce = () => {
    if (debounceRef.current === null) return
    window.clearTimeout(debounceRef.current)
    debounceRef.current = null
  }

  const commit = (nextValue: string) => {
    clearDebounce()
    if (nextValue === lastCommittedRef.current) return
    lastCommittedRef.current = nextValue
    onCommit(nextValue)
  }

  useEffect(() => clearDebounce, [])

  const enterEditMode = () => {
    setDraft(value)
    lastCommittedRef.current = value
    setIsEditing(true)
  }

  const handleChange = (nextValue: string) => {
    setDraft(nextValue)
    clearDebounce()
    debounceRef.current = window.setTimeout(() => commit(nextValue), DEBOUNCE_MS)
  }

  const exitEditMode = () => {
    commit(draft)
    setIsEditing(false)
  }

  const handleContainerBlur = (event: FocusEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    window.setTimeout(() => {
      if (container.contains(document.activeElement)) return
      exitEditMode()
    }, BLUR_CHECK_DELAY_MS)
  }

  if (isEditing) {
    return (
      <div onBlur={handleContainerBlur}>
        <EditorHost draft={draft} onChange={handleChange} renderEditor={renderEditor} />
      </div>
    )
  }

  const isEmpty = value.trim().length === 0

  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn(
        'cursor-text rounded-lg border border-transparent px-3 py-2 text-[15px] transition-colors hover:border-clay/25 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      onClick={enterEditMode}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        enterEditMode()
      }}
    >
      {isEmpty ? (
        <span className='text-muted-foreground/60'>{emptyText}</span>
      ) : (
        <div className='whitespace-pre-wrap'>{renderView ? renderView(value) : value}</div>
      )}
    </div>
  )
}
