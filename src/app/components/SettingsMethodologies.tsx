import { useState, useRef, useEffect } from "react";
import { Plus, Search, Trash2, Pencil, Save } from "lucide-react";
import { loadMethodologies, saveMethodologies, defaultMethodologies, type Methodology } from "../services/methodologies";
import { EmojiPicker } from "./EmojiPicker";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function SettingsMethodologies() {
  const [methodologies, setMethodologies] = useState<Methodology[]>(() => loadMethodologies());
  const [selected, setSelected] = useState<Methodology>(() => loadMethodologies()[0] ?? defaultMethodologies[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  // Close popovers on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const persist = (next: Methodology[]) => {
    setMethodologies(next);
    saveMethodologies(next);
  };

  const updateSelected = (patch: Partial<Methodology>) => {
    const updated = { ...selected, ...patch };
    persist(methodologies.map((m) => (m.id === selected.id ? updated : m)));
    setSelected(updated);
  };

  const handleCreate = () => {
    const newItem: Methodology = {
      id: `method-${Date.now()}`,
      name: "新方法论",
      emoji: "⚡",
      description: "自定义方法论描述",
      prompt: "请使用此方法论进行分析...",
      isBuiltin: false,
    };
    persist([...methodologies, newItem]);
    setSelected(newItem);
    setEditing(true);
  };

  const handleDelete = (id: string) => {
    if (methodologies.find((m) => m.id === id)?.isBuiltin) return;
    const next = methodologies.filter((m) => m.id !== id);
    persist(next);
    if (selected.id === id) {
      setSelected(next[0] ?? defaultMethodologies[0]);
    }
    setEditing(false);
  };

  const filtered = methodologies.filter(
    (m) => !searchQuery || m.name.includes(searchQuery) || m.description.includes(searchQuery)
  );

  return (
    <div className="h-full flex font-['Inter',sans-serif]">
      {/* Left - List */}
      <div className="w-[280px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-[#ebebeb]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[16px]">📐</span>
              <p className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>方法论管理</p>
            </div>
            <button onClick={handleCreate} className="w-[28px] h-[28px] bg-[#030213] text-white rounded-[7px] flex items-center justify-center hover:bg-[#1a1a2e] transition-colors">
              <Plus className="w-[14px] h-[14px]" />
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-[#8a9193]" />
            <Input
              className="pl-8"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => { setSelected(m); setEditing(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-[8px] transition-colors flex items-center gap-2.5 ${
                selected.id === m.id ? "bg-[#f3f3f5]" : "hover:bg-[#f8fafb]"
              }`}
            >
              <span className="text-[16px] shrink-0">{m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>{m.name}</p>
                <p className="text-[10px] text-[#717182] mt-0.5 truncate" style={{ fontWeight: 400 }}>
                  {m.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right - Detail */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#f8fafb]">
        {/* Header */}
        <div className="px-4 md:px-6 py-4 md:py-5 bg-white border-b border-[#ebebeb] shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {/* Emoji - clickable */}
              <div ref={emojiRef} className="relative">
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="text-[32px] hover:bg-[#f3f3f5] rounded-[8px] w-[48px] h-[48px] flex items-center justify-center transition-colors"
                  title="更换图标"
                >
                  {selected.emoji}
                </button>
                {showEmojiPicker && (
                  <EmojiPicker onSelect={(emoji) => updateSelected({ emoji })} onClose={() => setShowEmojiPicker(false)} />
                )}
              </div>
              <div>
                <p className="text-[17px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{selected.name}</p>
                <p className="text-[12.5px] text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>
                  {selected.description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {selected.isBuiltin && (
                    <span className="text-[10px] px-[6px] py-[2px] rounded-[4px] bg-[#f0f4ff] text-[#415a9b]" style={{ fontWeight: 500 }}>
                      内置
                    </span>
                  )}
                  {selected.id === "none" && (
                    <span className="text-[10px] px-[6px] py-[2px] rounded-[4px] bg-[#f3f3f5] text-[#8a9193]" style={{ fontWeight: 500 }}>
                      默认
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-1.5">
              {editing ? (
                <button
                  onClick={() => setEditing(false)}
                  title="保存"
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#415a9b] bg-[#f0f4ff] hover:bg-[#e0e8ff] flex items-center justify-center transition-colors"
                >
                  <Save className="w-[14px] h-[14px]" />
                </button>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  title="编辑"
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#717182] hover:bg-[#f8fafb] flex items-center justify-center transition-colors"
                >
                  <Pencil className="w-[14px] h-[14px]" />
                </button>
              )}
              {!selected.isBuiltin && (
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-colors"
                >
                  <Trash2 className="w-[14px] h-[14px]" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-6">
          {editing ? (
            <div className="h-full overflow-y-auto bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="text-[11px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>名称</label>
                <Input
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
              </div>
              {/* Description */}
              <div>
                <label className="text-[11px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>描述</label>
                <Input
                  value={selected.description}
                  onChange={(e) => updateSelected({ description: e.target.value })}
                />
              </div>
              {/* System Prompt */}
              <div>
                <label className="text-[11px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>
                  System Prompt
                </label>
                <Textarea
                  surface="white"
                  className="min-h-[240px] font-mono text-[13px] leading-[1.8]"
                  value={selected.prompt}
                  onChange={(e) => updateSelected({ prompt: e.target.value })}
                  placeholder="请使用此方法论进行分析..."
                  style={{ fontWeight: 400 }}
                />
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] p-6">
              <label className="text-[11px] text-[#717182] mb-2 block" style={{ fontWeight: 500 }}>
                System Prompt {selected.id === "none" && <span className="text-[#8a9193]">（无方法论时不注入额外 prompt）</span>}
              </label>
              <div className="bg-[#f8fafb] rounded-[7px] border border-[rgba(0,0,0,0.06)] px-3.5 py-3 text-[12.5px] text-[#0a0a0a] leading-[1.7] whitespace-pre-wrap min-h-[80px]" style={{ fontWeight: 400 }}>
                {selected.prompt || "（空）"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
