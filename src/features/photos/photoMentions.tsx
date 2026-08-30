import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { Expand, Minimize2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { PhotoAttachment, PhotoCategory } from '../../types'
import { formatPhotoCategory } from './photoUtils'

const DEFAULT_MULTILINE_HEIGHT = 100

export type MentionablePhoto = {
  id: number
  title: string
  category: PhotoCategory
  createdAt: string
}

export type PhotoAttachmentGroup = {
  groupId: string
  createdAt: string
  entries: Array<PhotoAttachment & { id: number }>
  totalByteSize: number
}

export type ReviewablePhotoAttachment = PhotoAttachment & { id: number }

type ActivePhotoMention = {
  start: number
  end: number
  query: string
}

const PHOTO_MENTION_REGEX = /@([^\s@]+)/g

const sanitizeMentionToken = (token: string) => token.trim().replace(/[.,!?;)]*$/g, '')

const findActivePhotoMention = (value: string, caretPosition: number): ActivePhotoMention | null => {
  if (caretPosition < 0 || caretPosition > value.length) return null

  const beforeCaret = value.slice(0, caretPosition)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) return null

  const prefix = beforeCaret.slice(atIndex + 1)
  if (/\s/.test(prefix)) return null

  const charBeforeAt = atIndex > 0 ? value[atIndex - 1] : ''
  if (charBeforeAt && /[\w]/.test(charBeforeAt)) return null

  return {
    start: atIndex,
    end: caretPosition,
    query: prefix,
  }
}

const findMentionedPhotoIds = (text: string, attachmentByTitle: Map<string, MentionablePhoto>) => {
  const mentionedIds = new Set<number>()

  text.replaceAll(PHOTO_MENTION_REGEX, (_fullMatch, token: string) => {
    const mentionedPhoto = attachmentByTitle.get(sanitizeMentionToken(token).toLowerCase())
    if (mentionedPhoto) {
      mentionedIds.add(mentionedPhoto.id)
    }
    return _fullMatch
  })

  return Array.from(mentionedIds)
}

type MentionTextProps = {
  text: string
  attachmentByTitle: Map<string, MentionablePhoto>
  onOpenPhotoById: (attachmentId: number) => void
}

export const MentionText = ({ text, attachmentByTitle, onOpenPhotoById }: MentionTextProps) => {
  const nodes: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(PHOTO_MENTION_REGEX)) {
    const fullMatch = match[0]
    const token = match[1]
    const index = match.index
    if (index === undefined) continue

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }

    const attachment = attachmentByTitle.get(sanitizeMentionToken(token).toLowerCase())
    if (attachment) {
      nodes.push(
        <button
          key={`mention-${index}-${fullMatch}`}
          type='button'
          className='text-action-edit underline underline-offset-2 hover:text-action-edit/80'
          onClick={() => onOpenPhotoById(attachment.id)}
        >
          {fullMatch}
        </button>,
      )
    } else {
      nodes.push(fullMatch)
    }

    lastIndex = index + fullMatch.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return <>{nodes}</>
}

type PhotoMentionFieldProps = {
  value: string
  onChange: (nextValue: string) => void
  ariaLabel: string
  placeholder?: string
  className?: string
  attachments: MentionablePhoto[]
  attachmentByTitle: Map<string, MentionablePhoto>
  onOpenPhotoById: (attachmentId: number) => void
  multiline?: boolean
  autoFocus?: boolean
}

