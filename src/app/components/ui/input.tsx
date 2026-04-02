import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const inputVariants = cva(
  "flex w-full min-w-0 rounded-[7px] border border-transparent text-[#0a0a0a] shadow-none outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[#717182] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium selection:bg-[#030213] selection:text-white focus-visible:border-[#415a9b] focus-visible:ring-[3px] focus-visible:ring-[rgba(65,90,155,0.12)] aria-invalid:border-[#d4183d] aria-invalid:ring-[3px] aria-invalid:ring-[rgba(212,24,61,0.12)]",
  {
    variants: {
      size: {
        default: "h-[35px] px-3.5 py-[8px] text-[12.5px]",
        sm: "h-[32px] px-3 py-[7px] text-[12px]",
        xs: "h-[28px] px-2.5 py-[5px] text-[11.5px]",
      },
      surface: {
        subtle: "bg-[#f3f3f5]",
        white: "border border-[rgba(0,0,0,0.08)] bg-white",
        ghost: "h-auto rounded-none border-0 bg-transparent px-0 py-0 ring-0 focus-visible:border-transparent focus-visible:ring-0",
      },
    },
    defaultVariants: {
      size: "default",
      surface: "subtle",
    },
  },
);

type InputProps = React.ComponentProps<"input"> &
  VariantProps<typeof inputVariants>;

function Input({ className, type, size, surface, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputVariants({ size, surface }),
        className,
      )}
      {...props}
    />
  );
}

export { Input, inputVariants };
