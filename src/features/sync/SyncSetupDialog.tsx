import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff } from 'lucide-react'
import { sha256Hex } from './crypto'

export type SetupDeviceName = string
export type SetupUsername = string

type SyncSetupDialogProps = {
  open: boolean
  title?: string
  submitLabel?: string
  initialRoomCode?: string
  initialDeviceName?: SetupDeviceName
  initialUsername?: SetupUsername
  onOpenChange: (open: boolean) => void
  onSubmit: (params: { roomCode: string; deviceName: SetupDeviceName; username: SetupUsername }) => Promise<void>
}

export function SyncSetupDialog({
  open,
  title = 'Set up sync',
  submitLabel = 'Save & Sync',
  initialRoomCode = '',
  initialDeviceName = 'Phone',
  initialUsername = '',
  onOpenChange,
  onSubmit,
}: SyncSetupDialogProps) {
  const [roomCode, setRoomCode] = useState('')
  const [deviceName, setDeviceName] = useState<SetupDeviceName>('Phone')
  const [username, setUsername] = useState<SetupUsername>('')
  const [roomTagPreview, setRoomTagPreview] = useState('-----')
  const [isSaving, setIsSaving] = useState(false)
  const [showRoomCode, setShowRoomCode] = useState(false)

  const deviceTagPreview = useMemo(() => `${roomTagPreview}-${deviceName}`, [deviceName, roomTagPreview])

  const refreshRoomTagPreview = async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) {
      setRoomTagPreview('-----')
      return
    }

    const roomHash = await sha256Hex(trimmed)
    setRoomTagPreview(roomHash.slice(0, 5))
  }

  useEffect(() => {
    if (!open) return

    const prefilledRoomCode = initialRoomCode.trim()
    setRoomCode(prefilledRoomCode)
    setDeviceName(initialDeviceName)
    setUsername(initialUsername)
    setShowRoomCode(false)

    void refreshRoomTagPreview(prefilledRoomCode)
  }, [initialDeviceName, initialRoomCode, initialUsername, open])

  const handleSubmit = async () => {
    if (!roomCode.trim() || !deviceName.trim() || !username.trim()) return

    setIsSaving(true)
    try {
      await onSubmit({
        roomCode: roomCode.trim(),
        deviceName: deviceName.trim(),
        username: username.trim(),
      })
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='sync-room-code'>Room key</Label>
            <p className='text-xs text-clay'>Use the same Room key on your phone and laptop to join the same encrypted sync room.</p>
            <div className='relative'>
              <Input
                id='sync-room-code'
                type={showRoomCode ? 'text' : 'password'}
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(event.target.value)
                  void refreshRoomTagPreview(event.target.value)
                }}
                placeholder='Enter room key'
                autoComplete='off'
              />
              <button
                type='button'
                onClick={() => setShowRoomCode((previous) => !previous)}
                className='absolute right-2 top-1/2 -translate-y-1/2 text-clay'
                aria-label='Toggle room code visibility'
              >
                {showRoomCode ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
              </button>
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sync-username'>Your name</Label>
            <Input
              id='sync-username'
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder='Juan Dela Cruz'
              autoComplete='name'
            />
            <p className='text-xs text-clay'>Your name to as <strong>username</strong> to keep track.</p>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sync-device-name'>Device name</Label>
            <Input
              id='sync-device-name'
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder='Phone'
              autoComplete='off'
            />
            <p className='text-xs text-clay'>Use a unique name per device (example: Phone, Clerk-Laptop) so you can tell where each sync came from.</p>
          </div>
          <div className='rounded-md border border-clay/25 bg-blush-sand/45 p-2'>
            <p className='text-xs text-clay'>Device tag</p>
            <p className='text-sm font-semibold text-espresso'>{deviceTagPreview}</p>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='secondary' onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={isSaving || roomCode.trim().length === 0 || deviceName.trim().length === 0 || username.trim().length === 0}>
              {isSaving ? 'Saving...' : submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
