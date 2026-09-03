import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 400

// Padding/font-size shared by the view text and the editor, so entering edit mode can't
// shift the text's position or size — only the view side needs the rest (border/hover/etc).
// min-w-0 so a flex/grid-item ancestor can actually shrink this below its unbroken text's
// natural width — otherwise a long unspaced string (which does wrap fine while editing, since
// the autogrow textarea sets its own min-width: 0) reasserts its overflow the moment you exit
// edit mode, because the view-mode box never got the same allowance.
const BASE_FIELD_CLASSES = 'min-w-0 px-3 py-2 text-[15px]'

// Strips the editor's own box chrome AND its own padding/height/font-size so it's the
// wrapping div's (shared) BASE_FIELD_CLASSES that determines the visible box in both
// states — the editor reads as the same text becoming editable, notepad-style, with no
// box appearing and no shift in text size or position.
const SEAMLESS_EDITOR_RESET = cn(
  '[&_input]:h-auto [&_input]:p-0 [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none',
  '[&_input]:ring-0 [&_input]:ring-offset-0 [&_input]:focus-visible:ring-0 [&_input]:focus-visible:ring-offset-0',
  '[&_input]:[font-size:inherit] [&_input]:[line-height:inherit]',
  '[&_textarea]:p-0 [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:shadow-none',
  '[&_textarea]:ring-0 [&_textarea]:ring-offset-0 [&_textarea]:focus-visible:ring-0 [&_textarea]:focus-visible:ring-offset-0',
  '[&_textarea]:[font-size:inherit] [&_textarea]:[line-height:inherit]',
)

export type TapToEditFieldKeyDownContext = {
  /** The editable field's own live DOM value at the moment of the keypress — authoritative
   * regardless of this field's debounce timing. */
  fieldValue: string
  caretOffset: number
  /** Exits edit mode immediately without committing the in-progress draft — for callers that
   * are about to replace this field's value themselves (e.g. splitting it into two checklist
   * items) and would otherwise race the field's own blur-triggered commit of the stale,
   * un-split draft. */
  forceExit: () => void
}

type TapToEditFieldProps = {
  value: string
  onCommit: (nextValue: string) => void
  ariaLabel: string
  emptyText: string
  className?: string
  renderView?: (value: string) => ReactNode
  renderEditor: (params: { value: string; onChange: (nextValue: string) => void }) => ReactNode
  /** Forwarded from the editor's wrapping container, so a caller can intercept e.g. Enter/
   * Backspace at a specific caret position without owning the editor itself. */
  onEditorKeyDown?: (event: KeyboardEvent<HTMLDivElement>, context: TapToEditFieldKeyDownContext) => void
  /** When set to a new object (by reference), programmatically enters edit mode at the given
   * caret offset — for a caller that just created this field's value elsewhere (e.g. the new
   * item produced by a split) and wants to move focus into it, the way a real cursor would land
   * after pressing Enter. Call `onAutoEnterHandled` once consumed so the caller can clear it. */
  autoEnter?: { caretOffset: number } | null
  onAutoEnterHandled?: () => void
}

type EditorHostProps = {
  draft: string
  onChange: (nextValue: string) => void
  renderEditor: TapToEditFieldProps['renderEditor']
}

// Isolated from TapToEditField's own refs so the render-prop call below can't be mistaken
// for a same-scope ref read by the react-hooks/refs rule.
const EditorHost = ({ draft, onChange, renderEditor }: EditorHostProps) => (
  <>{renderEditor({ value: draft, onChange })}</>
)

const findEditableField = (container: HTMLElement) => {
  const field = container.querySelector('input, textarea')
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null
}

type LegacyCaretPositionSource = {
  caretPositionFromPoint: (x: number, y: number) => { offsetNode: Node; offset: number } | null
}

