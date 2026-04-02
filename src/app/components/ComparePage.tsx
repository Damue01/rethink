import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft, Download, Clock, Hash, Sparkles, Loader2, User,
  Plus, PanelLeftClose, PanelLeft, Search, MoreHorizontal, Trash2, Pencil,
  Upload, FileText, X, ChevronsDown,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SkillPanel, SkillBadges } from "./SkillPanel";
import { getAllModels } from "../services/llmConfig";
import { agentLoop } from "../services/toolLoop";
import { loadSkills } from "./skillData";
import { ConversationComposer } from "./ui/conversation-composer";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENT_COUNT,
  buildOutgoingUserMessage,
  formatAttachmentSize,
  readChatAttachments,
  type ChatAttachment,
} from "../services/chatAttachments";

/** Prose classes shared with ChatPage / DebatePage */
const PROSE_CLASSES =
  "prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-[20px] prose-h2:text-[17px] prose-h3:text-[15px] prose-h4:text-[14px] prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-4 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e] prose-strong:font-semibold prose-blockquote:border-l-[#415a9b] prose-blockquote:bg-[#f8f9ff] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md prose-a:text-[#415a9b] prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-img:border prose-img:border-[#e0e0e0]";

interface ColumnMessage {
  role: "user" | "assistant";
  content: string;
  latency?: string;
  tokens?: number;
  loading?: boolean;
}

/** Per-model column state: its own message history */
interface ColumnState {
  modelId: string;
  name: string;
  messages: ColumnMessage[];
}

/* ── Persistence helpers ── */
const STORAGE_KEY = "ai-review-compare-conversations";

interface StoredCompare {
  id: string;
  title: string;
  columns: Record<string, ColumnState>;
  checkedIds: string[];
  activeSkillIds?: string[];
  updatedAt: number;
}

