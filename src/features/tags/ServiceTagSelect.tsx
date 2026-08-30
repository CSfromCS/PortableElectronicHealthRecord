import { useMemo, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import type { TagDefinition } from '@/types'
import { findServiceTagByName } from './serviceTagParsing'
import { TagChip } from './TagChip'

type ServiceTagSelectProps = {
  ariaLabel: string
  placeholder?: string
  value: string
  availableTags: TagDefinition[]
  onChange: (nextValue: string) => void
}

/** Single-select counterpart to ServiceTagMultiSelect — picks one service tag from the same pool used on the Profile tab, shown as the same chip. */
export const ServiceTagSelect = ({ ariaLabel, placeholder, value, availableTags, onChange }: ServiceTagSelectProps) => {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const matchedTag = useMemo(() => findServiceTagByName(value, availableTags), [value, availableTags])

  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return availableTags
      .filter((tag) => !normalizedQuery || tag.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 6)
  }, [availableTags, query])

  const selectSuggestion = (tag: TagDefinition) => {
    onChange(tag.name)
    setQuery('')
    setIsOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }
    if (event.key === 'Enter' && suggestions.length > 0) {
      event.preventDefault()
      selectSuggestion(suggestions[0])
    }
  }

  if (value.trim().length > 0) {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full border border-clay/25 bg-warm-ivory pl-1.5 pr-1 py-0.5'>
        {matchedTag ? <TagChip tag={matchedTag} /> : <span className='text-sm text-espresso'>{value}</span>}
        <button
          type='button'
          aria-label={`Clear ${value}`}
          className='ml-0.5 h-4 w-4 rounded-full text-clay/70 hover:bg-clay/15 hover:text-espresso leading-none'
          onClick={() => onChange('')}
        >
          ×
        </button>
      </span>
    )
  }

  return (
    <div className='relative'>
      <Input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && suggestions.length > 0 ? (
        <div className='absolute left-0 right-0 z-20 mt-1 rounded-lg border border-clay/25 bg-white/97 shadow-lg shadow-espresso/8 backdrop-blur-sm overflow-hidden'>
          <ul className='max-h-44 overflow-auto py-1'>
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type='button'
                  className='w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blush-sand/50 transition-colors'
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(tag)}
                >
                  <TagChip tag={tag} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
