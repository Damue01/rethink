import type { ReactNode } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { Textarea } from "./textarea";
import { cn } from "./utils";

interface ConversationComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  actionLabel?: string;
  hint?: ReactNode;
  disabled?: boolean;
  sending?: boolean;
  rows?: number;
  containerClassName?: string;
  contentClassName?: string;
  composerClassName?: string;
  textareaClassName?: string;
  leftSlot?: ReactNode;
  topSlot?: ReactNode;
  canSend?: boolean;
  dragActive?: boolean;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}

export function ConversationComposer({
  value,
  onChange,
  onSend,
  placeholder,
  actionLabel = "发送",
  hint,
  disabled = false,
  sending = false,
  rows = 1,
  containerClassName,
  contentClassName,
  composerClassName,
  textareaClassName,
  leftSlot,
  topSlot,
  canSend,
  dragActive = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: ConversationComposerProps) {
  const sendDisabled = disabled || !(canSend ?? Boolean(value.trim()));

  return (
    <div className={cn("bg-white px-5 py-3", containerClassName)}>
      <div className={cn("mx-auto", contentClassName)}>
        {topSlot ? <div className="mb-2">{topSlot}</div> : null}
        <div
          className={cn(
            "rounded-[24px] border border-[#d9d9d9] bg-white transition-all duration-200 focus-within:border-[#b0b0b0] focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.04)]",
            dragActive && "border-[#415a9b] bg-[#f8fbff] shadow-[0_0_0_3px_rgba(65,90,155,0.08)]",
            composerClassName,
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="flex items-end gap-2 px-2 py-1.5">
            {leftSlot}
            <Textarea
              surface="ghost"
              rows={rows}
              value={value}
              placeholder={placeholder}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!sendDisabled) onSend();
                }
              }}
              className={cn(
                "flex-1 max-h-[120px] min-h-[32px] h-[32px] px-2 py-0 text-[14px] leading-[32px] text-[#0a0a0a] placeholder:text-[#b0b0b0] placeholder:leading-[32px]",
                textareaClassName,
              )}
              style={{ fontWeight: 400 }}
            />
            <button
              onClick={onSend}
              disabled={sendDisabled}
              className="flex items-center justify-center w-[32px] h-[32px] rounded-full bg-[#1a1a1a] text-white transition-colors hover:bg-[#333] disabled:bg-[#e0e0e0] disabled:text-[#a0a0a0] shrink-0"
            >
              {sending ? (
                <Loader2 className="h-[14px] w-[14px] animate-spin" />
              ) : (
                <ArrowUp className="h-[14px] w-[14px]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}