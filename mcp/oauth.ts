// Sign-in for the remote MCP server (OAuth 2.1 authorization code + PKCE, with dynamic client registration).
//
// There is one owner. A client (an MCP-capable app) registers itself, sends the owner to the sign-in page, and the owner
// proves it is them with a passphrase and chooses what the client may do: read only, or read and edit. The client then
// holds an access token (1 hour) and a refresh token (30 days) that can be revoked. Only hashes of tokens are stored.
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { Request, RequestHandler, Response } from 'express'
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

export const SCOPE_READ = 'puhrr:read'
export const SCOPE_WRITE = 'puhrr:write'

const ACCESS_TOKEN_SECONDS = 60 * 60
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
const CODE_SECONDS = 5 * 60
const PENDING_SECONDS = 10 * 60
const MAX_CLIENTS = 50
const MAX_FAILURES = 5
const LOCKOUT_MS = 15 * 60 * 1000
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** Where a client may send the owner back to. Loopback addresses (any port) are always allowed, for apps on this computer. */
const DEFAULT_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

// ---- passphrase ------------------------------------------------------------------------------------------------

/** "scrypt$N$r$p$salt$hash" (base64). */
export const hashPassphrase = async (passphrase: string): Promise<string> => {
  const salt = randomBytes(16)
  const hash = await scrypt(passphrase, salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export const verifyPassphrase = async (passphrase: string, stored: string): Promise<boolean> => {
  const [scheme, n, r, p, salt, hash] = stored.trim().split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(passphrase, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ---- stored state ----------------------------------------------------------------------------------------------

type StoredToken = { kind: 'access' | 'refresh'; clientId: string; scopes: string[]; expiresAt: number }
type State = { clients: Record<string, OAuthClientInformationFull>; tokens: Record<string, StoredToken> }
type PendingAuthorization = { client: OAuthClientInformationFull; params: AuthorizationParams; expiresAt: number }
type IssuedCode = { clientId: string; codeChallenge: string; redirectUri: string; scopes: string[]; expiresAt: number }

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const nowSeconds = (): number => Math.floor(Date.now() / 1000)
const newSecret = (prefix: string): string => `${prefix}_${randomBytes(32).toString('base64url')}`

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

export type OAuthOptions = {
  /** The https URL this server is reached at (no path). */
  publicUrl: URL
  /** The stored passphrase hash (see hashPassphrase). */
  passphraseHash: string
  /** JSON file for registered clients and tokens, so a restart does not sign anyone out. */
  stateFile: string
  /** Whether "read and edit" is offered at all. */
  allowWrites: boolean
  /** Extra redirect URIs to accept besides Claude's and loopback addresses. */
  extraRedirects?: string[]
}

export class PuhrrOAuthProvider implements OAuthServerProvider {
  private readonly options: OAuthOptions
  private readonly redirects: Set<string>
  private state: State = { clients: {}, tokens: {} }
  private readonly pending = new Map<string, PendingAuthorization>()
  private readonly codes = new Map<string, IssuedCode>()
  private failures: number[] = []
  readonly mcpUrl: URL

  constructor(options: OAuthOptions) {
    this.options = options
    this.redirects = new Set([...DEFAULT_REDIRECTS, ...(options.extraRedirects ?? [])])
    this.mcpUrl = new URL('/mcp', options.publicUrl)
    this.load()
    const sweep = setInterval(() => this.purge(), 10 * 60 * 1000)
    sweep.unref()
  }

  // -- persistence --

  private load(): void {
    if (!existsSync(this.options.stateFile)) return
    try {
      const parsed = JSON.parse(readFileSync(this.options.stateFile, 'utf8')) as Partial<State>
      this.state = { clients: parsed.clients ?? {}, tokens: parsed.tokens ?? {} }
      this.purge()
    } catch {
      // A damaged file means everyone signs in again; never block the server on it.
      this.state = { clients: {}, tokens: {} }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.options.stateFile), { recursive: true })
    const temporary = `${this.options.stateFile}.tmp`
    writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 })
    renameSync(temporary, this.options.stateFile)
    try { chmodSync(this.options.stateFile, 0o600) } catch { /* not supported everywhere */ }
  }

  private purge(): void {
    const now = nowSeconds()
    let changed = false
    for (const [key, token] of Object.entries(this.state.tokens)) {
      if (token.expiresAt <= now) { delete this.state.tokens[key]; changed = true }
    }
    for (const [key, value] of this.pending) if (value.expiresAt <= Date.now()) this.pending.delete(key)
    for (const [key, value] of this.codes) if (value.expiresAt <= Date.now()) this.codes.delete(key)
    if (changed) this.save()
  }

  // -- clients --

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.state.clients[clientId],
      registerClient: (client) => {
        for (const uri of client.redirect_uris.map(String)) {
          if (!this.redirectAllowed(uri)) throw new InvalidClientMetadataError(`redirect_uri ${uri} is not allowed by this server.`)
        }
        const ids = Object.keys(this.state.clients)
        if (ids.length >= MAX_CLIENTS) delete this.state.clients[ids[0]]
        const full = client as OAuthClientInformationFull
        this.state.clients[full.client_id] = full
        this.save()
        return full
      },
    }
  }

  private redirectAllowed(uri: string): boolean {
    if (this.redirects.has(uri)) return true
    try {
      const url = new URL(uri)
      return url.protocol === 'http:' && LOOPBACK.has(url.hostname)
    } catch {
      return false
    }
  }

  // -- authorization --

  /** Shows the sign-in page. The OAuth library has already checked the client, redirect URI and PKCE challenge. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const id = randomUUID()
    this.pending.set(id, { client, params, expiresAt: Date.now() + PENDING_SECONDS * 1000 })
    this.renderSignIn(res, id, client, params)
  }

  private renderSignIn(res: Response, id: string, client: OAuthClientInformationFull, params: AuthorizationParams, error?: string): void {
    const nonce = randomBytes(16).toString('base64url')
    const name = escapeHtml(client.client_name || 'An application')
    const returnTo = escapeHtml(new URL(params.redirectUri).host)
    const writeOption = this.options.allowWrites
      ? `<label><input type="radio" name="scope" value="write"> Read and edit patients</label>`
      : ''
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PUHRR sign-in</title>
<style>
body{font-family:system-ui,sans-serif;max-width:26rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#222;background:#fff}
@media (prefers-color-scheme: dark){body{background:#1b1b1b;color:#eee}input{background:#2a2a2a;color:#eee;border-color:#555}}
h1{font-size:1.25rem} label{display:block;margin:.5rem 0} input[type=password]{width:100%;padding:.6rem;font-size:1rem;box-sizing:border-box}
button{margin-top:1rem;padding:.7rem 1.2rem;font-size:1rem;width:100%} .err{color:#b00020;font-weight:600} .small{font-size:.85rem;opacity:.75}
</style></head><body>
<h1>Sign in to PUHRR</h1>
<p><strong>${name}</strong> wants to use your PUHRR data. After you sign in it returns to <strong>${returnTo}</strong>.</p>
<p class="err" id="err"${error ? '' : ' hidden'}>${error ? escapeHtml(error) : ''}</p>
<form id="signin" method="post" action="/oauth/confirm" autocomplete="off">
<input type="hidden" name="id" value="${escapeHtml(id)}">
<label for="passphrase">Passphrase</label>
<input id="passphrase" name="passphrase" type="password" autocomplete="current-password" autofocus required>
<p>What may it do?</p>
<label><input type="radio" name="scope" value="read" checked> Read only</label>
${writeOption}
<button type="submit" id="go">Allow</button>
</form>
<p class="small">If you did not start this from your own app, close this page.</p>
<script nonce="${nonce}">
// Submit in the background and go straight back to the app. A browser that interrupts a form submission with a
// warning page would otherwise lose the result; this still works as a plain form if scripts are off.
(function () {
  var form = document.getElementById('signin'), button = document.getElementById('go'), err = document.getElementById('err');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    button.disabled = true; button.textContent = 'Checking...';
    fetch('/oauth/confirm', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.redirect) { button.textContent = 'Returning to the app...'; window.location.assign(j.redirect); return; }
        err.textContent = (j && j.error) || 'Something went wrong.'; err.hidden = false;
        button.disabled = false; button.textContent = 'Allow';
      })
      .catch(function () { err.textContent = 'Could not reach the server.'; err.hidden = false; button.disabled = false; button.textContent = 'Allow'; });
  });
})();
</script>
</body></html>`
    res.status(200)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`)
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.send(page)
  }

  /** The sign-in form posts here (in the background, expecting JSON; or as a plain form, expecting a redirect). */
  readonly confirmHandler: RequestHandler = async (req: Request, res: Response) => {
    const wantsJson = (req.headers.accept ?? '').includes('application/json')
    const body = (req.body ?? {}) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : ''
    const wantsWrite = body.scope === 'write' && this.options.allowWrites
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')

    const fail = (status: number, message: string): void => {
      if (wantsJson) res.status(status).json({ error: message })
      else res.status(status).type('text/plain').send(message)
    }

    const entry = this.pending.get(id)
    if (!entry || entry.expiresAt <= Date.now()) {
      this.pending.delete(id)
      fail(400, 'This sign-in request expired. Start again from the app.')
      return
    }

    const recent = this.failures.filter((t) => Date.now() - t < LOCKOUT_MS)
    this.failures = recent
    if (recent.length >= MAX_FAILURES) {
      fail(429, 'Too many wrong passphrases. Try again in 15 minutes.')
      return
    }

    const ok = passphrase.length > 0 && (await verifyPassphrase(passphrase, this.options.passphraseHash))
    if (!ok) {
      this.failures.push(Date.now())
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (wantsJson) res.status(401).json({ error: 'That passphrase is not right.' })
      else this.renderSignIn(res, id, entry.client, entry.params, 'That passphrase is not right.')
      return
    }

    // The request stays usable until it expires, so pressing the button again (or going back and forward) works.
    // Each success issues a fresh single-use code.
    this.failures = []
    const scopes = wantsWrite ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ]
    const code = newSecret('pac')
    this.codes.set(code, {
      clientId: entry.client.client_id,
      codeChallenge: entry.params.codeChallenge,
      redirectUri: entry.params.redirectUri,
      scopes,
      expiresAt: Date.now() + CODE_SECONDS * 1000,
    })
    const target = new URL(entry.params.redirectUri)
    target.searchParams.set('code', code)
    if (entry.params.state) target.searchParams.set('state', entry.params.state)
    if (wantsJson) res.status(200).json({ redirect: target.toString() })
    else res.redirect(303, target.toString())
  }

  // -- tokens --

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const issued = this.codes.get(authorizationCode)
    if (!issued || issued.clientId !== client.client_id || issued.expiresAt <= Date.now()) throw new InvalidGrantError('Invalid or expired authorization code.')
    return issued.codeChallenge
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const issued = this.codes.get(authorizationCode)
    if (!issued || issued.clientId !== client.client_id || issued.expiresAt <= Date.now()) throw new InvalidGrantError('Invalid or expired authorization code.')
    if (redirectUri && redirectUri !== issued.redirectUri) throw new InvalidGrantError('redirect_uri does not match the authorization request.')
    this.codes.delete(authorizationCode)
    return this.issueTokens(client.client_id, issued.scopes)
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    const key = sha256(refreshToken)
    const stored = this.state.tokens[key]
    if (!stored || stored.kind !== 'refresh' || stored.clientId !== client.client_id || stored.expiresAt <= nowSeconds()) throw new InvalidGrantError('Invalid or expired refresh token.')
    if (scopes && scopes.some((scope) => !stored.scopes.includes(scope))) throw new InvalidScopeError('A requested scope was not granted.')
    delete this.state.tokens[key]
    return this.issueTokens(client.client_id, scopes && scopes.length > 0 ? scopes : stored.scopes)
  }

  private issueTokens(clientId: string, scopes: string[]): OAuthTokens {
    const access = newSecret('pat')
    const refresh = newSecret('prt')
    const now = nowSeconds()
    this.state.tokens[sha256(access)] = { kind: 'access', clientId, scopes, expiresAt: now + ACCESS_TOKEN_SECONDS }
    this.state.tokens[sha256(refresh)] = { kind: 'refresh', clientId, scopes, expiresAt: now + REFRESH_TOKEN_SECONDS }
    this.save()
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, scope: scopes.join(' '), refresh_token: refresh }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = this.state.tokens[sha256(token)]
    if (!stored || stored.kind !== 'access' || stored.expiresAt <= nowSeconds()) throw new InvalidTokenError('Invalid or expired token.')
    return { token, clientId: stored.clientId, scopes: stored.scopes, expiresAt: stored.expiresAt, resource: this.mcpUrl }
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const key = sha256(request.token)
    const stored = this.state.tokens[key]
    if (!stored || stored.clientId !== client.client_id) return
    delete this.state.tokens[key]
    this.save()
  }
}
