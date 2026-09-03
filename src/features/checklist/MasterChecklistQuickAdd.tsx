import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type MasterChecklistQuickAddOption = {
  id: number
  label: string
}

type MasterChecklistQuickAddProps = {
  /** Selectable targets, already sorted for display — real patients plus the General
   * (no-patient) checklist (issue #79). */
  options: MasterChecklistQuickAddOption[]
  onAdd: (id: number, text: string) => void
}

export const MasterChecklistQuickAdd = ({ options, onAdd }: MasterChecklistQuickAddProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null)
  const [optionQuery, setOptionQuery] = useState('')
  const [isOptionListOpen, setIsOptionListOpen] = useState(false)
  const [itemText, setItemText] = useState('')
  const itemInputRef = useRef<HTMLInputElement>(null)

  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedOptionId) ?? null,
    [options, selectedOptionId],
  )

  const suggestions = useMemo(() => {
    const normalizedQuery = optionQuery.trim().toLowerCase()
    if (!normalizedQuery) return options.slice(0, 6)
    return options
      .filter((option) => option.label.toLowerCase().includes(normalizedQuery))
      .slice(0, 6)
  }, [options, optionQuery])

  const reset = () => {
    setIsOpen(false)
    setSelectedOptionId(null)
    setOptionQuery('')
    setIsOptionListOpen(false)
    setItemText('')
  }

  const selectOptionSuggestion = (option: MasterChecklistQuickAddOption) => {
    setSelectedOptionId(option.id)
    setOptionQuery('')
    setIsOptionListOpen(false)
    window.setTimeout(() => itemInputRef.current?.focus(), 0)
  }

  const submitItem = () => {
    const nextText = itemText.trim()
    if (!nextText || selectedOptionId == null) return
    onAdd(selectedOptionId, nextText)
    setItemText('')
    itemInputRef.current?.focus()
  }

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOptionListOpen(false)
      return
    }
    if (event.key === 'Enter' && suggestions.length > 0) {
      selectOptionSuggestion(suggestions[0])
    }
  }

  const handleItemKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      submitItem()
    }
  }

  if (!isOpen) {
    return (
      <Button
        type='button'
        variant='secondary'
        size='sm'
        className='gap-1.5'
        onClick={() => setIsOpen(true)}
      >
        <Plus className='h-3.5 w-3.5' aria-hidden='true' />
        Add item
      </Button>
    )
  }

  return (
    <div className='flex flex-wrap items-start gap-2 rounded-lg border border-clay/25 bg-white/60 p-2'>
      <div className='relative w-56 max-w-full'>
        <Input
          aria-label='Patient'
          placeholder='Find patient by room or name'
          value={selectedOption ? selectedOption.label : optionQuery}
          onChange={(event) => {
            setSelectedOptionId(null)
            setOptionQuery(event.target.value)
            setIsOptionListOpen(true)
          }}
          onFocus={() => {
            setSelectedOptionId(null)
            setOptionQuery('')
            setIsOptionListOpen(true)
          }}
          onBlur={() => window.setTimeout(() => setIsOptionListOpen(false), 120)}
          onKeyDown={handleOptionKeyDown}
        />
        {isOptionListOpen && suggestions.length > 0 ? (
          <div className='absolute left-0 right-0 z-20 mt-1 rounded-lg border border-clay/25 bg-white/97 shadow-lg shadow-espresso/8 backdrop-blur-sm overflow-hidden'>
            <ul className='max-h-44 overflow-auto py-1'>
              {suggestions.map((option) => (
                <li key={option.id}>
                  <button
                    type='button'
                    className='w-full px-3 py-2 text-left text-sm hover:bg-blush-sand/50 transition-colors'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOptionSuggestion(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Input
        ref={itemInputRef}
        className='w-48 max-w-full'
        aria-label='Checklist item text'
        placeholder='Checklist item'
        value={itemText}
        onChange={(event) => setItemText(event.target.value)}
        onKeyDown={handleItemKeyDown}
        disabled={!selectedOption}
      />
      <Button
        type='button'
        variant='secondary'
        size='sm'
        onClick={submitItem}
        disabled={!selectedOption || itemText.trim().length === 0}
      >
        Add
      </Button>
      <Button type='button' variant='ghost' size='icon' className='h-9 w-9' onClick={reset} aria-label='Close add item form'>
        <X className='h-4 w-4' aria-hidden='true' />
      </Button>
    </div>
  )
}
