/**
 * Persistent MCP configuration stored in localStorage.
 * Supports JSONC format (comments, trailing commas).
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "url": "https://...",
 *       "headers": { "KEY": "VALUE" }
 *     }
 *   }
 * }
 */

import * as jsonc from "jsonc-parser";

export interface McpServerEntry {
  url: string;
  headers: Record<string, string>;
}

export interface McpJsonConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/** Flattened server config for internal use */
export interface McpServerConfig {
  id: string;
  url: string;
  headers: Record<string, string>;
}

const STORAGE_KEY = "ai-review-mcp-config";

const defaultJson: McpJsonConfig = {
  mcpServers: {
    "example-mcp": {
      url: "https://your-mcp-server.example.com/mcp",
      headers: {
        Authorization: "Bearer your-token-here",
      },
    },
  },
};

const JSONC_OPTIONS: jsonc.ParseOptions = { allowTrailingComma: true };

/** Load the raw JSON config string */
export function loadMcpJsonString(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const errors: jsonc.ParseError[] = [];
      const parsed = jsonc.parse(raw, errors, JSONC_OPTIONS);
      if (errors.length === 0 && parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.mcpServers && typeof parsed.mcpServers === "object") {
        return raw;
      }
    }
  } catch { /* ignore */ }
  return JSON.stringify(defaultJson, null, 2);
}

/** Save the raw JSON config string (validates JSONC first) */
export function saveMcpJsonString(jsonStr: string): { ok: boolean; error?: string } {
  try {
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(jsonStr, errors, JSONC_OPTIONS);
    if (errors.length > 0) {
      const first = errors[0];
      return { ok: false, error: `语法错误 (偏移 ${first.offset}): ${jsonc.printParseErrorCode(first.error)}` };
    }
    if (!parsed || typeof parsed !== "object" || !parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      return { ok: false, error: "缺少 mcpServers 字段" };
    }
    for (const [key, val] of Object.entries(parsed.mcpServers)) {
      const entry = val as Record<string, unknown>;
      if (!entry.url || typeof entry.url !== "string") {
        return { ok: false, error: `服务 "${key}" 缺少有效的 url 字段` };
      }
    }
    localStorage.setItem(STORAGE_KEY, jsonStr);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `解析错误: ${(e as Error).message}` };
  }
}

/** Parse the stored JSON into a flat list of server configs */
export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const config: McpJsonConfig = raw ? jsonc.parse(raw, undefined, JSONC_OPTIONS) : defaultJson;
    return Object.entries(config.mcpServers).map(([id, entry]) => ({
      id,
      url: entry.url,
      headers: entry.headers ?? {},
    }));
  } catch { /* ignore */ }
  return [];
}

/** Get all configured MCP servers */
export function getActiveMcpServers(): McpServerConfig[] {
  return loadMcpServers();
}
