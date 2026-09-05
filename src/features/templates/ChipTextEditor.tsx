import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { buildVariableToken, createVariableId, tokenizePatternText } from './templateEngine'

export interface ChipCatalogEntry {
  id: string
  label: string
}

const CHIP_CLASS = 'inline-flex items-center rounded-full bg-action-primary/15 px-2 py-0.5 text-xs font-semibold text-action-primary align-baseline mx-0.5 cursor-pointer select-none whitespace-nowrap'

const buildChipElement = (label: string): HTMLSpanElement => {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.className = CHIP_CLASS
  chip.textContent = label
  return chip
}

/**
 * A smaller sibling of the main Format Pattern editor (see ManageTemplatesScreen.tsx's
 * FormatPatternEditor) — same free-text-plus-inline-chip mechanics, but for catalogs where every
 * chip is configless (a Block variable's entry pattern, a Date/Time Format's component sequence):
 * no per-chip config dialog, no click-to-reconfigure, just insert/remove. Deliberately a separate,
 * simpler component rather than a generalized version of the more complex main editor — entry
 * patterns and Date/Time Formats don't need the tabs/config-dialog machinery that editor carries,
 * and duplicating the (already tricky, already-debugged) core mechanics here is lower-risk than
 * forcing both use cases through one shared abstraction.
 */
export const ChipTextEditor = ({
  initialPatternText,
  initialFieldIds,
  catalog,
  onChange,
  addButtonLabel = 'Add Field',
  pickerTitle = 'Add field',
}: {
  initialPatternText: string
  initialFieldIds: Record<string, string>
  catalog: ChipCatalogEntry[]
  onChange: (patternText: string, fieldIds: Record<string, string>) => void
  addButtonLabel?: string
  pickerTitle?: string
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fieldIdsRef = useRef<Record<string, string>>(initialFieldIds)
  const savedRangeRef = useRef<Range | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const labelById = new Map(catalog.map((entry) => [entry.id, entry.label]))

  // Builds the initial DOM once on mount — parent remounts this component (via `key`) whenever a
  // different pattern is loaded, so this never needs to reconcile against a changed prop later.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    tokenizePatternText(initialPatternText).forEach((part) => {
      if (part.type === 'text') {
        container.appendChild(document.createTextNode(part.text))
      } else if (part.type === 'lineBreak') {
        container.appendChild(document.createElement('br'))
      } else {
        const fieldId = initialFieldIds[part.id]
        const label = fieldId ? labelById.get(fieldId) : undefined
        if (fieldId && label) {
          const chip = buildChipElement(label)
          chip.dataset.chipId = part.id
          container.appendChild(chip)
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs once per mount only
  }, [])

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (containerRef.current?.contains(range.startContainer)) {
        savedRangeRef.current = range.cloneRange()
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  const serialize = (): { patternText: string; fieldIds: Record<string, string> } => {
    const container = containerRef.current
    let patternText = ''
    const usedChipIds = new Set<string>()
    if (container) {
      container.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          patternText += node.textContent ?? ''
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement
          if (element.tagName === 'BR') {
            patternText += '\n'
          } else if (element.dataset.chipId) {
            patternText += buildVariableToken(element.dataset.chipId)
            usedChipIds.add(element.dataset.chipId)
          }
        }
      })
    }
    const nextFieldIds: Record<string, string> = {}
    usedChipIds.forEach((chipId) => {
      const fieldId = fieldIdsRef.current[chipId]
      if (fieldId) nextFieldIds[chipId] = fieldId
    })
    fieldIdsRef.current = nextFieldIds
    return { patternText, fieldIds: nextFieldIds }
  }

  const emitChange = () => {
    const { patternText, fieldIds } = serialize()
    onChange(patternText, fieldIds)
  }

  const getAdjacentChip = (direction: 'before' | 'after'): HTMLElement | null => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
    const { startContainer, startOffset } = selection.getRangeAt(0)
    if (!container.contains(startContainer)) return null

    if (startContainer.nodeType === Node.TEXT_NODE) {
      const sibling = direction === 'before'
        ? (startOffset === 0 ? startContainer.previousSibling : null)
        : (startOffset === (startContainer.textContent?.length ?? 0) ? startContainer.nextSibling : null)
      return sibling instanceof HTMLElement && sibling.dataset.chipId ? sibling : null
    }
    const node = direction === 'before'
      ? startContainer.childNodes[startOffset - 1]
      : startContainer.childNodes[startOffset]
    return node instanceof HTMLElement && node.dataset.chipId ? node : null
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      document.execCommand('insertLineBreak')
      emitChange()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const chip = getAdjacentChip(event.key === 'Backspace' ? 'before' : 'after')
      if (chip) {
        event.preventDefault()
        chip.remove()
        emitChange()
      }
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
    emitChange()
  }

  const insertFieldAtSavedRange = (fieldId: string) => {
    const container = containerRef.current
    const label = labelById.get(fieldId)
    if (!container || !label) return
    const chipId = createVariableId()
    const chip = buildChipElement(label)
    chip.dataset.chipId = chipId
    fieldIdsRef.current = { ...fieldIdsRef.current, [chipId]: fieldId }

    let range = savedRangeRef.current
    if (!range || !container.contains(range.startContainer)) {
      range = document.createRange()
      range.selectNodeContents(container)
      range.collapse(false)
    }
    range.deleteContents()
    range.insertNode(chip)

    const spacer = document.createTextNode('')
    chip.parentNode?.insertBefore(spacer, chip.nextSibling)
    const newRange = document.createRange()
    newRange.setStart(spacer, 0)
    newRange.collapse(true)

    savedRangeRef.current = newRange.cloneRange()
    const restoreCaret = () => {
      container.focus()
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(newRange)
    }
    restoreCaret()
    // The field picker is a Radix Dialog; closing it returns focus to its trigger in a cleanup
    // effect that runs shortly after this click handler, clobbering the focus/selection set above
    // for the ~200ms of its close transition. Reasserting after that settles wins reliably.
    window.setTimeout(restoreCaret, 260)
    emitChange()
  }

  const handleContainerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Chips here carry no config, so a click is a no-op — kept only so future chip types could
    // hook in without changing the container's event wiring.
    void event
  }

  return (
    <div className='space-y-1.5'>
      <div
        ref={containerRef}
        role='textbox'
        aria-multiline='true'
        contentEditable
        suppressContentEditableWarning
        className='min-h-16 whitespace-pre-wrap break-words rounded-lg border border-clay/25 bg-white px-3 py-2 text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={handleContainerClick}
      />
      <Button type='button' size='sm' variant='outline' onClick={() => setPickerOpen(true)}>
        <Plus className='h-3.5 w-3.5' aria-hidden='true' /> {addButtonLabel}
      </Button>

      <Dialog open={pickerOpen} onOpenChange={(next) => { if (!next) setPickerOpen(false) }}>
        <DialogContent className='max-w-sm' onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{pickerTitle}</DialogTitle>
          </DialogHeader>
          <ScrollArea className='max-h-[50vh] pr-3'>
            <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-2 py-1'>
              {catalog.map((entry) => (
                <button
                  key={entry.id}
                  type='button'
                  className='w-full rounded-md px-2 py-1.5 text-left text-sm text-espresso hover:bg-white/70 transition-colors'
                  onClick={() => {
                    setPickerOpen(false)
                    insertFieldAtSavedRange(entry.id)
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </ScrollArea>
          <div className='flex justify-end pt-2'>
            <Button type='button' variant='ghost' onClick={() => setPickerOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
