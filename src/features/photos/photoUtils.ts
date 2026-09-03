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
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${label}_${month}-${day}`
}

/** Converts a 1-based index to a lowercase spreadsheet-column-style suffix: 1 -> "a", 26 -> "z",
 * 27 -> "aa", 28 -> "ab", etc. */
export const letterSuffixForIndex = (index: number): string => {
  let remaining = index
  let result = ''
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26
    result = String.fromCharCode(97 + remainder) + result
    remaining = Math.floor((remaining - 1) / 26)
  }
  return result
}

/** Inverse of `letterSuffixForIndex`. Returns null for anything that isn't a run of lowercase
 * letters (i.e. not a suffix this scheme could have generated). */
const letterSuffixToIndex = (suffix: string): number | null => {
  if (!/^[a-z]+$/.test(suffix)) return null
  let index = 0
  for (const character of suffix) {
    index = index * 26 + (character.charCodeAt(0) - 96)
  }
  return index
}

export type DefaultTitledPhotoBatch = {
  groupId: string
  title: string
}

export type DefaultPhotoTitleAssignment = {
  /** The title to use for the new batch. */
  title: string
  /** Other same-day default-titled batches that must be retitled alongside this one (only ever
   * the bare, unsuffixed batch — retroactively gaining the "a" suffix the first time a
   * collision occurs). */
  retitledBatches: DefaultTitledPhotoBatch[]
}

/**
 * Resolves the default title for a newly created batch given every other batch already sharing
 * the same category+day and still at its own default title. `existingSameDayDefaultBatches`
 * must be pre-filtered to that scope (same patient, same category, same local day,
 * `isDefaultTitle === true`) — batches the user has already retitled must never be passed in,
 * since they're no longer part of the collision pool.
 */
export const resolveDefaultPhotoBatchTitle = (
  baseTitle: string,
  existingSameDayDefaultBatches: DefaultTitledPhotoBatch[],
): DefaultPhotoTitleAssignment => {
  if (existingSameDayDefaultBatches.length === 0) {
    return { title: baseTitle, retitledBatches: [] }
  }

  let highestSuffixIndex = 0
  let bareBatch: DefaultTitledPhotoBatch | null = null

  for (const batch of existingSameDayDefaultBatches) {
    if (batch.title === baseTitle) {
      bareBatch = batch
      continue
    }

    if (!batch.title.startsWith(baseTitle)) continue
    const suffixIndex = letterSuffixToIndex(batch.title.slice(baseTitle.length))
    if (suffixIndex !== null) {
      highestSuffixIndex = Math.max(highestSuffixIndex, suffixIndex)
    }
  }

  const retitledBatches: DefaultTitledPhotoBatch[] = []
  if (bareBatch) {
    retitledBatches.push({ groupId: bareBatch.groupId, title: `${baseTitle}${letterSuffixForIndex(1)}` })
    highestSuffixIndex = Math.max(highestSuffixIndex, 1)
  }

  return {
    title: `${baseTitle}${letterSuffixForIndex(highestSuffixIndex + 1)}`,
    retitledBatches,
  }
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
