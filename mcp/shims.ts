// Must be the first import of the bridge. PUHRR's own code expects a browser (IndexedDB through
// Dexie, window.crypto, localStorage); the bridge runs the very same code in Node, so what a
// template renders here is what it renders on a phone. Nothing here is persisted: the room is
// downloaded into memory on start and thrown away on exit.
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'

// Reports print "today" and the current time, so the process must tell time the way the hospital
// does, not the way the VPS does.
process.env.TZ = process.env.PUHRR_TIMEZONE ?? process.env.TZ ?? 'Asia/Manila'

const memoryStorage = new Map<string, string>()
const localStorageShim = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStorage.set(key, value) },
  removeItem: (key: string) => { memoryStorage.delete(key) },
}

Object.defineProperty(globalThis, 'window', {
  value: { crypto: webcrypto, localStorage: localStorageShim },
  configurable: true,
})
