import { useState, useCallback, useRef, useMemo, type KeyboardEvent } from "react";
import {
  Zap, CheckCircle2, XCircle, Loader2, Wrench, RotateCcw, ChevronRight,
} from "lucide-react";
import * as jsonc from "jsonc-parser";

/** Simple JSON/JSONC syntax highlighter — returns HTML string */
function highlightJson(text: string): string {
  return text.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, str?: string, colon?: string, keyword?: string) => {
      if (str) {
        return colon
          ? `<span style="color:#a31515">${match}</span>`   // key: "...":
          : `<span style="color:#0451a5">${match}</span>`;  // string value
      }
      if (keyword) return `<span style="color:#0000ff">${match}</span>`;  // true/false/null
      if (match.startsWith("//") || match.startsWith("/*"))
        return `<span style="color:#6a9955">${match}</span>`;  // comment
      return `<span style="color:#098658">${match}</span>`;  // number
    },
  );
}
import { loadMcpJsonString, saveMcpJsonString, loadMcpServers } from "../services/mcpConfig";
import { mcpTestConnection, mcpInitialize, mcpListTools, type McpToolDefinition } from "../services/mcp";
import type { McpServerConfig } from "../services/mcpConfig";
import { loadEnabledToolNames, saveEnabledToolNames, refreshToolRegistry } from "../services/mcpTools";

