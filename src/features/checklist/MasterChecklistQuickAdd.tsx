import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Patient } from '@/types'

type MasterChecklistQuickAddProps = {
  /** Active patients only, already sorted for display. */
  patients: Patient[]
  onAdd: (patientId: number, text: string) => void
}

const patientLabel = (patient: Patient) => `${patient.roomNumber} — ${patient.lastName}, ${patient.firstName}`

export const MasterChecklistQuickAdd = ({ patients, onAdd }: MasterChecklistQuickAddProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [patientQuery, setPatientQuery] = useState('')
  const [isPatientListOpen, setIsPatientListOpen] = useState(false)
  const [itemText, setItemText] = useState('')
  const itemInputRef = useRef<HTMLInputElement>(null)

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  )

  const suggestions = useMemo(() => {
    const normalizedQuery = patientQuery.trim().toLowerCase()
    if (!normalizedQuery) return patients.slice(0, 6)
    return patients
      .filter((patient) => `${patient.roomNumber} ${patient.lastName} ${patient.firstName}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 6)
  }, [patients, patientQuery])

  const reset = () => {
    setIsOpen(false)
    setSelectedPatientId(null)
    setPatientQuery('')
    setIsPatientListOpen(false)
    setItemText('')
  }

  const selectPatientSuggestion = (patient: Patient) => {
    if (patient.id === undefined) return
    setSelectedPatientId(patient.id)
    setPatientQuery('')
    setIsPatientListOpen(false)
    window.setTimeout(() => itemInputRef.current?.focus(), 0)
  }

  const submitItem = () => {
    const nextText = itemText.trim()
    if (!nextText || selectedPatientId == null) return
    onAdd(selectedPatientId, nextText)
    setItemText('')
    itemInputRef.current?.focus()
  }

  const handlePatientKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsPatientListOpen(false)
      return
    }
    if (event.key === 'Enter' && suggestions.length > 0) {
      selectPatientSuggestion(suggestions[0])
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
          value={selectedPatient ? patientLabel(selectedPatient) : patientQuery}
          onChange={(event) => {
            setSelectedPatientId(null)
            setPatientQuery(event.target.value)
            setIsPatientListOpen(true)
          }}
          onFocus={() => {
            setSelectedPatientId(null)
            setPatientQuery('')
            setIsPatientListOpen(true)
          }}
          onBlur={() => window.setTimeout(() => setIsPatientListOpen(false), 120)}
          onKeyDown={handlePatientKeyDown}
        />
        {isPatientListOpen && suggestions.length > 0 ? (
          <div className='absolute left-0 right-0 z-20 mt-1 rounded-lg border border-clay/25 bg-white/97 shadow-lg shadow-espresso/8 backdrop-blur-sm overflow-hidden'>
            <ul className='max-h-44 overflow-auto py-1'>
              {suggestions.map((patient) => (
                <li key={patient.id}>
                  <button
                    type='button'
                    className='w-full px-3 py-2 text-left text-sm hover:bg-blush-sand/50 transition-colors'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectPatientSuggestion(patient)}
                  >
                    {patientLabel(patient)}
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
        disabled={!selectedPatient}
      />
      <Button
        type='button'
        variant='secondary'
        size='sm'
        onClick={submitItem}
        disabled={!selectedPatient || itemText.trim().length === 0}
      >
        Add
      </Button>
      <Button type='button' variant='ghost' size='icon' className='h-9 w-9' onClick={reset} aria-label='Close add item form'>
        <X className='h-4 w-4' aria-hidden='true' />
      </Button>
    </div>
  )
}
