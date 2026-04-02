#!/usr/bin/env node
/**
 * Standalone production server for ReThink.
 *
 * Serves the Vite-built static files AND provides the three server-side
 * endpoints that the SPA relies on:
 *   - /llm-proxy   – forwards to any OpenAI-compatible LLM API
 *   - /mcp-proxy   – forwards MCP protocol requests
 *   - /builtin-tools/execute – runs fetch_url / web_search on the server
 *
 * Usage:
 *   npm run build   # build the frontend once
 *   npm start       # start this server
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");
const DEFAULT_PORT = parseInt(process.env.PORT || "5133", 10);

// ─── Static-file serving ────────────────────────────────────────────────────

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function serveStatic(req, res) {
  let filePath = path.join(DIST_DIR, req.url === "/" ? "/index.html" : req.url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // SPA fallback: if file doesn't exist, serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// ─── HTTP proxy helper ──────────────────────────────────────────────────────

function proxyRequest(req, res, targetUrl, extraHeadersToRemove = []) {
  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === "https:";
  const requester = isHttps ? https.request : http.request;

  const fwdHeaders = { ...req.headers };
  for (const h of extraHeadersToRemove) delete fwdHeaders[h];
  fwdHeaders["host"] = parsed.host;

  const proxyReq = requester(
    parsed,
    { method: req.method, headers: fwdHeaders },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, {
        ...proxyRes.headers,
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
}

function handleCorsOptions(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-max-age": "86400",
  });
  res.end();
}

// ─── Built-in tools ─────────────────────────────────────────────────────────

const AUTH_URL_PATTERNS = [
  /\/accounts\/.*login/i,
  /\/login\b/i,
  /\/signin\b/i,
  /\/auth\b/i,
  /\/sso\//i,
  /passport\./i,
];

const FEISHU_URL_RE =
  /(?:feishu\.cn|larksuite\.com)\/(wiki|docx?|sheets|base|bitable|mindnotes|slides)\//;

let feishuMcpSession = null;
let mcpRpcId = 0;

function findFeishuMcpServerUrl() {
  try {
    const configPath = path.resolve(".feishu-mcp.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config.serverUrl || null;
    }
  } catch {
    /* ignore */
  }
  return process.env.FEISHU_MCP_SERVER_URL || null;
}

function mcpRpcCall(serverUrl, method, params) {
  return new Promise((resolve, reject) => {
    const body = { jsonrpc: "2.0", method, id: ++mcpRpcId };
    if (params) body.params = params;

    const data = JSON.stringify(body);
    const parsed = new URL(serverUrl);
    const isHttps = parsed.protocol === "https:";
    const requester = isHttps ? https.request : http.request;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(data).toString(),
    };
    if (feishuMcpSession?.sessionId) {
      headers["Mcp-Session-Id"] = feishuMcpSession.sessionId;
    }

    const req = requester(
      parsed,
      { method: "POST", headers, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf-8");
            const ct = res.headers["content-type"] || "";
            let rpcResult;

            if (ct.includes("text/event-stream")) {
              const lines = text.split("\n");
              let lastData = "";
              for (const line of lines) {
                if (line.startsWith("data: ")) lastData = line.slice(6);
              }
              if (lastData) {
                const parsed = JSON.parse(lastData);
                if (parsed.error)
                  reject(new Error(`MCP error: ${parsed.error.message}`));
                else rpcResult = parsed.result;
              } else {
                reject(new Error("Empty SSE response from MCP server"));
                return;
              }
            } else {
              const parsed = JSON.parse(text);
              if (parsed.error) {
                reject(new Error(`MCP error: ${parsed.error.message}`));
                return;
              }
              rpcResult = parsed.result;
            }

            const sessionId =
              res.headers["mcp-session-id"] || null;
            resolve({ result: rpcResult, sessionId });
          } catch (e) {
            reject(new Error(`MCP response parse error: ${e.message}`));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("MCP request timeout"));
    });
    req.write(data);
    req.end();
  });
}

async function ensureFeishuMcpSession(serverUrl) {
  if (feishuMcpSession?.initialized && feishuMcpSession.serverUrl === serverUrl)
    return;

  feishuMcpSession = { serverUrl, sessionId: null, initialized: false };

  const { sessionId } = await mcpRpcCall(serverUrl, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ReThink-Server", version: "1.0.0" },
  });
  if (sessionId) feishuMcpSession.sessionId = sessionId;

  const notifyBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  const parsed = new URL(serverUrl);
  const isHttps = parsed.protocol === "https:";
  const requester = isHttps ? https.request : http.request;
  const notifyHeaders = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(notifyBody).toString(),
  };
  if (feishuMcpSession.sessionId)
    notifyHeaders["Mcp-Session-Id"] = feishuMcpSession.sessionId;
  const req = requester(
    parsed,
    { method: "POST", headers: notifyHeaders, rejectUnauthorized: false },
    () => {}
  );
  req.on("error", () => {});
  req.write(notifyBody);
  req.end();

  feishuMcpSession.initialized = true;
}

