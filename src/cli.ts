#!/usr/bin/env node
/**
 * Thin stdio proxy for the remote WhichModel MCP server.
 *
 * Allows local MCP clients (Claude Desktop, Cursor, VS Code, etc.) to connect
 * via stdio transport while the actual server runs on Cloudflare Workers.
 *
 * Usage:
 *   npx whichmodel-mcp
 *   WHICHMODEL_URL=https://custom.endpoint/mcp npx whichmodel-mcp
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const REMOTE_URL =
  process.env['WHICHMODEL_URL'] ?? 'https://whichmodel.dev/mcp';

async function main(): Promise<void> {
  // Connect to the remote WhichModel server
  const client = new Client(
    { name: 'whichmodel-stdio-proxy', version: '0.1.0' },
  );
  const remoteTransport = new StreamableHTTPClientTransport(
    new URL(REMOTE_URL),
  );
  await client.connect(remoteTransport);

  // Create a local stdio server that proxies requests
  const server = new Server(
    { name: 'whichmodel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Forward tools/list → remote
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return await client.listTools();
  });

  // Forward tools/call → remote
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
    });
  });

  // Start local stdio transport
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}

main().catch((err) => {
  process.stderr.write(`whichmodel-mcp: ${err}\n`);
  process.exit(1);
});
