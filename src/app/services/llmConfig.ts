/** Persistent LLM configuration stored in localStorage */

export interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
  temperature: number;
  maxTokens: number;
  isDefault: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  isActive: boolean;
  models: ModelConfig[];
}

const STORAGE_KEY = "ai-review-llm-config";

const defaultProviders: ProviderConfig[] = [
  {
    id: "default",
    name: "OpenAI Compatible",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    isActive: true,
    models: [],
  },
];

export function loadProviders(): ProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProviderConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return defaultProviders;
}

export function saveProviders(providers: ProviderConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

/** Get the default model config across all providers */
export function getDefaultModel(): { provider: ProviderConfig; model: ModelConfig } | null {
  const providers = loadProviders();
  for (const p of providers) {
    if (!p.isActive) continue;
    const m = p.models.find((m) => m.isDefault);
    if (m) return { provider: p, model: m };
  }
  // Fallback to first active provider's first model
  for (const p of providers) {
    if (p.isActive && p.models.length > 0) {
      return { provider: p, model: p.models[0] };
    }
  }
  return null;
}

/** Get all available models from active providers */
export function getAllModels(): Array<{ providerId: string; providerName: string; model: ModelConfig; apiKey: string; baseUrl: string }> {
  const providers = loadProviders();
  const result: Array<{ providerId: string; providerName: string; model: ModelConfig; apiKey: string; baseUrl: string }> = [];
  for (const p of providers) {
    if (!p.isActive) continue;
    for (const m of p.models) {
      result.push({ providerId: p.id, providerName: p.name, model: m, apiKey: p.apiKey, baseUrl: p.baseUrl });
    }
  }
  return result;
}
