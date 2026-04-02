/**
 * Tool-calling agent loop.
 *
 * Wraps chatCompletionStream in a while loop that:
 * 1. Sends messages + enabled MCP tools to the LLM
 * 2. If the LLM returns tool_calls → executes each via MCP → feeds results back
 * 3. Repeats until the LLM produces regular text content (or max rounds hit)
 *
 * Design reference: s02_tool_use.py agent_loop pattern.
 * The model decides whether to use tools — no per-conversation config needed.
 */

import { chatCompletionStream, type ChatCompletionOptions, type StreamCallbacks, type ChatMessage, type ParsedToolCall } from "./llm";
import { getEnabledToolsForLLM, executeToolCall, isRegistryReady, refreshToolRegistry, type OpenAIToolDef } from "./mcpTools";

/** Info about a single tool call execution, for UI display */
export interface ToolCallEvent {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: "calling" | "done" | "error";
}

export interface AgentLoopCallbacks extends Omit<StreamCallbacks, "onToolCalls"> {
  /** Fired when a tool call begins / completes, for UI rendering */
  onToolCallEvent?: (event: ToolCallEvent) => void;
  /** Called when the displayed content should be cleared (e.g., XML-style tool calls shown as text) */
  onContentReset?: () => void;
}

export interface AgentLoopOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Full message history including system prompt */
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Max tool-calling rounds before forcing text output.
   * Prevents infinite loops if the model keeps calling tools.
   */
  maxToolRounds?: number;
}

/**
 * Run the agent loop: stream LLM response, auto-dispatch tool calls, repeat.
 *
 * If no MCP tools are enabled, this degrades to a plain chatCompletionStream call.
 * The LLM decides whether to call tools based on the user's intent — no manual
 * selection needed on the UI side.
 */
export async function agentLoop(
  opts: AgentLoopOptions,
  callbacks: AgentLoopCallbacks,
): Promise<void> {
  // Ensure tool registry is populated (built-in + MCP tools)
  if (!isRegistryReady()) {
    try { await refreshToolRegistry(); } catch { /* proceed without tools */ }
  }

  const tools = getEnabledToolsForLLM();
  const maxRounds = opts.maxToolRounds ?? 5;
  let round = 0;

  // Working copy of messages that grows as tool calls happen
  const messages: ChatMessage[] = [...opts.messages];

  while (round < maxRounds) {
    round++;

    // Check abort before each round
    if (opts.signal?.aborted) return;

    const streamOpts: ChatCompletionOptions = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      tools: tools.length > 0 ? tools : undefined,
    };

    // Use a promise to bridge the callback-based stream API
    const toolCalls = await new Promise<ParsedToolCall[] | null>((resolve, reject) => {
      chatCompletionStream(streamOpts, {
        onToken: callbacks.onToken,
        onReasoning: callbacks.onReasoning,
        onDone: (fullText) => {
          // Normal text response — no tool calls, loop ends
          callbacks.onDone(fullText);
          resolve(null);
        },
        onError: (err) => {
          callbacks.onError(err);
          reject(err);
        },
        onToolCalls: (calls) => {
          resolve(calls);
        },
      }).catch(reject);
    });

    // null means the model produced text → we're done
    if (!toolCalls) return;

    // Clear any content that was streamed before tool calls were detected.
    // Critical for models that embed tool calls as text (XML format) —
    // the raw XML was already pushed to onToken and needs to be wiped.
    callbacks.onContentReset?.();

    // Execute each tool call and collect results
    // Append assistant message with tool_calls to history
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    } as ChatMessage & { tool_calls: unknown });

    for (const tc of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      // Notify UI: tool call started
      const event: ToolCallEvent = {
        id: tc.id,
        name: tc.name,
        arguments: args,
        status: "calling",
      };
      callbacks.onToolCallEvent?.(event);

      // Execute via MCP
      try {
        const result = await executeToolCall(tc.name, args);
        const textResult = result.content
          .map((c) => c.text ?? `[${c.type}]`)
          .join("\n");
        event.result = textResult;
        event.isError = result.isError;
        event.status = result.isError ? "error" : "done";
      } catch (err) {
        event.result = `执行失败: ${(err as Error).message}`;
        event.isError = true;
        event.status = "error";
      }

      // Notify UI: tool call completed
      callbacks.onToolCallEvent?.(event);

      // Append tool result to messages for next LLM round
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: event.result ?? "",
      } as ChatMessage & { tool_call_id: string });
    }

    // Loop continues → next LLM call with tool results appended
  }

  // Max rounds exhausted — tell the model to wrap up without tools
  const finalOpts: ChatCompletionOptions = {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    model: opts.model,
    messages: [
      ...messages,
      { role: "user", content: "请直接给出最终回答，不要再调用工具。" },
    ],
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
    // No tools — force text output
  };

  await chatCompletionStream(finalOpts, {
    onToken: callbacks.onToken,
    onReasoning: callbacks.onReasoning,
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  });
}