async function tryFetchViaFeishuMcp(url) {
  if (!FEISHU_URL_RE.test(url)) return null;

  const serverUrl = findFeishuMcpServerUrl();
  if (!serverUrl) {
    return (
      "Error: 检测到飞书链接，但飞书 MCP Server 未配置。\n\n" +
      "配置方式：\n" +
      "1. 打开 https://open.feishu.cn/page/mcp 创建 MCP Server\n" +
      '2. 添加 "Docs" 工具包并完成用户授权\n' +
      "3. 复制 Server URL，写入项目根目录 .feishu-mcp.json：\n" +
      '   { "serverUrl": "https://open.feishu.cn/aily/..." }\n' +
      "   或设置环境变量 FEISHU_MCP_SERVER_URL"
    );
  }

  try {
    await ensureFeishuMcpSession(serverUrl);
    const { result } = await mcpRpcCall(serverUrl, "tools/call", {
      name: "fetch-doc",
      arguments: { url },
    });
    const toolResult = result;
    if (toolResult?.content) {
      return (
        toolResult.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n") || "(飞书 MCP fetch-doc 返回为空)"
      );
    }
    return "(飞书 MCP fetch-doc 未返回内容)";
  } catch (err) {
    if (feishuMcpSession && err.message.includes("session")) {
      feishuMcpSession = null;
      try {
        await ensureFeishuMcpSession(serverUrl);
        const { result } = await mcpRpcCall(serverUrl, "tools/call", {
          name: "fetch-doc",
          arguments: { url },
        });
        if (result?.content) {
          return (
            result.content
              .filter((c) => c.type === "text" && c.text)
              .map((c) => c.text)
              .join("\n") || "(飞书 MCP fetch-doc 返回为空)"
          );
        }
      } catch (retryErr) {
        return `Error: 飞书 MCP 调用失败 — ${retryErr.message}`;
      }
    }
    return `Error: 飞书 MCP 调用失败 — ${err.message}`;
  }
}

function nodeFetch(targetUrl, depth = 0, originalUrl) {
  if (depth > 5) return Promise.reject(new Error("Too many redirects"));
  const origin = originalUrl || targetUrl;

  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    const requester = isHttps ? https.request : http.request;

    const options = {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      timeout: 30000,
      rejectUnauthorized: false,
    };

    const req = requester(parsed, options, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        if (AUTH_URL_PATTERNS.some((p) => p.test(redirectUrl))) {
          resolve({ status: res.statusCode, text: "", authRedirect: true });
          return;
        }
        nodeFetch(redirectUrl, depth + 1, origin).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, text: buf.toString("utf-8") });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout (30s)"));
    });
    req.end();
  });
}

function extractText(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    let ssrContent = "";
    doc.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      const patterns = [
        /__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script/,
        /"content"\s*:\s*"([^"]{50,})"/g,
        /"text"\s*:\s*"([^"]{50,})"/g,
      ];
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m) ssrContent += m[0].substring(0, 10000) + "\n";
      }
    });

    const title = doc.querySelector("title")?.textContent?.trim() || "";
    const metaDesc =
      doc
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") || "";
    const ogTitle =
      doc
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content") || "";
    const ogDesc =
      doc
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") || "";

    const removeSelectors = [
      "script",
      "style",
      "nav",
      "footer",
      "header",
      "aside",
      "iframe",
      "noscript",
    ];
    for (const sel of removeSelectors) {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    }

    const mainEl = doc.querySelector(
      'main, article, [role="main"], .content, .article, .post'
    );
    const target = mainEl || doc.body;

    let text = target?.textContent || "";
    text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();

    if (text.length < 100) {
      const parts = [];
      if (title) parts.push(`标题: ${title}`);
      if (ogTitle && ogTitle !== title) parts.push(`标题(OG): ${ogTitle}`);
      if (metaDesc) parts.push(`描述: ${metaDesc}`);
      if (ogDesc && ogDesc !== metaDesc) parts.push(`描述(OG): ${ogDesc}`);
      if (ssrContent) parts.push(`\n嵌入数据:\n${ssrContent}`);
      if (text) parts.push(`\n正文:\n${text}`);
      text = parts.join("\n");
    }

    if (text.length > 50000) {
      text = text.substring(0, 50000) + "\n\n... (内容过长，已截断)";
    }
    return (
      text ||
      "(页面内容为空 — 该网站可能需要登录或通过 JavaScript 动态加载内容)"
    );
  } catch {
    return "(HTML 解析失败)";
  }
}

