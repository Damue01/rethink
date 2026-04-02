import { defineConfig, type PluginOption } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { request as httpsRequest } from 'https'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { JSDOM } from 'jsdom'

/**
 * Generic LLM proxy plugin – reads `X-LLM-Target` header to determine the
 * upstream origin so it can forward to *any* OpenAI-compatible provider,
 * not just api.openai.com.  Falls back to OpenAI if the header is absent.
 */
function llmProxyPlugin(): PluginOption {
  return {
    name: 'llm-proxy',
    configureServer(server) {
      server.middlewares.use('/llm-proxy', (req: IncomingMessage, res: ServerResponse) => {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'access-control-allow-headers': '*',
            'access-control-max-age': '86400',
          })
          res.end()
          return
        }

        const targetOrigin = (req.headers['x-llm-target'] as string) || 'https://api.openai.com'
        // Build full target URL: origin + whatever comes after /llm-proxy
        const targetUrl = new URL(req.url || '/', targetOrigin)

        // Clone headers, remove proxy-specific ones
        const fwdHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
        delete fwdHeaders['x-llm-target']
        fwdHeaders['host'] = targetUrl.host

        const isHttps = targetUrl.protocol === 'https:'
        const requester = isHttps ? httpsRequest : httpRequest

        const proxyReq = requester(
          targetUrl,
          { method: req.method, headers: fwdHeaders },
          (proxyRes) => {
            // Forward CORS-friendly headers so the browser is happy
            res.writeHead(proxyRes.statusCode ?? 502, {
              ...proxyRes.headers,
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
            })
            proxyRes.pipe(res)
          },
        )

        proxyReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end(`Proxy error: ${err.message}`)
        })

        // Pipe the original request body to the upstream
        req.pipe(proxyReq)
      })
    },
  }
}

/**
 * MCP proxy plugin – reads `X-MCP-Target` header to determine the upstream
 * origin for MCP (Model Context Protocol) requests. Similar to the LLM proxy
 * but on a separate path to keep concerns separate.
 */
function mcpProxyPlugin(): PluginOption {
  return {
    name: 'mcp-proxy',
    configureServer(server) {
      server.middlewares.use('/mcp-proxy', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'access-control-allow-headers': '*',
            'access-control-max-age': '86400',
          })
          res.end()
          return
        }

        const targetOrigin = (req.headers['x-mcp-target'] as string) || 'https://localhost'
        const targetUrl = new URL(req.url || '/', targetOrigin)

        const fwdHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
        delete fwdHeaders['x-mcp-target']
        fwdHeaders['host'] = targetUrl.host

        const isHttps = targetUrl.protocol === 'https:'
        const requester = isHttps ? httpsRequest : httpRequest

        const proxyReq = requester(
          targetUrl,
          { method: req.method, headers: fwdHeaders },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, {
              ...proxyRes.headers,
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
            })
            proxyRes.pipe(res)
          },
        )

        proxyReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end(`MCP Proxy error: ${err.message}`)
        })

        req.pipe(proxyReq)
      })
    },
  }
}

/**
 * Built-in tools plugin – provides server-side execution for fetch_url,
 * web_search. The browser POSTs to /builtin-tools/execute
 * and this plugin runs the actual I/O on the Node.js side.
 */
