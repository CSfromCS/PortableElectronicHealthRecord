import { useMemo, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { TagDefinition } from '@/types'
import { findServiceTagByName } from './serviceTagUtils'
import { TagChip, type TagChipRoleMarker } from './TagChip'

type ServiceTagMultiSelectProps = {
  ariaLabel: string
  placeholder?: string
  /** Which role this instance manages; rendered as a small M/R badge on each chip so Main and Referral tags stay distinguishable even though they're drawn from the same shared tag pool. */
  role: 'main' | 'referral'
  selectedTags: TagDefinition[]
  availableTags: TagDefinition[]
  onAdd: (tag: TagDefinition) => void
  onRemove: (tag: TagDefinition) => void
  onCreate: (name: string) => void
  /** Overrides the input's default bordered-box look — e.g. the Profile tab passes a seamless,
   * hover-only-border style to match its other lightweight fields and take up less visual space. */
  inputClassName?: string
}

export const ServiceTagMultiSelect = ({
  ariaLabel,
  placeholder,
  role,
  selectedTags,
  availableTags,
  onAdd,
  onRemove,
  onCreate,
  inputClassName,
}: ServiceTagMultiSelectProps) => {
  const roleMarker: TagChipRoleMarker = role === 'main' ? 'M' : 'R'
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const selectedIds = useMemo(() => new Set(selectedTags.map((tag) => tag.id)), [selectedTags])

  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return availableTags
      .filter((tag) => tag.id === undefined || !selectedIds.has(tag.id))
      .filter((tag) => !normalizedQuery || tag.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 6)
  }, [availableTags, query, selectedIds])

  const trimmedQuery = query.trim()
  const hasExactMatch = trimmedQuery.length > 0 && findServiceTagByName(trimmedQuery, availableTags) !== undefined
  const canCreate = trimmedQuery.length > 0 && !hasExactMatch

  const selectSuggestion = (tag: TagDefinition) => {
    onAdd(tag)
    setQuery('')
    setIsOpen(false)
  }

  const createFromQuery = () => {
    if (!canCreate) return
    onCreate(trimmedQuery)
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
      if (suggestions.length > 0) {
        selectSuggestion(suggestions[0])
      } else {
        createFromQuery()
      }
    }
  }

  return (
    <div className='space-y-1'>
      {selectedTags.length > 0 ? (
        <div className='flex flex-wrap gap-1.5'>
          {selectedTags.map((tag) => (
            <span
              key={tag.id}
              className='inline-flex items-center gap-1 rounded-full border border-clay/25 bg-warm-ivory pl-1.5 pr-1 py-0.5'
            >
              <TagChip tag={tag} roleMarker={roleMarker} />
              <button
                type='button'
                aria-label={`Remove ${tag.name}`}
                className='ml-0.5 h-4 w-4 rounded-full text-clay/70 hover:bg-clay/15 hover:text-espresso leading-none'
                onClick={() => onRemove(tag)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
          className={inputClassName}
        />
        {isOpen && (suggestions.length > 0 || canCreate) ? (
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
                    <TagChip tag={tag} roleMarker={roleMarker} />
                  </button>
                </li>
              ))}
              {canCreate ? (
                <li>
                  <button
                    type='button'
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm text-action-edit hover:bg-blush-sand/50 transition-colors',
                      suggestions.length > 0 && 'border-t border-clay/15',
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={createFromQuery}
                  >
                    Create "{trimmedQuery}"
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