async function webSearch(query, maxResults) {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const { text: html } = await nodeFetch(searchUrl);
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results = [];

  const items = doc.querySelectorAll("#b_results .b_algo");
  let count = 0;
  items.forEach((el) => {
    if (count >= maxResults) return;
    const titleEl = el.querySelector("h2 a");
    const snippetEl = el.querySelector(".b_caption p, .b_lineclamp2");
    const href = titleEl?.getAttribute("href") || "";
    const title = titleEl?.textContent?.trim() || "";
    const snippet = snippetEl?.textContent?.trim() || "";
    if (title && href) {
      results.push(
        `${count + 1}. **${title}**\n   链接: ${href}\n   ${snippet}`
      );
      count++;
    }
  });

  return results.length > 0
    ? `搜索 "${query}" 的结果：\n\n${results.join("\n\n")}`
    : `搜索 "${query}" 未找到结果。`;
}

async function handleBuiltinTools(req, res) {
  if (req.method === "OPTIONS") {
    handleCorsOptions(res);
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      const toolName = body.tool;
      const args = body.arguments || {};

      let resultText = "";

      switch (toolName) {
        case "fetch_url": {
          const url = args.url;
          if (!url || typeof url !== "string") {
            resultText = "Error: 缺少 url 参数";
            break;
          }
          try {
            new URL(url);
          } catch {
            resultText = `Error: 无效的 URL: ${url}`;
            break;
          }

          const feishuResult = await tryFetchViaFeishuMcp(url);
          if (feishuResult !== null) {
            resultText = feishuResult;
            break;
          }

          const { status, text: html, authRedirect } = await nodeFetch(url);
          if (authRedirect) {
            resultText = `Error: 该页面需要登录认证，无法直接访问。URL: ${url}`;
          } else if (status >= 400) {
            resultText = `Error: HTTP ${status} — 无法访问 ${url}`;
          } else {
            resultText = extractText(html, url);
          }
          break;
        }
        case "web_search": {
          const query = args.query;
          if (!query) {
            resultText = "Error: 缺少 query 参数";
            break;
          }
          const max = typeof args.maxResults === "number" ? args.maxResults : 5;
          resultText = await webSearch(query, max);
          break;
        }
        default:
          resultText = `Unknown builtin tool: ${toolName}`;
      }

      const result = {
        content: [{ type: "text", text: resultText }],
        isError: resultText.startsWith("Error:"),
      };

      res.writeHead(200, {
        "Content-Type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: `工具执行错误: ${err.message}` }],
          isError: true,
        })
      );
    }
  });
}

// ─── Main HTTP server ───────────────────────────────────────────────────────

export const server = http.createServer((req, res) => {
  const url = req.url || "/";

  // CORS preflight for all API paths
  if (req.method === "OPTIONS" && (url.startsWith("/llm-proxy") || url.startsWith("/mcp-proxy") || url.startsWith("/builtin-tools"))) {
    handleCorsOptions(res);
    return;
  }

  // LLM proxy
  if (url.startsWith("/llm-proxy")) {
    const targetOrigin =
      req.headers["x-llm-target"] || "https://api.openai.com";
    const targetUrl = new URL(url.replace("/llm-proxy", "") || "/", targetOrigin);
    proxyRequest(req, res, targetUrl.href, ["x-llm-target"]);
    return;
  }

  // MCP proxy
  if (url.startsWith("/mcp-proxy")) {
    const targetOrigin =
      req.headers["x-mcp-target"] || "https://localhost";
    const targetUrl = new URL(url.replace("/mcp-proxy", "") || "/", targetOrigin);
    proxyRequest(req, res, targetUrl.href, ["x-mcp-target"]);
    return;
  }

  // Built-in tools
  if (url.startsWith("/builtin-tools/execute")) {
    handleBuiltinTools(req, res);
    return;
  }

  // Static files (SPA)
  serveStatic(req, res);
});

export function startServer(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };

    const onListening = () => {
      server.off("error", onError);
      console.log(`\n  🚀 ReThink 已启动\n`);
      console.log(`  ➜ 本地访问:  http://localhost:${port}`);
      console.log(`  ➜ 网络访问:  http://${getLocalIP()}:${port}`);
      console.log(`\n  按 Ctrl+C 停止服务器\n`);
      resolve(server);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

export function stopServer() {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

