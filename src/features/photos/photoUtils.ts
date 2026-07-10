import type { PhotoAttachment, PhotoCategory } from '../../types'

export const PHOTO_CATEGORY_OPTIONS: { value: PhotoCategory; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'problems', label: 'Problems' },
  { value: 'vitals', label: 'Vitals' },
  { value: 'medications', label: 'Medications' },
  { value: 'labs', label: 'Labs' },
  { value: 'orders', label: 'Orders' },
]

const PHOTO_MAX_DIMENSION = 1600
const PHOTO_JPEG_QUALITY = 0.72

export const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

export const formatPhotoCategory = (category: PhotoCategory) => {
  const entry = PHOTO_CATEGORY_OPTIONS.find((option) => option.value === category)
  return entry?.label ?? category
}

export const buildDefaultPhotoTitle = (category: PhotoCategory, date = new Date()) => {
  const label = formatPhotoCategory(category)
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  return `${label}-${year}-${month}-${day}-${hours}:${minutes}:${seconds}`
}

export const buildPhotoUploadGroupId = () => {
  const randomToken = Math.random().toString(36).slice(2, 10)
  return `group-${Date.now()}-${randomToken}`
}

export const getPhotoGroupKey = (attachment: PhotoAttachment) => {
  if (attachment.uploadGroupId && attachment.uploadGroupId.trim().length > 0) {
    return attachment.uploadGroupId
  }
  return `legacy-${attachment.id ?? attachment.createdAt}`
}

const loadImageElementFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Unable to decode image.'))
    }

    image.src = objectUrl
  })

export const compressImageFile = async (file: File) => {
  const image = await loadImageElementFromFile(file)
  const sourceWidth = image.naturalWidth
  const sourceHeight = image.naturalHeight
  const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight))
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to prepare image.')
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result)
          return
        }
        reject(new Error('Unable to compress image.'))
      },
      'image/jpeg',
      PHOTO_JPEG_QUALITY,
    )
  })

  return {
    blob,
    width: targetWidth,
    height: targetHeight,
    mimeType: 'image/jpeg',
  }
}