/** Maps a click's page coordinates to a character offset within `container`'s full text content. */
const computeClickOffset = (container: HTMLElement, clientX: number, clientY: number): number | null => {
  let range: Range | null = null
  if (typeof document.caretRangeFromPoint === 'function') {
    range = document.caretRangeFromPoint(clientX, clientY)
  } else if (typeof (document as unknown as Partial<LegacyCaretPositionSource>).caretPositionFromPoint === 'function') {
    const position = (document as unknown as LegacyCaretPositionSource).caretPositionFromPoint(clientX, clientY)
    if (position) {
      range = document.createRange()
      range.setStart(position.offsetNode, position.offset)
    }
  }
  if (!range || !container.contains(range.startContainer)) return null

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return offset + range.startOffset
    offset += node.textContent?.length ?? 0
  }
  return null
}

/**
 * Tapping the displayed text swaps it for the live editor in place, styled to match the
 * read view exactly (same padding/font-size, no visible box) — edits autosave after a
 * short typing pause and immediately on blur. The cursor lands where the user clicked,
 * not at the start/end.
 */
export const TapToEditField = ({
  value,
  onCommit,
  ariaLabel,
  emptyText,
  className,
  renderView,
  renderEditor,
  onEditorKeyDown,
  autoEnter,
  onAutoEnterHandled,
}: TapToEditFieldProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const debounceRef = useRef<number | null>(null)
  const lastCommittedRef = useRef(value)
  const pendingCaretOffsetRef = useRef<number | null>(null)

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

  const enterEditMode = (caretOffset: number | null) => {
    pendingCaretOffsetRef.current = caretOffset
    setDraft(value)
    lastCommittedRef.current = value
    setIsEditing(true)
  }

  // Fires only when the caller hands us a genuinely new request object (see autoEnter's doc
  // comment) — not on every re-render, since `value`/`onAutoEnterHandled` aren't meant to
  // re-trigger this on their own.
  useEffect(() => {
    if (!autoEnter) return
    enterEditMode(autoEnter.caretOffset)
    onAutoEnterHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnter])

  const forceExit = () => {
    clearDebounce()
    setIsEditing(false)
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onEditorKeyDown) return
    const field = findEditableField(event.currentTarget)
    if (!field) return
    onEditorKeyDown(event, {
      fieldValue: field.value,
      caretOffset: field.selectionStart ?? field.value.length,
      forceExit,
    })
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

  // Checked synchronously off event.relatedTarget (the element about to receive focus)
  // rather than deferred via setTimeout: a deferred check runs after the discrete click
  // handler of whatever the user clicked next (e.g. a "Save"/"Add" button), so that
  // handler would read stale parent state from before this field's pending edit committed.
  const handleContainerBlur = (event: FocusEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    const nextFocusTarget = event.relatedTarget
    if (nextFocusTarget instanceof Node && container.contains(nextFocusTarget)) return
    exitEditMode()
  }

  // Stable across re-renders (typing triggers a re-render via setDraft) so React attaches
  // this ref exactly once per edit session instead of detaching/reattaching on every
  // keystroke — reattaching was resetting the caret to the original click position after
  // each character, which made typed characters land out of order.
  const attachEditingSurface = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const field = findEditableField(node)
    if (!field) return
    field.focus()
    const maxOffset = field.value.length
    const requestedOffset = pendingCaretOffsetRef.current
    const caretPosition = requestedOffset === null ? maxOffset : Math.max(0, Math.min(requestedOffset, maxOffset))
    field.setSelectionRange(caretPosition, caretPosition)
  }, [])

  if (isEditing) {
    return (
      <div ref={attachEditingSurface} onBlur={handleContainerBlur} onKeyDown={handleEditorKeyDown} className={cn(BASE_FIELD_CLASSES, className, SEAMLESS_EDITOR_RESET)}>
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
        BASE_FIELD_CLASSES,
        'cursor-text rounded-lg border border-transparent transition-colors hover:border-clay/25 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      onClick={(event: MouseEvent<HTMLDivElement>) => enterEditMode(computeClickOffset(event.currentTarget, event.clientX, event.clientY))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        enterEditMode(null)
      }}
    >
      {isEmpty ? (
        <span className='text-muted-foreground/60'>{emptyText}</span>
      ) : (
        <div className='whitespace-pre-wrap break-words'>{renderView ? renderView(value) : value}</div>
      )}
    </div>
  )
}