function builtinToolsPlugin(): PluginOption {
  /** Known login/auth URL patterns — if a redirect lands here, the page requires authentication */
  const AUTH_URL_PATTERNS = [
    /\/accounts\/.*login/i,
    /\/login\b/i,
    /\/signin\b/i,
    /\/auth\b/i,
    /\/sso\//i,
    /passport\./i,
  ]

  // ─── Feishu Remote MCP Server integration ──────────────────────────────

  /** Feishu/Lark URL detection */
  const FEISHU_URL_RE = /(?:feishu\.cn|larksuite\.com)\/(wiki|docx?|sheets|base|bitable|mindnotes|slides)\//

  /** MCP session cache for Feishu MCP server */
  let feishuMcpSession: { serverUrl: string; sessionId: string | null; initialized: boolean } | null = null

  /** Read MCP config from localStorage JSON file to find Feishu MCP server */
  function findFeishuMcpServerUrl(): string | null {
    // Read the MCP config the same way the browser does — but on the server side
    // we read from a cache file that the browser writes, or from env
    // The simplest approach: read from env variable or a file
    try {
      const fs = require('fs') as typeof import('fs')
      const configPath = path.resolve('.feishu-mcp.json')
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        return config.serverUrl || null
      }
    } catch { /* ignore */ }

    // Fallback: check environment variable
    return process.env.FEISHU_MCP_SERVER_URL || null
  }

  /** Make a JSON-RPC 2.0 call to a Streamable HTTP MCP server */
  let mcpRpcId = 0
  async function mcpRpcCall(
    serverUrl: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<{ result: unknown; sessionId: string | null }> {
    return new Promise((resolve, reject) => {
      const body: Record<string, unknown> = {
        jsonrpc: '2.0',
        method,
        id: ++mcpRpcId,
      }
      if (params) body.params = params

      const data = JSON.stringify(body)
      const parsed = new URL(serverUrl)
      const isHttps = parsed.protocol === 'https:'
      const requester = isHttps ? httpsRequest : httpRequest

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(data).toString(),
      }
      if (feishuMcpSession?.sessionId) {
        headers['Mcp-Session-Id'] = feishuMcpSession.sessionId
      }

      const req = requester(
        parsed,
        { method: 'POST', headers, rejectUnauthorized: false },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf-8')
              const ct = res.headers['content-type'] || ''
              let rpcResult: unknown

              if (ct.includes('text/event-stream')) {
                // Parse SSE: take last "data:" line
                const lines = text.split('\n')
                let lastData = ''
                for (const line of lines) {
                  if (line.startsWith('data: ')) lastData = line.slice(6)
                }
                if (lastData) {
                  const parsed = JSON.parse(lastData)
                  if (parsed.error) reject(new Error(`MCP error: ${parsed.error.message}`))
                  else rpcResult = parsed.result
                } else {
                  reject(new Error('Empty SSE response from MCP server'))
                  return
                }
              } else {
                const parsed = JSON.parse(text)
                if (parsed.error) { reject(new Error(`MCP error: ${parsed.error.message}`)); return }
                rpcResult = parsed.result
              }

              const sessionId = res.headers['mcp-session-id'] as string | undefined || null
              resolve({ result: rpcResult, sessionId })
            } catch (e) {
              reject(new Error(`MCP response parse error: ${(e as Error).message}`))
            }
          })
          res.on('error', reject)
        },
      )
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('MCP request timeout')) })
      req.write(data)
      req.end()
    })
  }

  /** Ensure MCP session is initialized with the Feishu server */
  async function ensureFeishuMcpSession(serverUrl: string): Promise<void> {
    if (feishuMcpSession?.initialized && feishuMcpSession.serverUrl === serverUrl) return

    feishuMcpSession = { serverUrl, sessionId: null, initialized: false }

    const { sessionId } = await mcpRpcCall(serverUrl, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ReThink-BuiltinTools', version: '1.0.0' },
    })
    if (sessionId) feishuMcpSession.sessionId = sessionId

    // Send initialized notification
    const notifyBody = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const parsed = new URL(serverUrl)
    const isHttps = parsed.protocol === 'https:'
    const requester = isHttps ? httpsRequest : httpRequest
    const notifyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(notifyBody).toString(),
    }
    if (feishuMcpSession.sessionId) notifyHeaders['Mcp-Session-Id'] = feishuMcpSession.sessionId
    const req = requester(parsed, { method: 'POST', headers: notifyHeaders, rejectUnauthorized: false }, () => {})
    req.on('error', () => {})
    req.write(notifyBody)
    req.end()

    feishuMcpSession.initialized = true
  }

  /**
   * Try to fetch a Feishu URL via the configured Feishu Remote MCP Server's `fetch-doc` tool.
   * Returns document content string, or null if not a Feishu URL or no MCP server configured.
   */
  async function tryFetchViaFeishuMcp(url: string): Promise<string | null> {
    if (!FEISHU_URL_RE.test(url)) return null

    const serverUrl = findFeishuMcpServerUrl()
    if (!serverUrl) {
      return 'Error: 检测到飞书链接，但飞书 MCP Server 未配置。\n\n' +
        '配置方式：\n' +
        '1. 打开 https://open.feishu.cn/page/mcp 创建 MCP Server\n' +
        '2. 添加 "Docs" 工具包并完成用户授权\n' +
        '3. 复制 Server URL，写入项目根目录 .feishu-mcp.json：\n' +
        '   { "serverUrl": "https://open.feishu.cn/aily/..." }\n' +
        '   或设置环境变量 FEISHU_MCP_SERVER_URL'
    }

    try {
      await ensureFeishuMcpSession(serverUrl)

      // Call fetch-doc tool with the document URL
      const { result } = await mcpRpcCall(serverUrl, 'tools/call', {
        name: 'fetch-doc',
        arguments: { url },
      })

      const toolResult = result as { content?: Array<{ type: string; text?: string }> }
      if (toolResult?.content) {
        return toolResult.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n')
          || '(飞书 MCP fetch-doc 返回为空)'
      }
      return '(飞书 MCP fetch-doc 未返回内容)'
    } catch (err) {
      // If session expired, reset and retry once
      if (feishuMcpSession && (err as Error).message.includes('session')) {
        feishuMcpSession = null
        try {
          await ensureFeishuMcpSession(serverUrl)
          const { result } = await mcpRpcCall(serverUrl, 'tools/call', {
            name: 'fetch-doc',
            arguments: { url },
          })
          const toolResult = result as { content?: Array<{ type: string; text?: string }> }
          if (toolResult?.content) {
            return toolResult.content
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text)
              .join('\n')
              || '(飞书 MCP fetch-doc 返回为空)'
          }
        } catch (retryErr) {
          return `Error: 飞书 MCP 调用失败 — ${(retryErr as Error).message}`
        }
      }
      return `Error: 飞书 MCP 调用失败 — ${(err as Error).message}`
    }
  }

  /** Helper: fetch a URL using Node.js native http/https with SSL workaround */
  async function nodeFetch(
    targetUrl: string,
    depth = 0,
    originalUrl?: string,
  ): Promise<{ status: number; text: string; authRedirect?: boolean }> {
    if (depth > 5) throw new Error('Too many redirects')
    const origin = originalUrl || targetUrl

    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl)
      const isHttps = parsed.protocol === 'https:'
      const requester = isHttps ? httpsRequest : httpRequest

      const options: Record<string, unknown> = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: 30000,
        rejectUnauthorized: false,
      }

      const req = requester(parsed, options as Parameters<typeof httpsRequest>[1], (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).href
          // Detect login/auth redirects
          if (AUTH_URL_PATTERNS.some((p) => p.test(redirectUrl))) {
            resolve({
              status: res.statusCode,
              text: '',
              authRedirect: true,
            })
            return
          }
          nodeFetch(redirectUrl, depth + 1, origin).then(resolve).catch(reject)
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          resolve({ status: res.statusCode ?? 0, text: buf.toString('utf-8') })
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout (30s)')) })
      req.end()
    })
  }

  /** Extract readable text from HTML using jsdom + Readability-like heuristic */
  function extractText(html: string, url: string): string {
    try {
      const dom = new JSDOM(html, { url })
      const doc = dom.window.document

      // Before stripping scripts, try to extract SSR/initial state data
      // Many SPAs embed page content as JSON in script tags
      let ssrContent = ''
      doc.querySelectorAll('script').forEach((script: Element) => {
        const text = script.textContent || ''
        // Look for common SSR patterns: __INITIAL_STATE__, __NEXT_DATA__, window.__data, etc.
        const patterns = [/__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script/,
                          /"content"\s*:\s*"([^"]{50,})"/g,
                          /"text"\s*:\s*"([^"]{50,})"/g]
        for (const pat of patterns) {
          const m = text.match(pat)
          if (m) {
            ssrContent += m[0].substring(0, 10000) + '\n'
          }
        }
      })

      // Get title and meta description
      const title = doc.querySelector('title')?.textContent?.trim() || ''
      const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || ''
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''
      const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''

      // Remove script, style, nav, footer, header tags
      const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript']
      for (const sel of removeSelectors) {
        doc.querySelectorAll(sel).forEach((el: Element) => el.remove())
      }

      // Try to find main content area
      const mainEl = doc.querySelector('main, article, [role="main"], .content, .article, .post')
      const target = mainEl || doc.body

      // Get text content and clean up
      let text = target?.textContent || ''
      text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim()

      // If body text is too short, supplement with meta info and SSR content
      if (text.length < 100) {
        const parts: string[] = []
        if (title) parts.push(`标题: ${title}`)
        if (ogTitle && ogTitle !== title) parts.push(`标题(OG): ${ogTitle}`)
        if (metaDesc) parts.push(`描述: ${metaDesc}`)
        if (ogDesc && ogDesc !== metaDesc) parts.push(`描述(OG): ${ogDesc}`)
        if (ssrContent) parts.push(`\n嵌入数据:\n${ssrContent}`)
        if (text) parts.push(`\n正文:\n${text}`)
        text = parts.join('\n')
      }

      // Truncate to ~50k chars to avoid context overflow
      if (text.length > 50000) {
        text = text.substring(0, 50000) + '\n\n... (内容过长，已截断)'
      }
      return text || '(页面内容为空 — 该网站可能需要登录或通过 JavaScript 动态加载内容)'
    } catch {
      return '(HTML 解析失败)'
    }
  }

  /** Bing web search (no API key needed) */
  async function webSearch(query: string, maxResults: number): Promise<string> {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`
    const { text: html } = await nodeFetch(searchUrl)
    const dom = new JSDOM(html)
    const doc = dom.window.document
    const results: string[] = []

    // Bing organic results
    const items = doc.querySelectorAll('#b_results .b_algo')
    let count = 0
    items.forEach((el: Element) => {
      if (count >= maxResults) return
      const titleEl = el.querySelector('h2 a')
      const snippetEl = el.querySelector('.b_caption p, .b_lineclamp2')
      const href = titleEl?.getAttribute('href') || ''
      const title = titleEl?.textContent?.trim() || ''
      const snippet = snippetEl?.textContent?.trim() || ''
      if (title && href) {
        results.push(`${count + 1}. **${title}**\n   链接: ${href}\n   ${snippet}`)
        count++
      }
    })

    return results.length > 0
      ? `搜索 "${query}" 的结果：\n\n${results.join('\n\n')}`
      : `搜索 "${query}" 未找到结果。`
  }

  return {
    name: 'builtin-tools',
    configureServer(server) {
      server.middlewares.use('/builtin-tools/execute', (req: IncomingMessage, res: ServerResponse) => {
        // CORS
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': '*',
          })
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'text/plain' })
          res.end('Method not allowed')
          return
        }

        // Read body
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
            const toolName = body.tool as string
            const args = body.arguments as Record<string, unknown>

            let resultText = ''

            switch (toolName) {
              case 'fetch_url': {
                const url = args.url as string
                if (!url || typeof url !== 'string') {
                  resultText = 'Error: 缺少 url 参数'
                  break
                }
                // Basic URL validation
                try { new URL(url) } catch { resultText = `Error: 无效的 URL: ${url}`; break }

                // Try Feishu Remote MCP Server for feishu.cn / larksuite.com URLs
                const feishuResult = await tryFetchViaFeishuMcp(url)
                if (feishuResult !== null) {
                  resultText = feishuResult
                  break
                }

                const { status, text: html, authRedirect } = await nodeFetch(url)
                if (authRedirect) {
                  resultText = `Error: 该页面需要登录认证，无法直接访问。URL: ${url}`
                } else if (status >= 400) {
                  resultText = `Error: HTTP ${status} — 无法访问 ${url}`
                } else {
                  resultText = extractText(html, url)
                }
                break
              }
              case 'web_search': {
                const query = args.query as string
                if (!query) { resultText = 'Error: 缺少 query 参数'; break }
                const max = typeof args.maxResults === 'number' ? args.maxResults : 5
                resultText = await webSearch(query, max)
                break
              }
              default:
                resultText = `Unknown builtin tool: ${toolName}`
            }

            const result = {
              content: [{ type: 'text', text: resultText }],
              isError: resultText.startsWith('Error:'),
            }

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'access-control-allow-origin': '*',
            })
            res.end(JSON.stringify(result))
          } catch (err) {
            const msg = (err as Error).message || 'Unknown error'
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'access-control-allow-origin': '*',
            })
            res.end(JSON.stringify({
              content: [{ type: 'text', text: `工具执行错误: ${msg}` }],
              isError: true,
            }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    llmProxyPlugin(),
    mcpProxyPlugin(),
    builtinToolsPlugin(),
  ],
  server: {
    // Always bind to localhost so the origin is consistent (localStorage is per-origin).
    // Avoids data "loss" when switching between localhost and 127.0.0.1.
    host: 'localhost',
    port: 5133,
    strictPort: true,
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
