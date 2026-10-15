const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 256
const SALT_BYTES = 16
const IV_BYTES = 12

type PackedCipherPayload = {
  version: 1
  salt: string
  iv: string
  ciphertext: string
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value)
  const output = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index)
  }

  return output
}

const getCrypto = (): Crypto => {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser.')
  }

  return window.crypto
}

const toCryptoBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copiedBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copiedBuffer).set(bytes)
  return copiedBuffer
}

/** gzip with the platform's stream API; absent only on browsers older than 2023. */
const gzip = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([toCryptoBuffer(bytes)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const gunzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read the compressed sync data. Update your browser.')
  }
  const stream = new Blob([toCryptoBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const deriveEncryptionKey = async (roomCode: string, salt: Uint8Array): Promise<CryptoKey> => {
  const crypto = getCrypto()
  const roomCodeKeyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(roomCode),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toCryptoBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    roomCodeKeyMaterial,
    {
      name: 'AES-GCM',
      length: KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await getCrypto().subtle.digest('SHA-256', textEncoder.encode(value))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Blob format v2: "2." + base64 of [flag | salt | iv | AES-GCM ciphertext]. The flag says whether the
// plaintext was gzipped before encrypting; it is also the GCM additional data, so it can't be
// changed without the decrypt failing. Compressing before encrypting is safe here: the snapshot is
// the user's own data, never mixed with anything an outsider chooses, so there is no
// chosen-plaintext length oracle. v1 blobs (base64 of a JSON envelope) are still readable.
const BLOB_V2_PREFIX = '2.'
const FLAG_PLAIN = 0
const FLAG_GZIP = 1
/** Cap on decompressed size, so a corrupted blob can't expand without bound. */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024

export const encryptPayloadToBlob = async (payload: unknown, roomCode: string): Promise<string> => {
  const crypto = getCrypto()
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encryptionKey = await deriveEncryptionKey(roomCode, salt)
  const plaintextBytes = textEncoder.encode(JSON.stringify(payload))
  const compressed = await gzip(plaintextBytes)
  const useGzip = compressed !== null && compressed.length < plaintextBytes.length
  const flag = new Uint8Array([useGzip ? FLAG_GZIP : FLAG_PLAIN])
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toCryptoBuffer(iv),
      additionalData: toCryptoBuffer(flag),
    },
    encryptionKey,
    toCryptoBuffer(useGzip ? compressed : plaintextBytes),
  )

  const packed = new Uint8Array(1 + SALT_BYTES + IV_BYTES + encryptedBuffer.byteLength)
  packed.set(flag, 0)
  packed.set(salt, 1)
  packed.set(iv, 1 + SALT_BYTES)
  packed.set(new Uint8Array(encryptedBuffer), 1 + SALT_BYTES + IV_BYTES)
  return BLOB_V2_PREFIX + bytesToBase64(packed)
}

const isPackedCipherPayload = (value: unknown): value is PackedCipherPayload => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>

  return (
    candidate.version === 1
    && typeof candidate.salt === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.ciphertext === 'string'
  )
}

const parseJson = <T>(bytes: Uint8Array): T => {
  try {
    return JSON.parse(textDecoder.decode(bytes)) as T
  } catch {
    throw new Error('Decrypted payload is not valid JSON.')
  }
}

const decryptBlobV2 = async <T>(blob: string, roomCode: string): Promise<T> => {
  let packed: Uint8Array
  try {
    packed = base64ToBytes(blob.slice(BLOB_V2_PREFIX.length))
  } catch {
    throw new Error('Encrypted payload format is invalid.')
  }
  if (packed.length <= 1 + SALT_BYTES + IV_BYTES) throw new Error('Encrypted payload format is invalid.')

  const flag = packed.subarray(0, 1)
  if (flag[0] !== FLAG_PLAIN && flag[0] !== FLAG_GZIP) throw new Error('Encrypted payload format is invalid.')
  const salt = packed.subarray(1, 1 + SALT_BYTES)
  const iv = packed.subarray(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES)
  const ciphertext = packed.subarray(1 + SALT_BYTES + IV_BYTES)

  const decryptionKey = await deriveEncryptionKey(roomCode, salt)
  let decrypted: Uint8Array
  try {
    decrypted = new Uint8Array(await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: toCryptoBuffer(iv), additionalData: toCryptoBuffer(flag) },
      decryptionKey,
      toCryptoBuffer(ciphertext),
    ))
  } catch {
    throw new Error('Unable to decrypt data. Check room code.')
  }

  const plaintext = flag[0] === FLAG_GZIP ? await gunzip(decrypted) : decrypted
  if (plaintext.length > MAX_DECOMPRESSED_BYTES) throw new Error('Decrypted payload is too large.')
  return parseJson<T>(plaintext)
}

export const decryptBlobToPayload = async <T>(blob: string, roomCode: string): Promise<T> => {
  if (blob.startsWith(BLOB_V2_PREFIX)) return decryptBlobV2<T>(blob, roomCode)

  const packedText = textDecoder.decode(base64ToBytes(blob))
  let packed: unknown

  try {
    packed = JSON.parse(packedText) as unknown
  } catch {
    throw new Error('Encrypted payload format is invalid.')
  }

  if (!isPackedCipherPayload(packed)) {
    throw new Error('Encrypted payload is missing required fields.')
  }

  const salt = base64ToBytes(packed.salt)
  const iv = base64ToBytes(packed.iv)
  const ciphertext = base64ToBytes(packed.ciphertext)

  const decryptionKey = await deriveEncryptionKey(roomCode, salt)

  let decrypted: ArrayBuffer
  try {
    decrypted = await getCrypto().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toCryptoBuffer(iv),
      },
      decryptionKey,
      toCryptoBuffer(ciphertext),
    )
  } catch {
    throw new Error('Unable to decrypt data. Check room code.')
  }

  return parseJson<T>(new Uint8Array(decrypted))
}
