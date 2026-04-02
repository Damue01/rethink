/**
 * MCP (Model Context Protocol) client for HTTP Streamable transport.
 * Sends JSON-RPC 2.0 requests over HTTP POST to MCP servers.
 * Handles session management: `initialize` returns `mcp-session-id` header,
 * which is sent in all subsequent requests.
 * In dev mode, requests are proxied through Vite `/mcp-proxy` to avoid CORS.
 */

import type { McpServerConfig } from "./mcpConfig";

/* ── JSON-RPC types ── */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/* ── MCP types ── */

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

/* ── Session store ── */

/** Maps server id → session id returned by the MCP server */
const sessionMap = new Map<string, string>();

/* ── Internal helpers ── */

let rpcId = 0;

function resolveUrl(serverUrl: string): { url: string; extraHeaders?: Record<string, string> } {
  const trimmed = serverUrl.replace(/\/+$/, "");
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    try {
      const parsed = new URL(trimmed);
      return {
        url: "/mcp-proxy" + parsed.pathname,
        extraHeaders: { "X-MCP-Target": parsed.origin },
      };
    } catch {
      return { url: trimmed };
    }
  }
  return { url: trimmed };
}

function buildHeaders(server: McpServerConfig, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...extra,
  };
  // Add custom headers from config
  for (const [key, value] of Object.entries(server.headers)) {
    if (key && value) h[key] = value;
  }
  // Add session id if we have one
  const sessionId = sessionMap.get(server.id);
  if (sessionId) {
    h["Mcp-Session-Id"] = sessionId;
  }
  return h;
}

function parseJsonRpc(text: string, contentType: string): JsonRpcResponse {
  if (contentType.includes("text/event-stream")) {
    const lines = text.split("\n");
    let lastData = "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        lastData = line.slice(6);
      }
    }
    if (lastData) return JSON.parse(lastData) as JsonRpcResponse;
    throw new Error("Empty SSE response from MCP server");
  }
  return JSON.parse(text) as JsonRpcResponse;
}

/**
 * Low-level JSON-RPC call. Returns the raw Response so callers
 * can inspect headers (e.g. for session id).
 */
async function rpcCall(server: McpServerConfig, method: string, params?: Record<string, unknown>): Promise<{ response: Response; result: unknown }> {
  const { url, extraHeaders } = resolveUrl(server.url);
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
    params: params ?? {},
    id: ++rpcId,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(server, extraHeaders),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP request failed (${res.status}): ${text}`);
  }

  // Capture session id from response headers
  const sid = res.headers.get("mcp-session-id");
  if (sid) {
    sessionMap.set(server.id, sid);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const data = parseJsonRpc(text, contentType);

  if (data.error) throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
  return { response: res, result: data.result };
}

/* ── Public API ── */

/** Initialize the MCP session. Must be called first – stores session id for subsequent calls. */
export async function mcpInitialize(server: McpServerConfig): Promise<{ serverInfo?: { name: string; version: string }; capabilities?: Record<string, unknown> }> {
  // Clear any stale session for this server
  sessionMap.delete(server.id);

  const { result } = await rpcCall(server, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ReThink", version: "1.0.0" },
  });

  // Send initialized notification (no id → notification)
  const { url, extraHeaders } = resolveUrl(server.url);
  const headers = buildHeaders(server, extraHeaders);
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => { /* best-effort notification */ });

  return result as { serverInfo?: { name: string; version: string }; capabilities?: Record<string, unknown> };
}

/** List available tools from the MCP server (requires prior initialize) */
export async function mcpListTools(server: McpServerConfig): Promise<McpToolDefinition[]> {
  const { result } = await rpcCall(server, "tools/list", {});
  return (result as { tools?: McpToolDefinition[] }).tools ?? [];
}

/** Call a tool on the MCP server (requires prior initialize) */
export async function mcpCallTool(server: McpServerConfig, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const { result } = await rpcCall(server, "tools/call", { name: toolName, arguments: args });
  return result as McpToolResult;
}

/** Test connection: initialize → list tools */
export async function mcpTestConnection(server: McpServerConfig): Promise<{ ok: boolean; serverName?: string; toolCount?: number; error?: string }> {
  try {
    const init = await mcpInitialize(server);
    const tools = await mcpListTools(server);
    return {
      ok: true,
      serverName: init.serverInfo?.name ?? "Unknown",
      toolCount: tools.length,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
