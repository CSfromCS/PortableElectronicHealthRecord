// The PUHRR MCP server over HTTPS, for an MCP client that cannot start a local program (a phone or a web app).
// It serves the same tools as the stdio server (mcp/puhrr-mcp.ts) at /mcp, behind a sign-in (mcp/oauth.ts).
// It listens on localhost only: put a reverse proxy with a TLS certificate in front of it. See mcp/README.md.
import './shims'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import express from 'express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { PuhrrOAuthProvider, SCOPE_READ, SCOPE_WRITE } from './oauth'
import { RoomFollower, readRoomSettings } from './room'
import { createPuhrrServer } from './server'

const IDLE_SESSION_MS = 2 * 60 * 60 * 1000

type Session = {
  transport: StreamableHTTPServerTransport
  server: McpServer
  clientId: string
  scopes: string[]
  lastUsed: number
}

/** The same room, but with the write tools switched off (for a client that was only given "read"). */
const readOnlyView = (room: RoomFollower): RoomFollower =>
  new Proxy(room, {
    get(target, property) {
      if (property === 'allowWrites') return false
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })

const jsonRpcError = (res: Response, status: number, message: string): void => {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })
}

const main = async () => {
  const publicUrlText = process.env.PUHRR_PUBLIC_URL?.trim()
  if (!publicUrlText) throw new Error('Set PUHRR_PUBLIC_URL to the https address this server is reached at, e.g. https://example.org')
  const publicUrl = new URL(publicUrlText)
  const passphraseFile = process.env.PUHRR_OAUTH_PASSPHRASE_FILE?.trim()
  if (!passphraseFile) throw new Error('Set PUHRR_OAUTH_PASSPHRASE_FILE to the file made by `npm run mcp:passphrase`.')
  const stateFile = process.env.PUHRR_OAUTH_STATE_FILE?.trim() || `${passphraseFile}.state.json`
  const host = process.env.PUHRR_MCP_HTTP_HOST?.trim() || '127.0.0.1'
  const port = Number(process.env.PUHRR_MCP_HTTP_PORT ?? 8787)
  const allowLocalHost = /^(1|true|yes)$/i.test(process.env.PUHRR_ALLOW_LOCAL_HOST ?? '')

  const settings = readRoomSettings()
  const room = new RoomFollower(settings)
  await room.getWorld()

  const provider = new PuhrrOAuthProvider({
    publicUrl,
    passphraseHash: readFileSync(passphraseFile, 'utf8').trim(),
    stateFile,
    allowWrites: settings.allowWrites,
    extraRedirects: (process.env.PUHRR_OAUTH_REDIRECTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  })

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  // Only answer for our own address (a proxy passes the Host header through).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const hostHeader = (req.headers.host ?? '').toLowerCase()
    const local = allowLocalHost && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader)
    if (hostHeader !== publicUrl.host.toLowerCase() && !local) { res.status(421).type('text/plain').send('Misdirected request'); return }
    next()
  })

  // One line per request: no query strings, no bodies, no tokens.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now()
    res.on('finish', () => console.error(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`))
    next()
  })

  app.get('/healthz', (_req: Request, res: Response) => { res.type('text/plain').send('ok') })
  app.post('/oauth/confirm', express.urlencoded({ extended: false, limit: '8kb' }), provider.confirmHandler)

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: publicUrl,
    resourceServerUrl: provider.mcpUrl,
    scopesSupported: settings.allowWrites ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ],
    resourceName: 'PUHRR',
  }))

  const bearer = requireBearerAuth({
    verifier: provider,
    requiredScopes: [SCOPE_READ],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(provider.mcpUrl),
    expectedResource: provider.mcpUrl,
  })

  // A session keeps its own server, because a two-step action (delete, discharge) remembers its code between requests.
  const sessions = new Map<string, Session>()

  const handleMcp: RequestHandler = async (req: Request, res: Response) => {
    const auth = req.auth
    if (!auth) { jsonRpcError(res, 401, 'Not signed in.'); return }
    const sessionId = req.header('mcp-session-id')

    let session = sessionId ? sessions.get(sessionId) : undefined
    if (sessionId && !session) { jsonRpcError(res, 404, 'Unknown session. Start a new one.'); return }

    if (session) {
      const sameClient = session.clientId === auth.clientId
      const noMoreThanGranted = session.scopes.every((scope) => auth.scopes.includes(scope))
      if (!sameClient || !noMoreThanGranted) { jsonRpcError(res, 403, 'This session belongs to a different sign-in.'); return }
    } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
      const created: Session = {
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { sessions.set(id, created) },
        }),
        server: createPuhrrServer(auth.scopes.includes(SCOPE_WRITE) ? room : readOnlyView(room)),
        clientId: auth.clientId,
        scopes: [...auth.scopes],
        lastUsed: Date.now(),
      }
      created.transport.onclose = () => { if (created.transport.sessionId) sessions.delete(created.transport.sessionId) }
      await created.server.connect(created.transport)
      session = created
    } else {
      jsonRpcError(res, 400, 'Send an initialize request first.')
      return
    }

    session.lastUsed = Date.now()
    await session.transport.handleRequest(req, res, req.body)
  }

  app.all('/mcp', bearer, express.json({ limit: '4mb' }), handleMcp)

  const sweep = setInterval(() => {
    for (const [id, session] of sessions) {
      if (Date.now() - session.lastUsed > IDLE_SESSION_MS) { sessions.delete(id); void session.transport.close() }
    }
  }, 10 * 60 * 1000)
  sweep.unref()

  const listener = app.listen(port, host, () => {
    console.error(`puhrr-mcp remote ready (${settings.allowWrites ? 'read and edit offered' : 'read only'}) at ${publicUrl.origin}/mcp, listening on ${host}:${port}, room ${room.status().roomTag}`)
  })
  const stop = () => { listener.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref() }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
