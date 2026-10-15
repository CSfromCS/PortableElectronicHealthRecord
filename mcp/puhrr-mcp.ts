// The PUHRR MCP server (stdio): gives an MCP client access to the user's PUHRR data and report
// templates. Read-only by default, read-write when PUHRR_ALLOW_WRITES is set. Run it with `npm run mcp`; see mcp/README.md.
import './shims'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { RoomFollower, readRoomSettings } from './room'
import { createPuhrrServer } from './server'

const main = async () => {
  const room = new RoomFollower(readRoomSettings())

  // Fail at start, not on the first request, if the room code is wrong or the room is unreachable.
  await room.getWorld()

  const server = createPuhrrServer(room)
  await server.connect(new StdioServerTransport())
  // stdout carries the protocol; anything meant for a human goes to stderr.
  console.error(`puhrr-mcp ready (${room.allowWrites ? 'READ-WRITE' : 'read-only'}), room ${room.status().roomTag}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
