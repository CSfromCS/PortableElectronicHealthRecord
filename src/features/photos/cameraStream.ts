/**
 * One shared camera stream for the in-app camera. Browsers (iOS Safari above all) ask for camera
 * access again on every getUserMedia call, so closing the camera dialog and opening it for the next
 * photo meant another prompt each time. The stream is therefore kept for a short while after the
 * dialog closes and handed back out if the camera is opened again, then released so the camera
 * isn't left on.
 */

// Photos are stored at 1600 px on the long side (see photoUtils), so 1920x1080 gives a sharp,
// downscaled result without asking cheap cameras for more than they can do.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
}

/** How long the camera stays on after the dialog closes, waiting for the next photo. */
export const CAMERA_IDLE_RELEASE_MS = 60_000

let sharedStream: MediaStream | null = null
let pendingStream: Promise<MediaStream> | null = null
let releaseTimer: number | undefined

const isLive = (stream: MediaStream | null): stream is MediaStream =>
  stream !== null && stream.getVideoTracks().some((track) => track.readyState === 'live')

const stopSharedStream = () => {
  window.clearTimeout(releaseTimer)
  releaseTimer = undefined
  sharedStream?.getTracks().forEach((track) => track.stop())
  sharedStream = null
}

/** The camera stream, reusing the one from a moment ago when it is still running. */
export const acquireCameraStream = (): Promise<MediaStream> => {
  window.clearTimeout(releaseTimer)
  releaseTimer = undefined
  if (isLive(sharedStream)) return Promise.resolve(sharedStream)

  pendingStream ??= navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    .then((stream) => {
      sharedStream = stream
      return stream
    })
    .finally(() => { pendingStream = null })
  return pendingStream
}

/** Called when the dialog closes: keeps the stream for the next photo, then switches the camera off. */
export const releaseCameraStream = (immediately = false): void => {
  if (immediately) {
    stopSharedStream()
    return
  }
  window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(stopSharedStream, CAMERA_IDLE_RELEASE_MS)
}

// A page that is hidden or being closed must not keep the camera on.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopSharedStream()
  })
  window.addEventListener('pagehide', stopSharedStream)
}
