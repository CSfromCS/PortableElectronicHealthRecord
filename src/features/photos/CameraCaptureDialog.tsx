import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, ChevronLeft, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type CapturedShot = {
  id: number
  blob: Blob
  previewUrl: string
}

export type CameraCaptureDialogProps = {
  open: boolean
  /** Shown in the top bar — e.g. "Adding to bundle" when the session targets an existing bundle
   * rather than starting a new one. */
  subtitle: string
  onClose: () => void
  onDone: (files: File[]) => void
}

/**
 * A live in-app camera (via getUserMedia) so a user can fire off several shots in a row without
 * leaving the app to the OS camera each time — `<input capture>` can only ever return one photo
 * per invocation, which is what this replaces (issue #131 point 1, follow-up request). Falls back
 * to the OS camera app (the old `<input capture>` flow) when getUserMedia is unavailable or denied.
 */
// Doesn't change over the page's lifetime, so it's read once at module scope rather than
// re-derived as state — keeps the "unsupported" case out of the effect below entirely.
const isCameraSupported = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

export function CameraCaptureDialog({ open, subtitle, onClose, onDone }: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fallbackInputRef = useRef<HTMLInputElement | null>(null)
  const stripScrollRef = useRef<HTMLDivElement | null>(null)
  const nextShotIdRef = useRef(0)
  const [captures, setCaptures] = useState<CapturedShot[]>([])
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [stripFade, setStripFade] = useState({ left: false, right: false })
  const error = isCameraSupported ? permissionError : 'In-app camera is unavailable on this device/browser.'

  // Hints that the capture strip has more thumbnails scrolled off one edge or the other.
  const updateStripFade = () => {
    const el = stripScrollRef.current
    if (!el) return
    setStripFade({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }

  useEffect(() => {
    updateStripFade()
  }, [captures])

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  // The caller remounts this component with a fresh `key` each time it opens a new session (see
  // App.tsx's openCameraForNewBundle/openCameraForGroup), so `permissionError`/`captures` always
  // start clean here — no manual reset-on-close/reopen needed.
  useEffect(() => {
    if (!open || !isCameraSupported) return undefined

    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => {
        if (!cancelled) setPermissionError('Camera access was denied or is unavailable.')
      })

    return () => {
      cancelled = true
      stopStream()
    }
  }, [open])

  const captureShot = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      const id = nextShotIdRef.current++
      setCaptures((previous) => [...previous, { id, blob, previewUrl: URL.createObjectURL(blob) }])
    }, 'image/jpeg', 0.92)
  }

  const removeShot = (id: number) => {
    setCaptures((previous) => {
      const target = previous.find((shot) => shot.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return previous.filter((shot) => shot.id !== id)
    })
  }

  const handleFallbackFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'))
    event.target.value = ''
    if (files.length === 0) return
    setCaptures((previous) => [
      ...previous,
      ...files.map((file) => ({ id: nextShotIdRef.current++, blob: file, previewUrl: URL.createObjectURL(file) })),
    ])
  }

  const handleClose = () => {
    stopStream()
    onClose()
  }

  const handleDone = () => {
    const files = captures.map((shot, index) => new File([shot.blob], `capture-${index + 1}.jpg`, { type: shot.blob.type || 'image/jpeg' }))
    stopStream()
    onDone(files)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose() }}>
      <DialogContent showCloseButton={false} className='flex flex-col gap-0 p-0 border-0 overflow-hidden bg-black w-[95vw] max-w-3xl h-[95vh] max-h-[95vh] md:h-[92vh] md:max-h-[92vh]'>
        <DialogTitle className='sr-only'>Take photos</DialogTitle>
        <div className='relative flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-black'>
          {!error ? (
            <video ref={videoRef} autoPlay playsInline muted className='h-full w-full object-cover' />
          ) : (
            <div className='flex flex-col items-center gap-3 p-6 text-center text-white'>
              <p className='text-sm'>{error}</p>
              <Button size='sm' variant='secondary' onClick={() => fallbackInputRef.current?.click()}>
                Use device camera app instead
              </Button>
            </div>
          )}
          <input
            ref={fallbackInputRef}
            type='file'
            accept='image/*'
            capture='environment'
            className='hidden'
            onChange={handleFallbackFiles}
          />

          <div className='absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent'>
            <button
              type='button'
              aria-label='Close camera'
              className='h-9 w-9 shrink-0 rounded-full bg-black/45 text-white flex items-center justify-center'
              onClick={handleClose}
            >
              <ChevronLeft className='h-5 w-5' />
            </button>
            <p className='flex-1 min-w-0 truncate text-center text-sm font-medium text-white'>
              {subtitle}{captures.length > 0 ? ` — ${captures.length} captured` : ''}
            </p>
            <div className='h-9 w-9 shrink-0' aria-hidden='true' />
          </div>

          <div className='absolute inset-x-0 bottom-0 space-y-2 p-3 bg-gradient-to-t from-black/70 to-transparent'>
            {captures.length > 0 ? (
              <div className='relative'>
                <div ref={stripScrollRef} onScroll={updateStripFade} className='w-full overflow-x-auto overflow-y-hidden touch-pan-x'>
                  <div className='flex w-max gap-1.5'>
                    {captures.map((shot) => (
                      <div key={shot.id} className='relative h-14 w-14 shrink-0 rounded border border-white/30 overflow-hidden'>
                        <img src={shot.previewUrl} alt='Captured' className='h-full w-full object-cover' />
                        <button
                          type='button'
                          aria-label='Discard this photo'
                          className='absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-black/70 text-white flex items-center justify-center'
                          onClick={() => removeShot(shot.id)}
                        >
                          <Trash2 className='h-2.5 w-2.5' />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                {stripFade.left ? (
                  <div className='pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/70 to-transparent' aria-hidden='true' />
                ) : null}
                {stripFade.right ? (
                  <div className='pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/70 to-transparent' aria-hidden='true' />
                ) : null}
              </div>
            ) : null}
            <div className='flex items-center justify-between gap-3'>
              <div className='w-16' aria-hidden='true' />
              <button
                type='button'
                aria-label='Take photo'
                disabled={!!error}
                className='h-16 w-16 rounded-full border-4 border-white bg-white/20 disabled:opacity-40 flex items-center justify-center'
                onClick={captureShot}
              >
                <Camera className='h-6 w-6 text-white' aria-hidden='true' />
              </button>
              <div className='w-16 flex justify-end'>
                <Button size='sm' disabled={captures.length === 0} onClick={handleDone}>
                  Done{captures.length > 0 ? ` (${captures.length})` : ''}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
