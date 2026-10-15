// Sets the passphrase that signs a client in to the remote MCP server. Run it in a terminal you can type in
// (over ssh, use `ssh -t`): the passphrase is read without being shown and only its hash is saved.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { hashPassphrase } from './oauth'

const MIN_LENGTH = 12

const readHidden = (prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY) { reject(new Error('This needs a terminal. Over ssh, use `ssh -t`.')); return }
    process.stderr.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')
    let value = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { finish(); resolve(value); return }
        if (ch === '\u0003') { finish(); reject(new Error('Cancelled.')); return }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    const finish = () => {
      input.removeListener('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stderr.write('\n')
    }
    input.on('data', onData)
  })

const main = async () => {
  const file = process.env.PUHRR_OAUTH_PASSPHRASE_FILE?.trim()
  if (!file) throw new Error('Set PUHRR_OAUTH_PASSPHRASE_FILE to the file the hash should be saved in.')
  const first = await readHidden(`New passphrase (at least ${MIN_LENGTH} characters): `)
  if (first.length < MIN_LENGTH) throw new Error(`That is too short: use at least ${MIN_LENGTH} characters (a few random words work well).`)
  const second = await readHidden('Type it again: ')
  if (first !== second) throw new Error('The two did not match. Nothing was saved.')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${await hashPassphrase(first)}\n`, { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* not supported everywhere */ }
  console.error(`Saved. Restart the remote server so it uses the new passphrase (existing sign-ins stay valid until you delete ${file}.state.json).`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
