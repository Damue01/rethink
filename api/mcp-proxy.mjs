/**
 * Vercel Serverless Function – MCP Proxy
 * Forwards JSON-RPC requests to MCP servers.
 * Target origin is specified via X-MCP-Target header.
 */

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-max-age", "86400");
    return res.status(204).end();
  }

  const targetOrigin = req.headers["x-mcp-target"] || "https://localhost";

  const originalUrl = req.url || "/";
  const upstreamPath = originalUrl.replace(/^\/api\/mcp-proxy/, "").replace(/^\/mcp-proxy/, "") || "/";
  const targetUrl = new URL(upstreamPath, targetOrigin);

  const fwdHeaders = { ...req.headers };
  delete fwdHeaders["x-mcp-target"];
  delete fwdHeaders["host"];
  delete fwdHeaders["connection"];
  fwdHeaders["host"] = targetUrl.host;

  try {
    const upstream = await fetch(targetUrl.href, {
      method: req.method,
      headers: fwdHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
      duplex: "half",
    });

    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");

    upstream.headers.forEach((value, key) => {
      if (!["transfer-encoding", "connection", "content-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.setHeader("access-control-allow-origin", "*");

    res.status(upstream.status);

    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.end(await upstream.text());
    }
  } catch (err) {
    res.setHeader("access-control-allow-origin", "*");
    res.status(502).json({ error: `Proxy error: ${err.message}` });
  }
}
