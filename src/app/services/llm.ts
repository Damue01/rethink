/**
 * LLM API service – OpenAI-compatible chat completions with streaming.
 * Works with any provider that exposes a /chat/completions endpoint.
 * In dev mode, ALL requests are proxied through Vite `/llm-proxy` to avoid CORS.
 * The actual target origin is passed via `X-LLM-Target` header.
 */

/**
 * Resolve the effective base URL.
 * On localhost the request goes to `/llm-proxy/...` and a custom header tells
 * the Vite middleware which upstream origin to forward to.
 */
function resolveBaseUrl(baseUrl: string): { url: string; extraHeaders?: Record<string, string> } {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    try {
      const parsed = new URL(trimmed);
      return {
        url: "/llm-proxy" + parsed.pathname,
        extraHeaders: { "X-LLM-Target": parsed.origin },
      };
    } catch {
      return { url: trimmed };
    }
  }
  return { url: trimmed };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** OpenAI-compatible tools for function calling */
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>;
}

/** A parsed tool call accumulated from streaming chunks */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  /** Called with reasoning/thinking tokens (delta.reasoning_content) */
  onReasoning?: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
  /** Called when the model requests tool calls instead of producing text */
  onToolCalls?: (toolCalls: ParsedToolCall[]) => void;
}

/** Non-streaming chat completion — returns the full response text */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<{ text: string; tokens: number; latencyMs: number }> {
  const start = performance.now();
  const { url: base, extraHeaders } = resolveBaseUrl(opts.baseUrl);
  const url = `${base}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      stream: false,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const tokens = data.usage?.total_tokens ?? estimateTokens(text);
  const latencyMs = performance.now() - start;
  return { text, tokens, latencyMs };
}

/** Streaming chat completion — delivers tokens via callbacks */
export async function chatCompletionStream(
  opts: ChatCompletionOptions,
  callbacks: StreamCallbacks,
): Promise<void> {
  const { url: base, extraHeaders } = resolveBaseUrl(opts.baseUrl);
  const url = `${base}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    callbacks.onError(new Error(`LLM API error ${res.status}: ${body}`));
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body"));
    return;
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  // Accumulate tool_calls from streaming chunks (indexed by position)
  const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let hasToolCalls = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta;
          const finishReason = json.choices?.[0]?.finish_reason;

          // Accumulate tool_calls chunks
          if (delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
              const idx = tc.index ?? 0;
              const existing = toolCallAccum.get(idx) ?? { id: "", name: "", arguments: "" };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              toolCallAccum.set(idx, existing);
            }
          }

          const reasoningToken = delta?.reasoning_content;
          if (reasoningToken && callbacks.onReasoning) {
            callbacks.onReasoning(reasoningToken);
          }
          const contentToken = delta?.content;
          if (contentToken) {
            fullText += contentToken;
            callbacks.onToken(contentToken);
          }

          // Detect tool_calls finish
          if (finishReason === "tool_calls" && hasToolCalls && callbacks.onToolCalls) {
            const calls = [...toolCallAccum.values()].filter((c) => c.id && c.name);
            if (calls.length > 0) {
              callbacks.onToolCalls(calls);
              return; // Don't call onDone — the agent loop will continue
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Stream ended — if we accumulated tool_calls but didn't get finish_reason
    if (hasToolCalls && toolCallAccum.size > 0 && callbacks.onToolCalls) {
      const calls = [...toolCallAccum.values()].filter((c) => c.id && c.name);
      if (calls.length > 0) {
        callbacks.onToolCalls(calls);
        return;
      }
    }

    // Fallback: detect XML-style tool calls embedded in content text.
    // Some models (e.g. MiniMax) generate tool calls as XML/text in
    // delta.content instead of using the standard delta.tool_calls format.
    if (callbacks.onToolCalls && fullText) {
      const xmlCalls = parseXmlToolCalls(fullText);
      if (xmlCalls && xmlCalls.length > 0) {
        callbacks.onToolCalls(xmlCalls);
        return;
      }
    }

    callbacks.onDone(fullText);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    callbacks.onError(err as Error);
  }
}

/** Test connection to an API provider by hitting /models endpoint (no model required) */
export async function testConnection(apiKey: string, baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { url: base, extraHeaders } = resolveBaseUrl(baseUrl);
    const url = `${base}/models`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `认证失败 (${res.status})：请检查 API Key 是否正确` };
      }
      return { ok: false, error: `请求失败 (${res.status})：${body.slice(0, 200) || res.statusText}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return { ok: false, error: "无法连接到服务器，请检查 Base URL 是否正确" };
    }
    return { ok: false, error: `连接异常：${msg}` };
  }
}

/** Fetch the list of available model IDs from the provider's /models endpoint */
export async function fetchAvailableModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const { url: base, extraHeaders } = resolveBaseUrl(baseUrl);
  const url = `${base}/models`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`);
  }

  const data = await res.json();
  const models: string[] = (data.data ?? []).map((m: { id: string }) => m.id).sort();
  return models;
}

/**
 * Detect and parse XML-style tool calls from content text.
 *
 * Handles common non-standard formats:
 *  - MiniMax style:  `minimax:tool_call <invoke name="fn">{"a":1}</invoke>`
 *  - Anthropic style: `<invoke name="fn"><parameter name="a">1</parameter></invoke>`
 *  - Generic wrapper: `<tool_call>{"name":"fn","arguments":{...}}</tool_call>`
 */
function parseXmlToolCalls(text: string): ParsedToolCall[] | null {
  const calls: ParsedToolCall[] = [];
  let idx = 0;

  // Strip known vendor prefixes (e.g. "minimax:tool_call")
  const cleaned = text.replace(/\b\w+:tool_call\b/gi, "").trim();
  if (!cleaned) return null;

  // Pattern 1: <invoke name="tool_name">args</invoke>
  const invokeRe = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/g;
  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(cleaned)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    let args = "{}";
    if (body) {
      // Try as JSON first
      try { JSON.parse(body); args = body; } catch {
        // Try <parameter name="k">v</parameter> elements
        const params: Record<string, string> = {};
        const pRe = /<parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/g;
        let pm: RegExpExecArray | null;
        while ((pm = pRe.exec(body)) !== null) params[pm[1]] = pm[2].trim();
        if (Object.keys(params).length > 0) args = JSON.stringify(params);
      }
    }
    calls.push({ id: `xmltc_${Date.now()}_${idx++}`, name, arguments: args });
  }
  if (calls.length > 0) return calls;

  // Pattern 2: <tool_call>JSON</tool_call> or <function_call>JSON</function_call>
  const wrapRe = /<(?:tool_call|function_call)>([\s\S]*?)<\/(?:tool_call|function_call)>/g;
  while ((m = wrapRe.exec(cleaned)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed.name) {
        calls.push({
          id: `xmltc_${Date.now()}_${idx++}`,
          name: parsed.name,
          arguments: typeof parsed.arguments === "string"
            ? parsed.arguments
            : JSON.stringify(parsed.arguments ?? {}),
        });
      }
    } catch { /* skip malformed */ }
  }

  return calls.length > 0 ? calls : null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
