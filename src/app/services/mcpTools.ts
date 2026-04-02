/**
 * MCP tool state management.
 * - Tracks which tools are enabled (persisted in localStorage)
 * - Caches tool definitions from MCP servers at runtime
 * - Converts MCP tools → OpenAI-compatible tool format for LLM API
 * - Dispatches tool calls to the correct MCP server
 * - Includes built-in tools (fetch_url, web_search, read_local_file)
 */

import { loadMcpServers, type McpServerConfig } from "./mcpConfig";
import { mcpInitialize, mcpListTools, mcpCallTool, type McpToolDefinition, type McpToolResult } from "./mcp";
import { BUILTIN_TOOLS, BUILTIN_SERVER_ID, executeBuiltinTool } from "./builtinTools";

const ENABLED_KEY = "ai-review-mcp-enabled-tools";

/* ── Enabled tools persistence ── */

export function loadEnabledToolNames(): string[] {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

export function saveEnabledToolNames(names: string[]): void {
  localStorage.setItem(ENABLED_KEY, JSON.stringify(names));
}

/* ── Tool registry (runtime cache) ── */

export interface RegisteredTool {
  server: McpServerConfig;
  tool: McpToolDefinition;
}

let toolRegistry: RegisteredTool[] = [];
let registryReady = false;

/** Fetch tools from all configured MCP servers and cache them */
export async function refreshToolRegistry(): Promise<RegisteredTool[]> {
  const servers = loadMcpServers();
  const all: RegisteredTool[] = [];

  // Add built-in tools first (always available, no MCP server needed)
  const builtinServer: McpServerConfig = { id: BUILTIN_SERVER_ID, url: "", headers: {} };
  for (const tool of BUILTIN_TOOLS) {
    all.push({ server: builtinServer, tool });
  }

  for (const server of servers) {
    try {
      await mcpInitialize(server);
      const tools = await mcpListTools(server);
      all.push(...tools.map((tool) => ({ server, tool })));
    } catch { /* skip failed servers */ }
  }

  toolRegistry = all;
  registryReady = true;

  // Auto-prune enabled list: remove names that no longer exist
  const validNames = new Set(all.map((r) => r.tool.name));
  let enabled = loadEnabledToolNames().filter((n) => validNames.has(n));

  // Auto-enable built-in tools if nothing was previously enabled
  if (enabled.length === 0) {
    const builtinNames = BUILTIN_TOOLS.map((t) => t.name);
    enabled = builtinNames;
  }

  saveEnabledToolNames(enabled);

  return all;
}

export function getToolRegistry(): RegisteredTool[] {
  return toolRegistry;
}

export function isRegistryReady(): boolean {
  return registryReady;
}

/* ── OpenAI format conversion ── */

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Get enabled tools in OpenAI API format. Returns [] if none enabled. */
export function getEnabledToolsForLLM(): OpenAIToolDef[] {
  const enabled = new Set(loadEnabledToolNames());
  if (enabled.size === 0) return [];

  return toolRegistry
    .filter((r) => enabled.has(r.tool.name))
    .map((r) => ({
      type: "function" as const,
      function: {
        name: r.tool.name,
        description: r.tool.description,
        parameters: r.tool.inputSchema,
      },
    }));
}

/* ── Tool execution (dispatch to correct MCP server or built-in handler) ── */

/** Set of built-in tool names for fast lookup */
const builtinToolNames = new Set(BUILTIN_TOOLS.map((t) => t.name));

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  // Built-in tools are executed via the Vite server-side endpoint
  if (builtinToolNames.has(toolName)) {
    return executeBuiltinTool(toolName, args);
  }
  // MCP tools are dispatched to the correct MCP server
  const entry = toolRegistry.find((r) => r.tool.name === toolName);
  if (!entry) {
    const available = toolRegistry.map((r) => r.tool.name);
    return {
      content: [{
        type: "text",
        text: `Unknown tool: ${toolName}. Available tools: ${available.join(", ")}`,
      }],
      isError: true,
    };
  }
  return mcpCallTool(entry.server, toolName, args);
}
