import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const textareaVariants = cva(
  "flex w-full rounded-[10px] border border-transparent text-[#0a0a0a] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[#717182] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-[#415a9b] focus-visible:ring-[3px] focus-visible:ring-[rgba(65,90,155,0.12)] aria-invalid:border-[#d4183d] aria-invalid:ring-[3px] aria-invalid:ring-[rgba(212,24,61,0.12)]",
  {
    variants: {
      size: {
        default: "min-h-[44px] px-4 py-3 text-[12.5px] leading-[1.6]",
        sm: "min-h-[68px] px-3 py-2 text-[12px] leading-[1.6]",
      },
      surface: {
        subtle: "bg-[#f3f3f5]",
        white: "border border-[rgba(0,0,0,0.08)] bg-white",
        ghost: "rounded-none border-0 bg-transparent px-0 py-0 ring-0 focus-visible:border-transparent focus-visible:ring-0",
      },
    },
    defaultVariants: {
      size: "default",
      surface: "subtle",
    },
  },
);

type TextareaProps = React.ComponentProps<"textarea"> &
  VariantProps<typeof textareaVariants>;

function Textarea({ className, size, surface, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content resize-none",
        textareaVariants({ size, surface }),
        className,
      )}
      {...props}
    />
  );
}

export { Textarea, textareaVariants };