export function SettingsMCP() {
  const [jsonText, setJsonText] = useState(() => loadMcpJsonString());
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Array<{ id: string; ok: boolean; serverName?: string; toolCount?: number; error?: string }>>([]);
  const [tools, setTools] = useState<Array<{ tool: McpToolDefinition; server: McpServerConfig }>>([]);
  const [showTools, setShowTools] = useState(false);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => new Set(loadEnabledToolNames()));
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(new Set());

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => highlightJson(jsonText), [jsonText]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const onTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonText(e.target.value);
    setSaveStatus(null);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const newVal = val.substring(0, start) + "  " + val.substring(end);
      setJsonText(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, []);

  const handleSave = () => {
    const result = saveMcpJsonString(jsonText);
    setSaveStatus(result.ok ? { ok: true, msg: "保存成功" } : { ok: false, msg: result.error! });
    if (result.ok) {
      setTimeout(() => setSaveStatus(null), 2000);
    }
  };

  const handleReset = () => {
    const saved = loadMcpJsonString();
    setJsonText(saved);
    setSaveStatus(null);
  };

  const handleFormat = () => {
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(jsonText, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      const first = errors[0];
      setSaveStatus({ ok: false, msg: `语法错误 (偏移 ${first.offset}): ${jsonc.printParseErrorCode(first.error)}` });
      return;
    }
    setJsonText(JSON.stringify(parsed, null, 2));
  };

  const handleTestAll = async () => {
    const saveResult = saveMcpJsonString(jsonText);
    if (!saveResult.ok) {
      setSaveStatus({ ok: false, msg: saveResult.error! });
      return;
    }

    setTesting(true);
    setTestResults([]);
    setTools([]);
    setShowTools(false);

    const servers = loadMcpServers();
    const results: typeof testResults = [];

    for (const server of servers) {
      const r = await mcpTestConnection(server);
      results.push({ id: server.id, ...r });
    }

    setTestResults(results);
    setTesting(false);
  };

  const handleViewTools = async () => {
    if (showTools) {
      setShowTools(false);
      return;
    }

    const saveResult = saveMcpJsonString(jsonText);
    if (!saveResult.ok) {
      setSaveStatus({ ok: false, msg: saveResult.error! });
      return;
    }

    setTesting(true);
    // Refresh the shared tool registry so it's available for chat
    const registry = await refreshToolRegistry();
    const allTools = registry.map((r) => ({ tool: r.tool, server: r.server }));

    setTools(allTools);
    setShowTools(true);
    setTesting(false);
  };

  const isDirty = jsonText !== loadMcpJsonString();

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafb] font-['Inter',sans-serif]">
      <div className="max-w-[720px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <p className="text-[18px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>MCP 配置</p>
          <p className="text-[13px] text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>
            编辑 MCP 服务 JSON 配置，为 AI 提供外部工具和知识源
          </p>
        </div>

        {/* JSON Editor */}
        <div className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
            <span className="text-[12px] text-[#717182]" style={{ fontWeight: 500 }}>mcpServers.json</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleFormat}
                className="text-[11px] px-2 py-[3px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb] transition-colors"
                style={{ fontWeight: 500 }}
              >
                格式化
              </button>
              {isDirty && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 text-[11px] px-2 py-[3px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb] transition-colors"
                  style={{ fontWeight: 500 }}
                >
                  <RotateCcw className="w-[11px] h-[11px]" />
                  还原
                </button>
              )}
            </div>
          </div>
          <div className="relative min-h-[300px] max-h-[600px]" style={{ overflow: "auto" }}>
            <pre
              ref={preRef}
              aria-hidden="true"
              className="absolute inset-0 m-0 p-4 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
              style={{ tabSize: 2 }}
              dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
            />
            <textarea
              ref={textareaRef}
              value={jsonText}
              onChange={onTextChange}
              onKeyDown={onKeyDown}
              onScroll={syncScroll}
              spellCheck={false}
              className="relative w-full h-full min-h-[300px] max-h-[600px] resize-y m-0 p-4 font-mono text-[12.5px] leading-[1.6] bg-transparent border-0 outline-none caret-[#1e1e1e]"
              style={{ tabSize: 2, color: "transparent", caretColor: "#1e1e1e" }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-3 py-[7px] bg-[#030213] text-white rounded-[7px] text-[12.5px] hover:bg-[#1a1a2e] transition-colors"
            style={{ fontWeight: 500 }}
          >
            保存配置
          </button>
          <button
            onClick={handleTestAll}
            disabled={testing}
            className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border border-[rgba(0,0,0,0.1)] text-[#0a0a0a] hover:bg-[#f8fafb] transition-colors disabled:opacity-40"
            style={{ fontWeight: 500 }}
          >
            {testing ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Zap className="w-[13px] h-[13px]" />}
            测试连接
          </button>
          <button
            onClick={handleViewTools}
            disabled={testing}
            className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border border-[rgba(0,0,0,0.1)] text-[#0a0a0a] hover:bg-[#f8fafb] transition-colors disabled:opacity-40"
            style={{ fontWeight: 500 }}
          >
            {testing ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Wrench className="w-[13px] h-[13px]" />}
            {showTools ? "收起工具" : "查看工具"}
          </button>
        </div>

        {/* Save status */}
        {saveStatus && (
          <div className={`mt-3 px-3 py-2 rounded-[7px] text-[12px] ${saveStatus.ok ? "bg-[#ecfdf5] text-[#065f46]" : "bg-[#fef2f2] text-[#991b1b]"}`}>
            {saveStatus.ok ? "✅ " : "❌ "}{saveStatus.msg}
          </div>
        )}

        {/* Test results */}
        {testResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {testResults.map((r) => (
              <div key={r.id} className={`flex items-center gap-2 px-3 py-2 rounded-[7px] text-[12px] ${r.ok ? "bg-[#ecfdf5] text-[#065f46]" : "bg-[#fef2f2] text-[#991b1b]"}`}>
                {r.ok ? <CheckCircle2 className="w-[14px] h-[14px] text-[#10b981] shrink-0" /> : <XCircle className="w-[14px] h-[14px] text-[#dc2626] shrink-0" />}
                <span style={{ fontWeight: 500 }}>{r.id}</span>
                <span style={{ fontWeight: 400 }}>
                  {r.ok
                    ? `连接成功 · 服务: ${r.serverName} · 工具: ${r.toolCount}`
                    : `连接失败: ${r.error}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tools list grouped by server */}
        {showTools && (() => {
          const grouped = tools.reduce<Record<string, typeof tools>>((acc, item) => {
            const key = item.server.id;
            (acc[key] ??= []).push(item);
            return acc;
          }, {});
          const serverIds = Object.keys(grouped);

          return (
            <div className="mt-4 bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
                <span className="text-[12px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>可用工具 ({tools.length})</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[#415a9b]" style={{ fontWeight: 500 }}>
                    {enabledTools.size} 已启用
                  </span>
                  <button
                    onClick={() => {
                      if (enabledTools.size === tools.length) {
                        setEnabledTools(new Set());
                        saveEnabledToolNames([]);
                      } else {
                        const all = new Set(tools.map((t) => t.tool.name));
                        setEnabledTools(all);
                        saveEnabledToolNames([...all]);
                      }
                    }}
                    className="text-[10px] text-[#717182] hover:text-[#0a0a0a] px-1.5 py-0.5 rounded border border-[rgba(0,0,0,0.08)] hover:bg-[#f3f3f5] transition-colors"
                    style={{ fontWeight: 500 }}
                  >
                    {enabledTools.size === tools.length ? "全部关闭" : "全部启用"}
                  </button>
                  <button onClick={() => setShowTools(false)} className="text-[10px] text-[#717182] hover:text-[#0a0a0a] px-1.5 py-0.5 rounded border border-[rgba(0,0,0,0.08)] hover:bg-[#f3f3f5] transition-colors" style={{ fontWeight: 500 }}>收起</button>
                </div>
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                {tools.length === 0 ? (
                  <div className="text-[11px] text-[#717182] py-4 text-center">未获取到可用工具</div>
                ) : (
                  serverIds.map((serverId) => (
                    <div key={serverId}>
                      <div className="px-4 py-2 bg-[#f3f3f5] border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
                        <div
                          className="flex items-center gap-2 cursor-pointer select-none"
                          onClick={() => {
                            setCollapsedServers((prev) => {
                              const next = new Set(prev);
                              if (next.has(serverId)) next.delete(serverId);
                              else next.add(serverId);
                              return next;
                            });
                          }}
                        >
                          <ChevronRight className={`w-[12px] h-[12px] text-[#9ca3af] transition-transform ${collapsedServers.has(serverId) ? "" : "rotate-90"}`} />
                          <Zap className="w-[11px] h-[11px] text-[#415a9b]" />
                          <span className="text-[11px] text-[#0a0a0a]" style={{ fontWeight: 600 }}>{serverId}</span>
                          <span className="text-[10px] text-[#9ca3af]">({grouped[serverId].length})</span>
                        </div>
                        {(() => {
                          const serverToolNames = grouped[serverId].map((t) => t.tool.name);
                          const allOn = serverToolNames.every((n) => enabledTools.has(n));
                          return (
                            <button
                              onClick={() => {
                                const next = new Set(enabledTools);
                                if (allOn) {
                                  serverToolNames.forEach((n) => next.delete(n));
                                } else {
                                  serverToolNames.forEach((n) => next.add(n));
                                }
                                setEnabledTools(next);
                                saveEnabledToolNames([...next]);
                              }}
                              className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors 
                                ${allOn ? "bg-[#415a9b]" : "bg-[#d1d5db]"}`}
                              title={allOn ? `关闭 ${serverId} 全部工具` : `启用 ${serverId} 全部工具`}
                            >
                              <span className={`pointer-events-none inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow ring-0 transition-transform
                                ${allOn ? "translate-x-[14px]" : "translate-x-0"}`} />
                            </button>
                          );
                        })()}
                      </div>
                      {!collapsedServers.has(serverId) && <div className="p-3 space-y-1.5">
                        {grouped[serverId].map(({ tool }) => {
                          const isEnabled = enabledTools.has(tool.name);
                          return (
                            <div key={tool.name} className={`px-3 py-[8px] rounded-[7px] transition-colors ${isEnabled ? "bg-[#f0f4ff] border border-[#d4dff7]" : "bg-[#f8fafb]"}`}>
                              <div className="flex items-center gap-2">
                                <Wrench className={`w-[12px] h-[12px] shrink-0 ${isEnabled ? "text-[#415a9b]" : "text-[#b0b8c9]"}`} />
                                <span className={`text-[12px] truncate flex-1 ${isEnabled ? "text-[#0a0a0a]" : "text-[#717182]"}`} style={{ fontWeight: 500 }}>{tool.name}</span>
                                <button
                                  onClick={() => {
                                    const next = new Set(enabledTools);
                                    if (next.has(tool.name)) {
                                      next.delete(tool.name);
                                    } else {
                                      next.add(tool.name);
                                    }
                                    setEnabledTools(next);
                                    saveEnabledToolNames([...next]);
                                  }}
                                  className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors 
                                    ${isEnabled ? "bg-[#415a9b]" : "bg-[#d1d5db]"}`}
                                >
                                  <span className={`pointer-events-none inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow ring-0 transition-transform
                                    ${isEnabled ? "translate-x-[14px]" : "translate-x-0"}`} />
                                </button>
                              </div>
                              {tool.description && (
                                <p className="mt-0.5 text-[10.5px] text-[#717182] ml-[20px] line-clamp-2">{tool.description}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })()}

        {/* Help text */}
        <div className="mt-6 text-[11.5px] text-[#9ca3af] space-y-1.5" style={{ fontWeight: 400 }}>
          <p>配置格式参考：</p>
          <pre className="bg-[#f3f3f5] rounded-[7px] p-3 font-mono text-[10.5px] text-[#717182] whitespace-pre overflow-x-auto">{`{
  "mcpServers": {
    "server-name": {
      "url": "https://example.com/mcp",
      "headers": {
        "AUTH_TYPE": "UAT",
        "AUTH_TOKEN": "your-api-key-here"
      }
    }
  }
}`}</pre>
        </div>
      </div>
    </div>
  );
}
