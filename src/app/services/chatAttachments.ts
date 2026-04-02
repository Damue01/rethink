const SUPPORTED_FILE_TYPES = new Map<string, { label: string; language: string }>([
  ["md", { label: "Markdown", language: "markdown" }],
  ["markdown", { label: "Markdown", language: "markdown" }],
  ["txt", { label: "Text", language: "text" }],
  ["text", { label: "Text", language: "text" }],
  ["js", { label: "JavaScript", language: "javascript" }],
  ["jsx", { label: "JavaScript", language: "jsx" }],
  ["mjs", { label: "JavaScript", language: "javascript" }],
  ["cjs", { label: "JavaScript", language: "javascript" }],
  ["ts", { label: "TypeScript", language: "typescript" }],
  ["tsx", { label: "TypeScript", language: "tsx" }],
  ["json", { label: "JSON", language: "json" }],
  ["jsonc", { label: "JSON", language: "json" }],
  ["yml", { label: "YAML", language: "yaml" }],
  ["yaml", { label: "YAML", language: "yaml" }],
  ["xml", { label: "XML", language: "xml" }],
  ["html", { label: "HTML", language: "html" }],
  ["htm", { label: "HTML", language: "html" }],
  ["css", { label: "CSS", language: "css" }],
  ["scss", { label: "SCSS", language: "scss" }],
  ["less", { label: "LESS", language: "less" }],
  ["svg", { label: "SVG", language: "xml" }],
  ["py", { label: "Python", language: "python" }],
  ["java", { label: "Java", language: "java" }],
  ["kt", { label: "Kotlin", language: "kotlin" }],
  ["kts", { label: "Kotlin", language: "kotlin" }],
  ["go", { label: "Go", language: "go" }],
  ["rs", { label: "Rust", language: "rust" }],
  ["c", { label: "C", language: "c" }],
  ["cc", { label: "C++", language: "cpp" }],
  ["cpp", { label: "C++", language: "cpp" }],
  ["cxx", { label: "C++", language: "cpp" }],
  ["h", { label: "Header", language: "c" }],
  ["hpp", { label: "Header", language: "cpp" }],
  ["cs", { label: "C#", language: "csharp" }],
  ["php", { label: "PHP", language: "php" }],
  ["rb", { label: "Ruby", language: "ruby" }],
  ["swift", { label: "Swift", language: "swift" }],
  ["scala", { label: "Scala", language: "scala" }],
  ["sql", { label: "SQL", language: "sql" }],
  ["sh", { label: "Shell", language: "bash" }],
  ["bash", { label: "Shell", language: "bash" }],
  ["zsh", { label: "Shell", language: "bash" }],
  ["ps1", { label: "PowerShell", language: "powershell" }],
  ["bat", { label: "Batch", language: "bat" }],
  ["cmd", { label: "Batch", language: "bat" }],
  ["toml", { label: "TOML", language: "toml" }],
  ["ini", { label: "INI", language: "ini" }],
  ["conf", { label: "Config", language: "ini" }],
  ["config", { label: "Config", language: "ini" }],
  ["log", { label: "Log", language: "text" }],
  ["vue", { label: "Vue", language: "vue" }],
  ["svelte", { label: "Svelte", language: "svelte" }],
  ["dockerfile", { label: "Dockerfile", language: "dockerfile" }],
  ["makefile", { label: "Makefile", language: "makefile" }],
]);

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "image/svg+xml",
]);

export const MAX_CHAT_ATTACHMENT_COUNT = 5;
export const MAX_CHAT_ATTACHMENT_SIZE_BYTES = 400 * 1024;
export const MAX_CHAT_ATTACHMENT_TEXT_LENGTH = 12000;

export const CHAT_ATTACHMENT_ACCEPT = [
  ".md",
  ".markdown",
  ".txt",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".rb",
  ".swift",
  ".scala",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".toml",
  ".ini",
  ".conf",
  ".config",
  ".log",
  ".vue",
  ".svelte",
  "text/*",
  "application/json",
  "application/xml",
  "application/javascript",
  "image/svg+xml",
].join(",");

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  typeLabel: string;
  language: string;
  text: string;
  truncated: boolean;
}

export interface AttachmentParseIssue {
  fileName: string;
  reason: string;
}

export interface AttachmentParseResult {
  attachments: ChatAttachment[];
  rejected: AttachmentParseIssue[];
}

function getFileKey(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot >= 0 && lastDot < normalized.length - 1) {
    return normalized.slice(lastDot + 1);
  }
  return normalized;
}

function resolveFileType(file: File): { label: string; language: string } | null {
  const fileKey = getFileKey(file.name);
  if (SUPPORTED_FILE_TYPES.has(fileKey)) {
    return SUPPORTED_FILE_TYPES.get(fileKey) ?? null;
  }

  const mimeType = file.type.toLowerCase();
  if (TEXT_MIME_TYPES.has(mimeType) || TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return { label: "Text", language: "text" };
  }

  return null;
}

export async function readChatAttachments(files: File[]): Promise<AttachmentParseResult> {
  const attachments: ChatAttachment[] = [];
  const rejected: AttachmentParseIssue[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const fileType = resolveFileType(file);
    if (!fileType) {
      rejected.push({ fileName: file.name, reason: "暂不支持该文件类型" });
      continue;
    }

    if (file.size > MAX_CHAT_ATTACHMENT_SIZE_BYTES) {
      rejected.push({
        fileName: file.name,
        reason: `文件超过 ${Math.round(MAX_CHAT_ATTACHMENT_SIZE_BYTES / 1024)} KB 限制`,
      });
      continue;
    }

    try {
      const rawText = (await file.text()).replace(/\r\n/g, "\n");
      const truncated = rawText.length > MAX_CHAT_ATTACHMENT_TEXT_LENGTH;
      const text = truncated ? rawText.slice(0, MAX_CHAT_ATTACHMENT_TEXT_LENGTH) : rawText;

      attachments.push({
        id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        typeLabel: fileType.label,
        language: fileType.language,
        text,
        truncated,
      });
    } catch {
      rejected.push({ fileName: file.name, reason: "读取文件失败" });
    }
  }

  return { attachments, rejected };
}

export function buildOutgoingUserMessage(input: string, attachments: ChatAttachment[]): {
  displayContent: string;
  promptContent: string;
} {
  const trimmedInput = input.trim();
  const displayContent = trimmedInput || `请阅读我上传的 ${attachments.length} 个文件，并结合内容继续回答。`;

  if (attachments.length === 0) {
    return { displayContent, promptContent: displayContent };
  }

  const attachmentBlocks = attachments.map((attachment, index) => {
    const suffix = attachment.truncated ? "\n[内容已截断，仅发送前一部分用于分析]" : "";
    return [
      `### 附件 ${index + 1}: ${attachment.name}`,
      `- 类型: ${attachment.typeLabel}`,
      `- 大小: ${formatAttachmentSize(attachment.size)}`,
      "```" + attachment.language,
      attachment.text,
      "```" + suffix,
    ].join("\n");
  });

  return {
    displayContent,
    promptContent: [
      displayContent,
      "",
      "请结合以下附件内容一起理解和回答。",
      "",
      ...attachmentBlocks,
    ].join("\n"),
  };
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}