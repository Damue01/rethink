/**
 * Built-in tools that run on the Vite dev server (Node.js side).
 * These tools give the LLM abilities like fetching web pages and searching.
 * Tool definitions live here; execution happens server-side via /builtin-tools/execute.
 */

import type { McpToolDefinition, McpToolResult } from "./mcp";

/* ── Tool definitions ── */

export const BUILTIN_TOOLS: McpToolDefinition[] = [
  {
    name: "fetch_url",
    description:
      "抓取指定 URL 的网页内容，返回提取后的纯文本正文。适用于读取文档链接、博客文章、飞书文档等。",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要抓取的完整 URL，例如 https://example.com/article",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "使用搜索引擎搜索关键词，返回搜索结果摘要（标题 + 链接 + 描述）。适用于查找信息、调研竞品等。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
        maxResults: {
          type: "number",
          description: "最大返回结果数（默认 5）",
        },
      },
      required: ["query"],
    },
  },
];

/** The virtual server id used for built-in tools in the registry */
export const BUILTIN_SERVER_ID = "内置";

/* ── Execution (calls the Vite server-side endpoint) ── */

export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    const res = await fetch("/builtin-tools/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolName, arguments: args }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        content: [{ type: "text", text: `工具执行失败 (HTTP ${res.status}): ${text}` }],
        isError: true,
      };
    }

    const data = await res.json();
    return data as McpToolResult;
  } catch (err) {
    return {
      content: [{ type: "text", text: `工具执行异常: ${(err as Error).message}` }],
      isError: true,
    };
  }
}
