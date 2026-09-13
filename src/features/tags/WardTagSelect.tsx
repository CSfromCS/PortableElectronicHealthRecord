import { useMemo, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import type { TagDefinition } from '@/types'
import { TagChip } from './TagChip'
import { findWardTagByName, isWardTagCustomized } from './wardTagUtils'

type WardTagSelectProps = {
  ariaLabel: string
  placeholder?: string
  /** The patient's current ward tag, or undefined if none assigned. */
  value: TagDefinition | undefined
  availableTags: TagDefinition[]
  onSelectExisting: (tagId: number) => void
  /** Name doesn't match any existing ward tag — caller creates one (see getOrCreateWardTag) and selects it. */
  onCreateAndSelect: (name: string) => void
  onClear: () => void
}

/** Single-select, id-based ward picker — mirrors ServiceTagSelect's combo UX, but shows the
 * assigned ward as plain text (matching the old free-text field) rather than a chip, unless
 * the tag has actually been styled — see `isWardTagCustomized`. */
export const WardTagSelect = ({ ariaLabel, placeholder, value, availableTags, onSelectExisting, onCreateAndSelect, onClear }: WardTagSelectProps) => {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return availableTags.filter((tag) => !normalizedQuery || tag.name.toLowerCase().includes(normalizedQuery))
  }, [availableTags, query])

  const exactMatch = useMemo(() => findWardTagByName(query, availableTags), [query, availableTags])

  const selectSuggestion = (tag: TagDefinition) => {
    if (tag.id !== undefined) onSelectExisting(tag.id)
    setQuery('')
    setIsOpen(false)
  }

  const commitQuery = () => {
    const trimmed = query.trim()
    if (!trimmed) return
    if (exactMatch) {
      selectSuggestion(exactMatch)
      return
    }
    onCreateAndSelect(trimmed)
    setQuery('')
    setIsOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      commitQuery()
    }
  }

  if (value) {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full border border-clay/25 bg-warm-ivory pl-1.5 pr-1 py-0.5'>
        {isWardTagCustomized(value) ? <TagChip tag={value} /> : <span className='text-sm text-espresso'>{value.name}</span>}
        <button
          type='button'
          aria-label={`Clear ${value.name}`}
          className='ml-0.5 h-4 w-4 rounded-full text-clay/70 hover:bg-clay/15 hover:text-espresso leading-none'
          onClick={onClear}
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
      {isOpen && (suggestions.length > 0 || query.trim().length > 0) ? (
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
                  {isWardTagCustomized(tag) ? <TagChip tag={tag} /> : <span>{tag.name}</span>}
                </button>
              </li>
            ))}
            {query.trim().length > 0 && !exactMatch ? (
              <li>
                <button
                  type='button'
                  className='w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-clay/80 hover:bg-blush-sand/50 transition-colors'
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={commitQuery}
                >
                  Add "{query.trim()}"
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
