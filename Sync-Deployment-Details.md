# Sync Deployment Details — For Coding AI Context

## Cloudflare Worker Endpoints (LIVE)

Base URL: `https://puhr-sync.csfromcs.workers.dev`

The Worker accepts both `/api/{name}` and `/api/sync/{name}` paths. The PWA uses `/api/sync/{name}`.

Set `ALLOWED_ORIGIN` to the browser origin with no trailing slash: `https://puhrr.christiansarabia.com`. A value ending in `/` does not match the browser's `Origin` header and causes CORS failures.

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/sync/push` | Create or update Gist with encrypted blob |
| GET | `/api/sync/check?gistId={id}` | Get Gist metadata (description + updatedAt) |
| GET | `/api/sync/pull?gistId={id}&sha={sha?}` | Download encrypted blob (latest or specific revision) |
| GET | `/api/sync/versions?gistId={id}&count=5` | List last N Gist revisions |
| GET | `/api/sync/find?roomTag={tag}` | Find Gist ID by room tag |

## Request/Response Formats

### POST /api/push
Request body:
```json
{
  "gistId": "abc123..." | null,
  "description": "{\"roomTag\":\"a3f2b\",\"lastPushedAt\":\"...\",\"lastPushedBy\":\"a3f2b-Phone\",\"blobSizeBytes\":48230}",
  "blob": "<encrypted base64 string>"
}
```
- `gistId` null on first push (creates new Gist), string on subsequent pushes (updates existing)
- `description` is a JSON string stored in the Gist's description field (unencrypted metadata)
- `blob` is the AES-256-GCM encrypted, base64-encoded full database snapshot

Response: `{ "gistId": "abc123..." }`

### GET /api/check
Response: `{ "description": "{...json string...}", "updatedAt": "2026-02-28T..." }`

### GET /api/pull
Response: `{ "blob": "<encrypted base64 string>" }`
- Optional `sha` parameter fetches a specific Gist revision instead of latest

### GET /api/versions
Response:
```json
[
  {
    "sha": "abc123...",
    "pushedAt": "2026-02-28T10:30:00Z",
    "deviceTag": "a3f2b-Phone",
    "sizeBytes": 48230
  }
]
```

The current Worker may return GitHub-native `{ "version", "committedAt" }` rows. The PWA supports both forms and enriches GitHub-native rows by pulling and decrypting up to five revisions. Returning the four-field form above avoids those additional pulls.

### GET /api/find
Response: `{ "gistId": "abc123..." }` or 404 if not found

## What the PWA needs to implement

Refer to `SyncPlan.md` for full requirements. Summary:

1. **Crypto module** — AES-256-GCM encrypt/decrypt using Web Crypto API, PBKDF2 key derivation from room code, SHA-256 hash for roomTag
2. **Sync service** — exports patients, daily updates, vitals, medications, labs, and orders as JSON, then encrypts and pushes/pulls via the endpoints above
3. **Sync UI** — setup dialog (room code + device name), sync button in header, version picker for conflicts
4. **Only text data syncs** — the existing photo system is untouched, photos stay on-device
5. **Full-state sync** — every push/pull is the complete database, no per-record diffing
6. **Add `lastModified` to Patient interface** — needed for conflict detection