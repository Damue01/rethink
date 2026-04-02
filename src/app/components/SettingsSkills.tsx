import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus, Search, Trash2,
  Upload, Download, Pencil, Save, Tag
} from "lucide-react";
import { defaultSkills, type Skill, type SkillCategory, loadSkills, saveSkills, loadCategories, saveCategories, parseFrontmatter, composeFrontmatter } from "./skillData";
import { EmojiPicker } from "./EmojiPicker";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function SettingsSkills() {
  const [searchParams] = useSearchParams();
  const initialSkills = loadSkills();
  const urlSkillId = searchParams.get("skillId");
  const initialSelected = (urlSkillId && initialSkills.find(s => s.id === urlSkillId)) || initialSkills[0] || defaultSkills[0];

  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [selectedSkill, setSelectedSkill] = useState<Skill>(initialSelected);
  const [searchQuery, setSearchQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [editSource, setEditSource] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [categories, setCategories] = useState<SkillCategory[]>(() => loadCategories());
  const [newTagName, setNewTagName] = useState("");
  const [showNewTagInput, setShowNewTagInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const newTagInputRef = useRef<HTMLInputElement>(null);

  // Close popovers on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojiPicker(false);
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setShowCategoryMenu(false);
        setShowNewTagInput(false);
        setNewTagName("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-focus new tag input
  useEffect(() => {
    if (showNewTagInput && newTagInputRef.current) {
      newTagInputRef.current.focus();
    }
  }, [showNewTagInput]);

  const updateSkills = (newSkills: Skill[]) => {
    setSkills(newSkills);
    saveSkills(newSkills);
  };

  const updateSelectedSkill = (patch: Partial<Skill>) => {
    const newSkill = { ...selectedSkill, ...patch, updatedAt: new Date().toLocaleDateString("zh-CN") };
    const updated = skills.map(s => s.id === selectedSkill.id ? newSkill : s);
    updateSkills(updated);
    setSelectedSkill(newSkill);
  };

  const handleCreate = () => {
    const newSkill: Skill = {
      id: `sk-${Date.now()}`,
      name: "新 Skill",
      emoji: "⚡",
      description: "自定义审查 Skill",
      category: "custom",
      content: "# 新 Skill\n\n在这里编写审查标准...\n",
      isBuiltin: false,
      updatedAt: new Date().toLocaleDateString("zh-CN"),
    };
    updateSkills([...skills, newSkill]);
    setSelectedSkill(newSkill);
    setEditing(true);
    setEditSource(composeFrontmatter(newSkill.name, newSkill.description, newSkill.content, newSkill.category));
  };

  const handleDelete = (skillId: string) => {
    const updated = skills.filter(s => s.id !== skillId);
    updateSkills(updated);
    if (selectedSkill.id === skillId) {
      setSelectedSkill(updated[0] ?? defaultSkills[0]);
    }
    setEditing(false);
  };

  const handleStartEdit = () => {
    setEditSource(composeFrontmatter(selectedSkill.name, selectedSkill.description, selectedSkill.content, selectedSkill.category));
    setEditing(true);
  };

  const handleSave = () => {
    const parsed = parseFrontmatter(editSource);
    if (parsed.category) ensureCategoryExists(parsed.category);
    updateSelectedSkill({
      name: parsed.name || selectedSkill.name,
      description: parsed.description || selectedSkill.description,
      category: parsed.category || selectedSkill.category,
      content: parsed.body,
    });
    setEditing(false);
  };

  const handleExport = () => {
    const fullMd = composeFrontmatter(selectedSkill.name, selectedSkill.description, selectedSkill.content, selectedSkill.category);
    const blob = new Blob([fullMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedSkill.name}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const parsed = parseFrontmatter(text);
      if (parsed.category) ensureCategoryExists(parsed.category);
      updateSelectedSkill({
        name: parsed.name || selectedSkill.name,
        description: parsed.description || selectedSkill.description,
        category: parsed.category || selectedSkill.category,
        content: parsed.body,
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleEmojiSelect = (emoji: string) => {
    updateSelectedSkill({ emoji });
  };

  const handleCategoryChange = (category: string) => {
    updateSelectedSkill({ category });
    setShowCategoryMenu(false);
    setShowNewTagInput(false);
    setNewTagName("");
  };

  const handleCreateTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    const id = `tag-${Date.now()}`;
    const newCat: SkillCategory = { id, label: name, emoji: "🏷️" };
    const updated = [...categories, newCat];
    setCategories(updated);
    saveCategories(updated);
    updateSelectedSkill({ category: id });
    setShowCategoryMenu(false);
    setShowNewTagInput(false);
    setNewTagName("");
  };

  const ensureCategoryExists = (catId: string) => {
    if (!categories.find(c => c.id === catId)) {
      const newCat: SkillCategory = { id: catId, label: catId, emoji: "🏷️" };
      const updated = [...categories, newCat];
      setCategories(updated);
      saveCategories(updated);
    }
  };

  const filtered = skills.filter(
    (s) => !searchQuery || s.name.includes(searchQuery) || s.description.includes(searchQuery)
  );

  const grouped = categories
    .map((cat) => ({ ...cat, skills: filtered.filter((s) => s.category === cat.id) }))
    .filter((g) => g.skills.length > 0);

  const contentLines = selectedSkill.content.split("\n").length;

  return (
    <div className="h-full flex font-['Inter',sans-serif]">
      {/* Left - Skill List */}
      <div className="w-[280px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-[#ebebeb]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[16px]">🧩</span>
              <p className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>Skill 管理</p>
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
          {grouped.map((group) => (
            <div key={group.id} className="mb-2">
              <p className="px-2 py-1.5 text-[10px] text-[#8a9193]" style={{ fontWeight: 500 }}>
                {group.emoji} {group.label}
              </p>
              {group.skills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => { setSelectedSkill(skill); setEditing(false); }}
                  className={`w-full text-left px-3 py-2.5 rounded-[8px] transition-colors flex items-center gap-2.5 ${
                    selectedSkill.id === skill.id ? "bg-[#f3f3f5]" : "hover:bg-[#f8fafb]"
                  }`}
                >
                  <span className="text-[16px] shrink-0">{skill.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>{skill.name}</p>
                    <p className="text-[10px] text-[#717182] mt-0.5 truncate" style={{ fontWeight: 400 }}>
                      {skill.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Center - Skill Detail */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#f8fafb]">
        {/* Header */}
        <div className="px-6 py-5 bg-white border-b border-[#ebebeb] shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {/* Emoji - clickable */}
              <div ref={emojiRef} className="relative">
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="text-[32px] hover:bg-[#f3f3f5] rounded-[8px] w-[48px] h-[48px] flex items-center justify-center transition-colors"
                  title="更换图标"
                >
                  {selectedSkill.emoji}
                </button>
                {showEmojiPicker && (
                  <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
                )}
              </div>
              <div>
                <p className="text-[17px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{selectedSkill.name}</p>
                <p className="text-[12.5px] text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>
                  {selectedSkill.description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {/* Category - clickable dropdown */}
                  <div ref={categoryRef} className="relative">
                    <button
                      onClick={() => setShowCategoryMenu(!showCategoryMenu)}
                      className="text-[10px] px-[6px] py-[2px] rounded-[4px] bg-[#f3f3f5] text-[#717182] hover:bg-[#ebebeb] transition-colors cursor-pointer"
                      style={{ fontWeight: 500 }}
                    >
                      {categories.find((c) => c.id === selectedSkill.category)?.emoji ?? "🏷️"}{" "}
                      {categories.find((c) => c.id === selectedSkill.category)?.label ?? selectedSkill.category}
                    </button>
                    {showCategoryMenu && (
                      <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-[8px] border border-[rgba(0,0,0,0.12)] shadow-lg py-1 min-w-[140px]">
                        {categories.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => handleCategoryChange(cat.id)}
                            className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#f8fafb] transition-colors flex items-center gap-1.5 ${
                              selectedSkill.category === cat.id ? "text-[#415a9b] bg-[#f0f4ff]" : "text-[#0a0a0a]"
                            }`}
                            style={{ fontWeight: 400 }}
                          >
                            <span>{cat.emoji}</span>
                            <span>{cat.label}</span>
                          </button>
                        ))}
                        <div className="border-t border-[rgba(0,0,0,0.06)] mt-1 pt-1">
                          {showNewTagInput ? (
                            <div className="px-2 py-1 flex items-center gap-1">
                              <input
                                ref={newTagInputRef}
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleCreateTag(); if (e.key === "Escape") { setShowNewTagInput(false); setNewTagName(""); } }}
                                placeholder="标签名称…"
                                className="flex-1 text-[11px] px-2 py-1 border border-[rgba(0,0,0,0.12)] rounded-[5px] outline-none focus:border-[#415a9b]"
                              />
                              <button onClick={handleCreateTag} className="text-[10px] px-1.5 py-1 bg-[#030213] text-white rounded-[5px] hover:bg-[#1a1a2e]" style={{ fontWeight: 500 }}>
                                确定
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowNewTagInput(true)}
                              className="w-full text-left px-3 py-1.5 text-[11px] text-[#415a9b] hover:bg-[#f0f4ff] transition-colors flex items-center gap-1.5"
                              style={{ fontWeight: 500 }}
                            >
                              <Tag className="w-[11px] h-[11px]" />
                              <span>新建标签…</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {selectedSkill.isBuiltin && (
                    <span className="text-[10px] px-[6px] py-[2px] rounded-[4px] bg-[#f0f4ff] text-[#415a9b]" style={{ fontWeight: 500 }}>
                      内置
                    </span>
                  )}
                  <span className="text-[10px] text-[#8a9193]" style={{ fontWeight: 400 }}>
                    更新于 {selectedSkill.updatedAt} · {contentLines} 行
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-1.5">
              {/* Edit / Save toggle */}
              {editing ? (
                <button
                  onClick={handleSave}
                  title="保存"
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#415a9b] bg-[#f0f4ff] hover:bg-[#e0e8ff] flex items-center justify-center transition-colors"
                >
                  <Save className="w-[14px] h-[14px]" />
                </button>
              ) : (
                <button
                  onClick={handleStartEdit}
                  title="编辑 Markdown 源码"
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#717182] hover:bg-[#f8fafb] flex items-center justify-center transition-colors"
                >
                  <Pencil className="w-[14px] h-[14px]" />
                </button>
              )}
              {/* Import */}
              <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt" className="hidden" onChange={handleImport} />
              <button
                onClick={() => fileInputRef.current?.click()}
                title="导入 .md 文件"
                className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#717182] hover:bg-[#f8fafb] flex items-center justify-center transition-colors"
              >
                <Upload className="w-[14px] h-[14px]" />
              </button>
              {/* Export */}
              <button
                onClick={handleExport}
                title="导出 .md 文件"
                className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#717182] hover:bg-[#f8fafb] flex items-center justify-center transition-colors"
              >
                <Download className="w-[14px] h-[14px]" />
              </button>
              {/* Delete */}
              {!selectedSkill.isBuiltin && (
                <button onClick={() => handleDelete(selectedSkill.id)} className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-colors">
                  <Trash2 className="w-[14px] h-[14px]" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-6">
          {editing ? (
            <Textarea
              surface="white"
              className="h-full w-full p-5 font-mono text-[13px] leading-[1.8]"
              value={editSource}
              onChange={(e) => setEditSource(e.target.value)}
              style={{ fontWeight: 400 }}
              spellCheck={false}
            />
          ) : (
            <div className="h-full overflow-y-auto bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] p-6">
              <div className="prose prose-sm max-w-none prose-headings:text-[#0a0a0a] prose-p:text-[#0a0a0a] prose-li:text-[#0a0a0a] prose-strong:text-[#0a0a0a] prose-code:text-[#415a9b] prose-code:bg-[#f0f4ff] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-hr:border-[#ebebeb]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedSkill.content}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
