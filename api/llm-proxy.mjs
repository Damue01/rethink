/**
 * Vercel Serverless Function – LLM Proxy
 * Forwards requests to any OpenAI-compatible LLM API.
 * Target origin is specified via X-LLM-Target header.
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

  const targetOrigin = req.headers["x-llm-target"] || "https://api.openai.com";

  // Reconstruct the upstream path from the original URL
  const originalUrl = req.url || "/";
  const upstreamPath = originalUrl.replace(/^\/api\/llm-proxy/, "").replace(/^\/llm-proxy/, "") || "/";
  const targetUrl = new URL(upstreamPath, targetOrigin);

  // Build forwarded headers
  const fwdHeaders = { ...req.headers };
  delete fwdHeaders["x-llm-target"];
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

    // Stream the response back
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
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } else {
      res.end(await upstream.text());
    }
  } catch (err) {
    res.setHeader("access-control-allow-origin", "*");
    res.status(502).json({ error: `Proxy error: ${err.message}` });
  }
}