export const PhotoMentionField = ({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
  attachments,
  attachmentByTitle,
  onOpenPhotoById,
  multiline = true,
  autoFocus,
}: PhotoMentionFieldProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [activeMention, setActiveMention] = useState<ActivePhotoMention | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showExpandToggle, setShowExpandToggle] = useState(false)

  const filteredSuggestions = useMemo(() => {
    if (!activeMention) return [] as MentionablePhoto[]
    const query = activeMention.query.toLowerCase()

    return attachments
      .filter((entry) => entry.title.toLowerCase().includes(query))
      .slice(0, 6)
  }, [activeMention, attachments])

  const mentionedPhotoIds = useMemo(
    () => findMentionedPhotoIds(value, attachmentByTitle),
    [attachmentByTitle, value],
  )

  const applyValueChange = (nextValue: string, target: HTMLInputElement | HTMLTextAreaElement) => {
    onChange(nextValue)
    const caretPosition = target.selectionStart ?? nextValue.length
    setActiveMention(findActivePhotoMention(nextValue, caretPosition))
  }

  const selectSuggestion = (attachment: MentionablePhoto) => {
    if (!activeMention) return

    const before = value.slice(0, activeMention.start)
    const after = value.slice(activeMention.end)
    const needsTrailingSpace = after.length === 0 || /^\s/.test(after) ? '' : ' '
    const nextValue = `${before}@${attachment.title}${needsTrailingSpace}${after}`
    const nextCaretPosition = before.length + attachment.title.length + 1 + needsTrailingSpace.length

    onChange(nextValue)
    setActiveMention(null)

    requestAnimationFrame(() => {
      const field = multiline ? textareaRef.current : inputRef.current
      field?.focus()
      field?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleBlur = () => {
    window.setTimeout(() => setActiveMention(null), 120)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      setActiveMention(null)
    }
    if (event.key === 'Enter' && filteredSuggestions.length > 0 && activeMention !== null) {
      event.preventDefault()
      selectSuggestion(filteredSuggestions[0])
    }
  }

  const handleInputSelect = (event: SyntheticEvent<HTMLInputElement>) => {
    const target = event.target as HTMLInputElement
    const caretPosition = target.selectionStart ?? target.value.length
    setActiveMention(findActivePhotoMention(target.value, caretPosition))
  }

  const handleTextareaSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.target as HTMLTextAreaElement
    const caretPosition = target.selectionStart ?? target.value.length
    setActiveMention(findActivePhotoMention(target.value, caretPosition))
  }

  useEffect(() => {
    if (!multiline) return

    const textarea = textareaRef.current
    if (!textarea) return

    const frame = requestAnimationFrame(() => {
      const hasOverflowAtDefaultHeight = textarea.scrollHeight > DEFAULT_MULTILINE_HEIGHT + 1

      if (isExpanded) {
        textarea.style.height = 'auto'
        textarea.style.height = `${textarea.scrollHeight}px`
        setShowExpandToggle(true)
        return
      }

      textarea.style.height = `${DEFAULT_MULTILINE_HEIGHT}px`
      setShowExpandToggle(hasOverflowAtDefaultHeight)
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [isExpanded, multiline, value])

  const toggleExpanded = () => {
    if (!multiline) return

    const textarea = textareaRef.current
    if (!textarea) return

    if (isExpanded) {
      textarea.style.height = `${DEFAULT_MULTILINE_HEIGHT}px`
      setIsExpanded(false)
      return
    }

    textarea.style.height = 'auto'
    requestAnimationFrame(() => {
      const expandedHeight = textarea.scrollHeight
      textarea.style.height = `${expandedHeight}px`
      setIsExpanded(true)
    })
  }

  return (
    <div className='space-y-1'>
      <div className='relative'>
        {multiline ? (
          <>
            {showExpandToggle ? (
              <button
                type='button'
                className='absolute right-0 -top-7 inline-flex h-6 w-6 items-center justify-center rounded border border-clay/30 bg-white/90 text-clay transition-colors hover:bg-blush-sand/60'
                onClick={toggleExpanded}
                aria-label={isExpanded ? 'Collapse text area' : 'Expand text area'}
              >
                {isExpanded ? <Minimize2 className='h-3.5 w-3.5' /> : <Expand className='h-3.5 w-3.5' />}
              </button>
            ) : null}
            <Textarea
              ref={textareaRef}
              aria-label={ariaLabel}
              placeholder={placeholder}
              autoFocus={autoFocus}
              className={cn(
                className,
                'h-25 min-h-25 overflow-auto resize-none transition-[height] duration-200 ease-in-out',
                isExpanded && 'photo-mention-field-expanded',
              )}
              value={value}
              onChange={(event) => applyValueChange(event.target.value, event.target)}
              onSelect={handleTextareaSelect}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
            />
          </>
        ) : (
          <Input
            ref={inputRef}
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className={className}
            value={value}
            onChange={(event) => applyValueChange(event.target.value, event.target)}
            onSelect={handleInputSelect}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
        )}
        {activeMention !== null && filteredSuggestions.length > 0 ? (
          <div className='absolute left-0 right-0 z-20 mt-1 rounded-lg border border-clay/25 bg-white/97 shadow-lg shadow-espresso/8 backdrop-blur-sm overflow-hidden'>
            <ul className='max-h-44 overflow-auto py-1'>
              {filteredSuggestions.map((entry) => (
                <li key={entry.id}>
                  <button
                    type='button'
                    className='w-full px-3 py-2 text-left text-sm hover:bg-blush-sand/50 transition-colors'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(entry)}
                  >
                    <span className='font-semibold text-espresso'>@{entry.title}</span>
                    <span className='ml-2 text-xs text-clay/70 bg-blush-sand px-1.5 py-0.5 rounded-full'>{formatPhotoCategory(entry.category)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {mentionedPhotoIds.length > 0 ? (
        <div className='flex flex-wrap gap-2 text-xs'>
          {mentionedPhotoIds.map((photoId) => {
            const photo = attachments.find((entry) => entry.id === photoId)
            if (!photo) return null

            return (
              <button
                key={`linked-photo-${photoId}`}
                type='button'
                className='rounded border border-action-edit/30 bg-white px-2 py-0.5 text-action-edit hover:bg-action-edit/5'
                onClick={() => onOpenPhotoById(photoId)}
              >
                @{photo.title}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