function loadCompares(): StoredCompare[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveCompares(list: StoredCompare[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function upsertStoredCompare(entry: StoredCompare): StoredCompare[] {
  const list = loadCompares();
  const idx = list.findIndex((item) => item.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  saveCompares(list);
  return list;
}

function groupCompares(list: StoredCompare[]) {
  const now = Date.now();
  const day = 86400000;
  const groups: { label: string; items: StoredCompare[] }[] = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "近7天", items: [] },
    { label: "更早", items: [] },
  ];
  for (const c of list.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const diff = now - c.updatedAt;
    if (diff < day) groups[0].items.push(c);
    else if (diff < 2 * day) groups[1].items.push(c);
    else if (diff < 7 * day) groups[2].items.push(c);
    else groups[3].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function ComparePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const configuredModels = getAllModels();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set(configuredModels.map((m) => m.model.id)));
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [input, setInput] = useState("");
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const columnScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Per-column flag: user manually scrolled up during streaming → pause auto-scroll for that column */
  const userScrolledAwayRef = useRef<Record<string, boolean>>({});

  /* ── Attachment state ── */
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isComposerDragActive, setIsComposerDragActive] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── History sidebar state ── */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [compares, setCompares] = useState<StoredCompare[]>(() => loadCompares());
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const columnsRef = useRef<Record<string, ColumnState>>(columns);
  useEffect(() => { columnsRef.current = columns; }, [columns]);

  const historyGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? compares.filter((c) => c.title.toLowerCase().includes(q)) : compares;
    return groupCompares(filtered);
  }, [compares, searchQuery]);

  /* Redirect /compare/new → fresh ID */
  useEffect(() => {
    if (id === "new") navigate(`/compare/${Date.now()}`, { replace: true });
  }, [id, navigate]);

  /* Load compare by route ID */
  useEffect(() => {
    if (!id || id === "new") return;
    const stored = loadCompares().find((c) => c.id === id);
    if (stored) {
      setColumns(stored.columns);
      setCheckedIds(new Set(stored.checkedIds));
      setActiveSkillIds(stored.activeSkillIds ?? []);
    } else {
      setColumns({});
      setCheckedIds(new Set(configuredModels.map((m) => m.model.id)));
      setActiveSkillIds([]);
    }
  }, [id]);

  // Abort streaming & save progress when unmounting (navigating away)
  useEffect(() => {
    return () => {
      const currentId = id;
      if (!currentId || currentId === "new") return;
      const currentColumns = columnsRef.current;
      const allMsgs = Object.values(currentColumns).flatMap((c) => c.messages);
      if (allMsgs.length === 0) return;
      const firstUserMsg = allMsgs.find((m) => m.role === "user");
      const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) : "新对比";
      const entry: StoredCompare = { id: currentId, title, columns: currentColumns, checkedIds: [...checkedIds], activeSkillIds, updatedAt: Date.now() };
      upsertStoredCompare(entry);
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Save current compare */
  const saveCurrentCompare = useCallback(() => {
    if (!id || id === "new") return;
    const allMsgs = Object.values(columns).flatMap((c) => c.messages);
    if (allMsgs.length === 0) return;
    const firstUserMsg = allMsgs.find((m) => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) : "新对比";
    const entry: StoredCompare = { id, title, columns, checkedIds: [...checkedIds], activeSkillIds, updatedAt: Date.now() };
    const list = upsertStoredCompare(entry);
    setCompares(list);
  }, [id, columns, checkedIds, activeSkillIds]);

  // Save when skill config changes (even without sending a message)
  const configSaveInitRef = useRef(false);
  useEffect(() => {
    if (!configSaveInitRef.current) { configSaveInitRef.current = true; return; }
    if (!id || id === "new") return;
    const allMsgs = Object.values(columns).flatMap((c) => c.messages);
    if (allMsgs.length === 0) return;
    saveCurrentCompare();
  }, [activeSkillIds]);

  /* Auto-save when sending stops */
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (wasSendingRef.current && !isSending) saveCurrentCompare();
    wasSendingRef.current = isSending;
  }, [isSending, saveCurrentCompare]);

  /* Auto-save when user sends */
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const total = Object.values(columns).reduce((n, c) => n + c.messages.filter((m) => m.role === "user").length, 0);
    if (total > prevMsgCountRef.current) saveCurrentCompare();
    prevMsgCountRef.current = total;
  }, [columns, saveCurrentCompare]);

  /* Delete / Rename */
  const handleDeleteCompare = (delId: string) => {
    const list = loadCompares().filter((c) => c.id !== delId);
    saveCompares(list);
    setCompares(list);
    setContextMenuId(null);
    if (delId === id) navigate("/compare/new");
  };
  const handleRenameCompare = (renId: string, newTitle: string) => {
    const list = loadCompares();
    const item = list.find((c) => c.id === renId);
    if (item) { item.title = newTitle.trim() || item.title; saveCompares(list); setCompares(list); }
    setRenamingId(null);
    setContextMenuId(null);
  };

  /* Close context menu on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenuId(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedModels = configuredModels.filter((m) => checkedIds.has(m.model.id));

  const buildSystemPrompt = useCallback(() => {
    let prompt = "你是一个有帮助的 AI 助手。请认真、专业地回答用户的问题。";
    if (activeSkillIds.length > 0) {
      const skills = loadSkills().filter((s) => activeSkillIds.includes(s.id));
      if (skills.length > 0) {
        prompt += "\n\n## 已加载的 Skill 知识库：\n";
        for (const skill of skills) {
          prompt += `\n### ${skill.name}\n${skill.content}\n`;
        }
      }
    }
    return prompt;
  }, [activeSkillIds]);

  /* ── Attachment handlers ── */
  const handleSelectedFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const remainingSlots = Math.max(0, MAX_CHAT_ATTACHMENT_COUNT - pendingAttachments.length);
    const limitedFiles = remainingSlots > 0 ? files.slice(0, remainingSlots) : [];
    const overflowCount = files.length - limitedFiles.length;
    const result = await readChatAttachments(limitedFiles);
    if (result.attachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...result.attachments]);
    }
    const errorParts = [
      ...result.rejected.map(({ fileName, reason }) => `${fileName}: ${reason}`),
      ...(overflowCount > 0 ? [`最多只能附加 ${MAX_CHAT_ATTACHMENT_COUNT} 个文件`] : []),
    ];
    setComposerError(errorParts.length > 0 ? errorParts.join("；") : null);
  }, [pendingAttachments.length]);

  const handleComposerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isComposerDragActive) setIsComposerDragActive(true);
  }, [isComposerDragActive]);

  const handleComposerDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsComposerDragActive(false);
  }, []);

  const handleComposerDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsComposerDragActive(false);
    if (event.dataTransfer.files.length > 0) void handleSelectedFiles(event.dataTransfer.files);
  }, [handleSelectedFiles]);

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const handleSend = () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || isSending || selectedModels.length === 0) return;
    const attachments = pendingAttachments;
    const { displayContent, promptContent } = buildOutgoingUserMessage(input, attachments);
    setInput("");
    setPendingAttachments([]);
    setComposerError(null);
    setIsComposerDragActive(false);
    setIsSending(true);
    // Reset per-column scroll-away flags on new send
    userScrolledAwayRef.current = {};
    const systemPrompt = buildSystemPrompt();
    const abort = new AbortController();
    abortRef.current = abort;

    const compareId = id;
    const capturedCheckedIds = [...checkedIds];
    const capturedSkillIds = [...activeSkillIds];

    const nextColumns: Record<string, ColumnState> = { ...columns };
    for (const model of selectedModels) {
      const col = nextColumns[model.model.id] ?? { modelId: model.model.id, name: model.model.displayName, messages: [] };
      nextColumns[model.model.id] = {
        ...col,
        messages: [
          ...col.messages,
          { role: "user", content: displayContent },
          { role: "assistant", content: "", loading: true },
        ],
      };
    }

    let persistedColumns = nextColumns;
    const persistSnapshot = (snapshot: Record<string, ColumnState>) => {
      if (!compareId || compareId === "new") return;
      const allMsgs = Object.values(snapshot).flatMap((c) => c.messages);
      if (allMsgs.length === 0) return;
      const firstUserMsg = allMsgs.find((m) => m.role === "user");
      const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) : "新对比";
      const list = upsertStoredCompare({
        id: compareId,
        title,
        columns: snapshot,
        checkedIds: capturedCheckedIds,
        activeSkillIds: capturedSkillIds,
        updatedAt: Date.now(),
      });
      setCompares(list);
    };

    // Append user message to each column
    setColumns(nextColumns);
    persistSnapshot(nextColumns);

    let remaining = selectedModels.length;
    for (const m of selectedModels) {
      const startTime = performance.now();
      // Build per-model LLM history from its column
      const existingMsgs = columns[m.model.id]?.messages.filter((msg) => !msg.loading) ?? [];
      const llmHistory = [
        { role: "system" as const, content: systemPrompt },
        ...existingMsgs.map((msg) => ({ role: msg.role as "user" | "assistant", content: msg.content })),
        { role: "user" as const, content: promptContent },
      ];

      agentLoop(
        {
          apiKey: m.apiKey,
          baseUrl: m.baseUrl,
          model: m.model.name,
          messages: llmHistory,
          temperature: m.model.temperature,
          maxTokens: m.model.maxTokens,
          signal: abort.signal,
        },
        {
          onToken(token) {
            const persistedCol = persistedColumns[m.model.id];
            if (persistedCol) {
              const persistedMsgs = [...persistedCol.messages];
              const lastPersisted = persistedMsgs[persistedMsgs.length - 1];
              persistedMsgs[persistedMsgs.length - 1] = { ...lastPersisted, content: lastPersisted.content + token };
              persistedColumns = { ...persistedColumns, [m.model.id]: { ...persistedCol, messages: persistedMsgs } };
              persistSnapshot(persistedColumns);
            }
            setColumns((prev) => {
              const col = prev[m.model.id];
              if (!col) return prev;
              const msgs = [...col.messages];
              const last = msgs[msgs.length - 1];
              msgs[msgs.length - 1] = { ...last, content: last.content + token };
              return { ...prev, [m.model.id]: { ...col, messages: msgs } };
            });
          },
          onDone(fullText) {
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1) + "s";
            const tokenEst = Math.round(fullText.length / 2);
            const persistedCol = persistedColumns[m.model.id];
            if (persistedCol) {
              const persistedMsgs = [...persistedCol.messages];
              persistedMsgs[persistedMsgs.length - 1] = {
                ...persistedMsgs[persistedMsgs.length - 1],
                loading: false,
                latency: elapsed,
                tokens: tokenEst,
              };
              persistedColumns = { ...persistedColumns, [m.model.id]: { ...persistedCol, messages: persistedMsgs } };
              persistSnapshot(persistedColumns);
            }
            setColumns((prev) => {
              const col = prev[m.model.id];
              if (!col) return prev;
              const msgs = [...col.messages];
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], loading: false, latency: elapsed, tokens: tokenEst };
              return { ...prev, [m.model.id]: { ...col, messages: msgs } };
            });
            remaining--;
            if (remaining <= 0) setIsSending(false);
          },
          onError(err) {
            const persistedCol = persistedColumns[m.model.id];
            if (persistedCol) {
              const persistedMsgs = [...persistedCol.messages];
              persistedMsgs[persistedMsgs.length - 1] = {
                ...persistedMsgs[persistedMsgs.length - 1],
                content: `**错误**: ${err.message}`,
                loading: false,
                latency: "-",
              };
              persistedColumns = { ...persistedColumns, [m.model.id]: { ...persistedCol, messages: persistedMsgs } };
              persistSnapshot(persistedColumns);
            }
            setColumns((prev) => {
              const col = prev[m.model.id];
              if (!col) return prev;
              const msgs = [...col.messages];
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `**错误**: ${err.message}`, loading: false, latency: "-" };
              return { ...prev, [m.model.id]: { ...col, messages: msgs } };
            });
            remaining--;
            if (remaining <= 0) setIsSending(false);
          },
        },
      );
    }
  };

  /* ── Export as Markdown ── */
  const handleExport = () => {
    const visibleColumns = selectedModels.map((m) => columns[m.model.id]).filter(Boolean);
    if (visibleColumns.length === 0) return;

    let md = "# 多模型对比结果\n\n";
    for (const col of visibleColumns) {
      md += `## ${col.name}\n\n`;
      for (const msg of col.messages) {
        if (msg.role === "user") {
          md += `**用户：**\n\n${msg.content}\n\n`;
        } else {
          md += `**${col.name} 回复：**`;
          if (msg.latency) md += ` (${msg.latency}, ~${msg.tokens} tokens)`;
          md += `\n\n${msg.content}\n\n`;
        }
      }
      md += "---\n\n";
    }

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compare-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  };

  const hasAnyMessages = selectedModels.some((m) => (columns[m.model.id]?.messages.length ?? 0) > 0);

  /* ── Auto-scroll: only scroll columns that are actively streaming & user hasn't scrolled away ── */
  useEffect(() => {
    if (!autoScroll) return;
    for (const m of selectedModels) {
      const col = columns[m.model.id];
      if (!col) continue;
      const lastMsg = col.messages[col.messages.length - 1];
      // Only auto-scroll when AI is actively generating
      if (!lastMsg?.loading) continue;
      // Respect user scroll-away
      if (userScrolledAwayRef.current[m.model.id]) continue;
      const el = columnScrollRefs.current[m.model.id];
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [columns, autoScroll, selectedModels]);

  return (
    <div className="flex h-full font-['Inter',sans-serif]">
      {/* ── History Sidebar ── */}
      {sidebarOpen && (
        <div className="w-[220px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0">
          <div className="p-3 flex items-center gap-2">
            <button
              onClick={() => navigate("/compare/new")}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-[8px] bg-[#030213] text-white rounded-[7px] text-[12px] hover:bg-[#1a1a2e] transition-colors"
              style={{ fontWeight: 500 }}
            >
              <Plus className="w-[13px] h-[13px]" />
              新建对比
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="w-[32px] h-[32px] rounded-[7px] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors shrink-0"
            >
              <PanelLeftClose className="w-[14px] h-[14px] text-[#717182]" />
            </button>
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[12px] w-[12px] -translate-y-1/2 text-[#8a9193]" />
              <Input size="xs" className="pl-8" placeholder="搜索对比..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {historyGroups.map((group) => (
              <div key={group.label} className="mb-1.5">
                <p className="px-2 py-1.5 text-[10px] text-[#8a9193]" style={{ fontWeight: 500 }}>{group.label}</p>
                {group.items.map((item) => (
                  <div key={item.id} className="relative group">
                    {renamingId === item.id ? (
                      <div className="flex items-center px-2.5 py-[4px]">
                        <Input
                          autoFocus size="xs" surface="white"
                          className="flex-1 border-[#030213] focus-visible:border-[#030213] focus-visible:ring-[rgba(3,2,19,0.08)]"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRenameCompare(item.id, renameValue); if (e.key === "Escape") setRenamingId(null); }}
                          onBlur={() => handleRenameCompare(item.id, renameValue)}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => navigate(`/compare/${item.id}`)}
                        className={`w-full text-left px-2.5 py-[6px] rounded-[7px] text-[12px] transition-colors flex items-center ${
                          item.id === id ? "bg-[#f3f3f5] text-[#0a0a0a]" : "text-[#0a0a0a] hover:bg-[#f8fafb]"
                        }`}
                        style={{ fontWeight: 400 }}
                      >
                        <span className="truncate flex-1">{item.title}</span>
                        <span
                          className="opacity-0 group-hover:opacity-100 shrink-0"
                          onClick={(e) => { e.stopPropagation(); setContextMenuId(contextMenuId === item.id ? null : item.id); }}
                        >
                          <MoreHorizontal className="w-[12px] h-[12px] text-[#8a9193]" />
                        </span>
                      </button>
                    )}
                    {contextMenuId === item.id && (
                      <div ref={contextMenuRef} className="absolute right-0 top-full mt-0.5 w-[120px] bg-white border border-[rgba(0,0,0,0.1)] rounded-[7px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-30">
                        <button
                          onClick={() => { setRenameValue(item.title); setRenamingId(item.id); setContextMenuId(null); }}
                          className="w-full text-left px-3 py-[5px] text-[11px] text-[#0a0a0a] hover:bg-[#f3f3f5] transition-colors flex items-center gap-2"
                        >
                          <Pencil className="w-[11px] h-[11px] text-[#717182]" /> 重命名
                        </button>
                        <button
                          onClick={() => handleDeleteCompare(item.id)}
                          className="w-full text-left px-3 py-[5px] text-[11px] text-[#dc2626] hover:bg-[#fef2f2] transition-colors flex items-center gap-2"
                        >
                          <Trash2 className="w-[11px] h-[11px]" /> 删除
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
      {/* Sub header */}
      <div className="h-[44px] border-b border-[#ebebeb] flex items-center px-4 gap-3 bg-white shrink-0">
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="w-[28px] h-[28px] rounded-[6px] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors">
            <PanelLeft className="w-[14px] h-[14px] text-[#717182]" />
          </button>
        )}
        <button onClick={() => navigate("/")} className="text-[#667085] hover:text-[#0a0a0a] transition-colors">
          <ArrowLeft className="w-[15px] h-[15px]" />
        </button>
        <span className="text-[13px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>多模型对比</span>

        <div className="flex items-center gap-1.5 ml-3">
          {configuredModels.map((m) => (
            <button
              key={m.model.id}
              onClick={() => toggleChecked(m.model.id)}
              className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border transition-colors ${
                checkedIds.has(m.model.id)
                  ? "bg-[#030213] border-[#030213] text-white"
                  : "border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb]"
              }`}
              style={{ fontWeight: 500 }}
            >
              {m.model.displayName}
            </button>
          ))}
        </div>

        <div className="w-px h-[20px] bg-[#ebebeb] ml-2" />
        <SkillBadges activeSkillIds={activeSkillIds} onOpenPanel={() => setSkillPanelOpen(true)} />

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border transition-colors ${
              autoScroll
                ? "bg-[#030213] border-[#030213] text-white"
                : "border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb]"
            }`}
            style={{ fontWeight: 500 }}
            title={autoScroll ? "关闭自动滚动" : "开启自动滚动"}
          >
            <ChevronsDown className="w-[13px] h-[13px]" />
            自动滚动
          </button>
          <button
            onClick={handleExport}
            disabled={!hasAnyMessages}
            className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb] transition-colors disabled:opacity-30"
            style={{ fontWeight: 500 }}
          >
            <Download className="w-[13px] h-[13px]" />
            导出
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-hidden flex bg-[#f8fafb]">
        {selectedModels.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[13px] text-[#717182]">请至少选择一个模型</p>
          </div>
        ) : !hasAnyMessages ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Sparkles className="w-[32px] h-[32px] text-[#d0d5dd] mx-auto mb-3" />
              <p className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>输入问题开始多模型对比</p>
              <p className="text-[12px] text-[#717182] mt-1" style={{ fontWeight: 400 }}>
                已选 {selectedModels.length} 个模型，发送后将并行回答
              </p>
            </div>
          </div>
        ) : (
          selectedModels.map((m, i) => {
            const col = columns[m.model.id];
            const msgs = col?.messages ?? [];
            return (
              <div key={m.model.id} className={`flex-1 flex flex-col min-w-0 ${i > 0 ? "border-l border-[#ebebeb]" : ""}`}>
                {/* Column Header */}
                <div className="px-4 py-2.5 bg-white border-b border-[#ebebeb] shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-[24px] h-[24px] rounded-full bg-[#030213] flex items-center justify-center">
                      <Sparkles className="w-[10px] h-[10px] text-white" />
                    </div>
                    <span className="text-[13px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{m.model.displayName}</span>
                  </div>
                </div>

                {/* Scrollable message list */}
                <div
                  ref={(el) => { columnScrollRefs.current[m.model.id] = el; }}
                  className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    // If user scrolls away from bottom (>50px threshold), mark as scrolled-away
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
                    userScrolledAwayRef.current[m.model.id] = !atBottom;
                  }}
                >
                  {msgs.map((msg, mi) => (
                    <div key={mi}>
                      {msg.role === "user" ? (
                        <div className="flex gap-2 items-start min-w-0">
                          <div className="w-[24px] h-[24px] rounded-full bg-[#f3f3f5] flex items-center justify-center shrink-0 mt-0.5">
                            <User className="w-[11px] h-[11px] text-[#667085]" />
                          </div>
                          <div className="min-w-0 rounded-[10px] bg-[#030213] text-white px-3.5 py-2.5 text-[13px] leading-[1.7] whitespace-pre-wrap break-words overflow-hidden" style={{ fontWeight: 400 }}>
                            {msg.content}
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 items-start">
                          <div className="w-[24px] h-[24px] rounded-full bg-[#030213] flex items-center justify-center shrink-0 mt-0.5">
                            <Sparkles className="w-[10px] h-[10px] text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Stats bar */}
                            {!msg.loading && msg.latency && (
                              <div className="flex items-center gap-3 mb-1.5">
                                <span className="flex items-center gap-1 text-[10px] text-[#8a9193]">
                                  <Clock className="w-[10px] h-[10px]" /> {msg.latency}
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-[#8a9193]">
                                  <Hash className="w-[10px] h-[10px]" /> {msg.tokens} tok
                                </span>
                              </div>
                            )}
                            <div className="rounded-[10px] bg-white border border-[rgba(0,0,0,0.08)] px-3.5 py-2.5 text-[13px] leading-[1.7]" style={{ fontWeight: 400 }}>
                              {msg.loading && !msg.content ? (
                                <div className="flex items-center gap-2 text-[12px] text-[#717182]">
                                  <Loader2 className="w-[14px] h-[14px] animate-spin" /> 生成中...
                                </div>
                              ) : msg.content ? (
                                <div className={PROSE_CLASSES}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {/* Skill Panel */}
        <SkillPanel
          isOpen={skillPanelOpen}
          onClose={() => setSkillPanelOpen(false)}
          activeSkillIds={activeSkillIds}
          onToggleSkill={toggleSkill}
        />
      </div>

      {/* Input */}
      <ConversationComposer
        containerClassName="px-6"
        contentClassName="max-w-[900px]"
        value={input}
        onChange={setInput}
        onSend={handleSend}
        placeholder={hasAnyMessages ? "继续提问，所有模型将并行回答..." : "输入问题，所有选中模型将并行回答..."}
        actionLabel="发送"
        sending={isSending}
        disabled={isSending || selectedModels.length === 0}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
        topSlot={(pendingAttachments.length > 0 || composerError || isComposerDragActive) ? (
          <div className="space-y-2">
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="inline-flex items-center gap-2 rounded-[10px] border border-[#d9e1f2] bg-[#f7faff] px-2.5 py-1.5 text-[11.5px] text-[#21427f]"
                    style={{ fontWeight: 500 }}
                  >
                    <FileText className="w-[12px] h-[12px] shrink-0" />
                    <span className="max-w-[180px] truncate">{attachment.name}</span>
                    <span className="text-[#6b7ba5]" style={{ fontWeight: 400 }}>{formatAttachmentSize(attachment.size)}</span>
                    <button
                      type="button"
                      onClick={() => removePendingAttachment(attachment.id)}
                      className="rounded-full p-0.5 text-[#6b7ba5] transition-colors hover:bg-[#e6eefc] hover:text-[#21427f]"
                      aria-label={`移除 ${attachment.name}`}
                    >
                      <X className="w-[11px] h-[11px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {isComposerDragActive && (
              <div className="rounded-[10px] border border-dashed border-[#90a9de] bg-[#f5f8ff] px-3 py-2 text-[11.5px] text-[#415a9b]">
                松开即可上传，支持 Markdown、代码文件和常见文本文件。
              </div>
            )}
            {composerError && (
              <p className="text-[11.5px] text-[#dc2626]">{composerError}</p>
            )}
          </div>
        ) : undefined}
        leftSlot={
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={CHAT_ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(event) => {
                setIsAttachmentMenuOpen(false);
                if (event.target.files?.length) void handleSelectedFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <DropdownMenu open={isAttachmentMenuOpen} onOpenChange={setIsAttachmentMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#111827]"
                  aria-label="添加附件"
                >
                  <Plus className="h-[16px] w-[16px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                collisionPadding={12}
                className="w-[180px] rounded-[10px] border-[#e5e7eb] p-1.5"
              >
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setIsAttachmentMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="gap-2 rounded-[8px] px-3 py-2 text-[12px] text-[#0a0a0a]"
                >
                  <Upload className="w-[14px] h-[14px] text-[#415a9b]" />
                  上传文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      </div>
    </div>
  );
}