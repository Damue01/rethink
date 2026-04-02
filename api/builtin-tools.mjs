/**
 * Vercel Serverless Function – Built-in Tools (fetch_url, web_search)
 * Runs server-side fetch and search on behalf of the LLM.
 */

import { JSDOM } from "jsdom";

export const config = { maxDuration: 30 };

/* ── URL fetch with redirect handling ── */

const AUTH_URL_PATTERNS = [
  /\/accounts\/.*login/i,
  /\/login\b/i,
  /\/signin\b/i,
  /\/auth\b/i,
  /\/sso\//i,
  /passport\./i,
];

async function nodeFetch(targetUrl, depth = 0) {
  if (depth > 5) throw new Error("Too many redirects");

  const resp = await fetch(targetUrl, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });

  if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
    const redirectUrl = new URL(resp.headers.get("location"), targetUrl).href;
    if (AUTH_URL_PATTERNS.some((p) => p.test(redirectUrl))) {
      return { status: resp.status, text: "", authRedirect: true };
    }
    return nodeFetch(redirectUrl, depth + 1);
  }

  return { status: resp.status, text: await resp.text() };
}

function extractText(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const title = doc.querySelector("title")?.textContent?.trim() || "";
    const metaDesc =
      doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";

    const removeSelectors = [
      "script", "style", "nav", "footer", "header", "aside", "iframe", "noscript",
    ];
    for (const sel of removeSelectors) {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    }

    const mainEl = doc.querySelector('main, article, [role="main"], .content, .article, .post');
    const target = mainEl || doc.body;
    let text = target?.textContent || "";
    text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();

    if (text.length < 100) {
      const parts = [];
      if (title) parts.push(`标题: ${title}`);
      if (metaDesc) parts.push(`描述: ${metaDesc}`);
      if (text) parts.push(`\n正文:\n${text}`);
      text = parts.join("\n");
    }

    if (text.length > 50000) {
      text = text.substring(0, 50000) + "\n\n... (内容过长，已截断)";
    }
    return text || "(页面内容为空 — 该网站可能需要登录或通过 JavaScript 动态加载内容)";
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
      results.push(`${count + 1}. **${title}**\n   链接: ${href}\n   ${snippet}`);
      count++;
    }
  });

  return results.length > 0
    ? `搜索 "${query}" 的结果：\n\n${results.join("\n\n")}`
    : `搜索 "${query}" 未找到结果。`;
}

/* ── Handler ── */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-max-age", "86400");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
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
        try { new URL(url); } catch { resultText = `Error: 无效的 URL: ${url}`; break; }

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
        if (!query) { resultText = "Error: 缺少 query 参数"; break; }
        const max = typeof args.maxResults === "number" ? args.maxResults : 5;
        resultText = await webSearch(query, max);
        break;
      }
      default:
        resultText = `Unknown builtin tool: ${toolName}`;
    }

    res.setHeader("access-control-allow-origin", "*");
    res.status(200).json({
      content: [{ type: "text", text: resultText }],
      isError: resultText.startsWith("Error:"),
    });
  } catch (err) {
    res.setHeader("access-control-allow-origin", "*");
    res.status(200).json({
      content: [{ type: "text", text: `工具执行错误: ${err.message}` }],
      isError: true,
    });
  }
}
