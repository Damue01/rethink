import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Plus, PanelLeftClose, Search, MoreHorizontal, Trash2, Pencil,
} from "lucide-react";
import { Input } from "./ui/input";
import { useIsMobile } from "./ui/use-mobile";
import { Sheet, SheetContent } from "./ui/sheet";

export interface HistoryGroup {
  label: string;
  items: { id: string; title: string }[];
}

interface HistorySidebarProps {
  /** Route prefix, e.g. "/chat", "/compare", "/debate" */
  routePrefix: string;
  /** Currently active item id (from route params) */
  activeId?: string;
  /** Label for the "new" button, e.g. "新建对话" */
  newLabel: string;
  /** Search placeholder, e.g. "搜索对话..." */
  searchPlaceholder: string;
  /** Grouped history items */
  groups: HistoryGroup[];
  /** Close the sidebar */
  onClose: () => void;
  /** Rename a conversation */
  onRename: (id: string, newTitle: string) => void;
  /** Delete a conversation */
  onDelete: (id: string) => void;
  /** Whether the sidebar is open (used for mobile Sheet) */
  open?: boolean;
}

export function HistorySidebar({
  routePrefix,
  activeId,
  newLabel,
  searchPlaceholder,
  groups,
  onClose,
  onRename,
  onDelete,
  open,
}: HistorySidebarProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuId) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenuId]);

  const handleRename = (id: string, newTitle: string) => {
    onRename(id, newTitle);
    setRenamingId(null);
  };

  // Filter groups by search query
  const filtered = searchQuery
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter((item) =>
            item.title.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter((g) => g.items.length > 0)
    : groups;

  const sidebarContent = (
    <div className={isMobile ? "flex flex-col h-full" : "w-[220px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0"}>
      <div className="p-3 flex items-center gap-2">
        <button
          onClick={() => { navigate(`${routePrefix}/new`); if (isMobile) onClose(); }}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-[8px] bg-[#030213] text-white rounded-[7px] text-[12px] hover:bg-[#1a1a2e] transition-colors"
          style={{ fontWeight: 500 }}
        >
          <Plus className="w-[13px] h-[13px]" />
          {newLabel}
        </button>
        {!isMobile && (
          <button
            onClick={onClose}
            className="w-[32px] h-[32px] rounded-[7px] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors shrink-0"
          >
            <PanelLeftClose className="w-[14px] h-[14px] text-[#717182]" />
          </button>
        )}
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[12px] w-[12px] -translate-y-1/2 text-[#8a9193]" />
          <Input
            size="xs"
            className="pl-8"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((group) => (
          <div key={group.label} className="mb-1.5">
            <p
              className="px-2 py-1.5 text-[10px] text-[#8a9193]"
              style={{ fontWeight: 500 }}
            >
              {group.label}
            </p>
            {group.items.map((item) => (
              <div key={item.id} className="relative group">
                {renamingId === item.id ? (
                  <div className="flex items-center px-2.5 py-[4px]">
                    <Input
                      autoFocus
                      size="xs"
                      surface="white"
                      className="flex-1 border-[#030213] focus-visible:border-[#030213] focus-visible:ring-[rgba(3,2,19,0.08)]"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(item.id, renameValue);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => handleRename(item.id, renameValue)}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => { navigate(`${routePrefix}/${item.id}`); if (isMobile) onClose(); }}
                    className={`w-full text-left px-2.5 py-[6px] rounded-[7px] text-[12px] transition-colors flex items-center ${
                      item.id === activeId
                        ? "bg-[#f3f3f5] text-[#0a0a0a]"
                        : "text-[#0a0a0a] hover:bg-[#f8fafb]"
                    }`}
                    style={{ fontWeight: 400 }}
                  >
                    <span className="truncate flex-1">{item.title}</span>
                    <span
                      className="opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenuId(contextMenuId === item.id ? null : item.id);
                      }}
                    >
                      <MoreHorizontal className="w-[12px] h-[12px] text-[#8a9193]" />
                    </span>
                  </button>
                )}
                {contextMenuId === item.id && (
                  <div
                    ref={contextMenuRef}
                    className="absolute right-0 top-full mt-0.5 w-[120px] bg-white border border-[rgba(0,0,0,0.1)] rounded-[7px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-30"
                  >
                    <button
                      onClick={() => {
                        setRenameValue(item.title);
                        setRenamingId(item.id);
                        setContextMenuId(null);
                      }}
                      className="w-full text-left px-3 py-[5px] text-[11px] text-[#0a0a0a] hover:bg-[#f3f3f5] transition-colors flex items-center gap-2"
                    >
                      <Pencil className="w-[11px] h-[11px] text-[#717182]" />
                      重命名
                    </button>
                    <button
                      onClick={() => {
                        onDelete(item.id);
                        setContextMenuId(null);
                      }}
                      className="w-full text-left px-3 py-[5px] text-[11px] text-[#dc2626] hover:bg-[#fef2f2] transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="w-[11px] h-[11px]" />
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open ?? true} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent side="left" className="w-[85vw] max-w-[320px] p-0">
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  return sidebarContent;
}
