import { useState, useCallback } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronUp, Eye, EyeOff, Zap,
  CheckCircle2, XCircle, Loader2
} from "lucide-react";
import { loadProviders, saveProviders, type ProviderConfig, type ModelConfig } from "../services/llmConfig";
import { Input } from "./ui/input";
import { testConnection, fetchAvailableModels } from "../services/llm";

interface ProviderUI extends ProviderConfig {
  expanded: boolean;
}

function toUI(providers: ProviderConfig[]): ProviderUI[] {
  return providers.map((p, i) => ({ ...p, expanded: i === 0 }));
}

export function SettingsModels() {
  const [providers, setProviders] = useState<ProviderUI[]>(() => toUI(loadProviders()));
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, "success" | "fail" | null>>({});
  const [testError, setTestError] = useState<Record<string, string | null>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [showModelPicker, setShowModelPicker] = useState<Record<string, boolean>>({});
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({});

  // Persist on change
  const persist = useCallback((next: ProviderUI[]) => {
    setProviders(next);
    saveProviders(next.map(({ expanded: _, ...rest }) => rest));
  }, []);

  const toggleExpand = (id: string) => {
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, expanded: !p.expanded } : p));
  };

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    persist(providers.map((p) => p.id === id ? { ...p, ...patch } : p));
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    setTestResult((prev) => ({ ...prev, [id]: null }));
    setTestError((prev) => ({ ...prev, [id]: null }));
    const provider = providers.find((p) => p.id === id);
    if (!provider) {
      setTestingId(null);
      setTestResult((prev) => ({ ...prev, [id]: "fail" }));
      setTestError((prev) => ({ ...prev, [id]: "Provider 不存在" }));
      return;
    }
    if (!provider.baseUrl) {
      setTestingId(null);
      setTestResult((prev) => ({ ...prev, [id]: "fail" }));
      setTestError((prev) => ({ ...prev, [id]: "请先填写 Base URL" }));
      return;
    }
    const result = await testConnection(provider.apiKey, provider.baseUrl);
    setTestResult((prev) => ({ ...prev, [id]: result.ok ? "success" : "fail" }));
    setTestError((prev) => ({ ...prev, [id]: result.ok ? null : (result.error ?? "连接失败") }));
    setTestingId(null);
  };

  const addProvider = () => {
    const newId = `provider-${Date.now()}`;
    persist([...providers, {
      id: newId, name: "新 Provider", apiKey: "", baseUrl: "https://api.openai.com/v1",
      isActive: true, expanded: true, models: [],
    }]);
  };

  const deleteProvider = (id: string) => {
    persist(providers.filter((p) => p.id !== id));
  };

  const handleFetchModels = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !provider.apiKey || !provider.baseUrl) return;
    setFetchingModels((prev) => ({ ...prev, [providerId]: true }));
    try {
      const models = await fetchAvailableModels(provider.apiKey, provider.baseUrl);
      setAvailableModels((prev) => ({ ...prev, [providerId]: models }));
      setShowModelPicker((prev) => ({ ...prev, [providerId]: true }));
    } catch {
      setAvailableModels((prev) => ({ ...prev, [providerId]: [] }));
      setShowModelPicker((prev) => ({ ...prev, [providerId]: true }));
    }
    setFetchingModels((prev) => ({ ...prev, [providerId]: false }));
  };

  const addModelFromPicker = (providerId: string, modelName: string) => {
    persist(providers.map((p) => {
      if (p.id !== providerId) return p;
      if (p.models.some((m) => m.name === modelName)) return p;
      const newModel: ModelConfig = {
        id: `model-${Date.now()}`, name: modelName, displayName: modelName,
        temperature: 0.7, maxTokens: 4096, isDefault: p.models.length === 0,
      };
      return { ...p, models: [...p.models, newModel] };
    }));
  };

  const updateModel = (providerId: string, modelId: string, patch: Partial<ModelConfig>) => {
    persist(providers.map((p) => {
      if (p.id !== providerId) return p;
      return { ...p, models: p.models.map((m) => m.id === modelId ? { ...m, ...patch } : m) };
    }));
  };

  const deleteModel = (providerId: string, modelId: string) => {
    persist(providers.map((p) => {
      if (p.id !== providerId) return p;
      const remaining = p.models.filter((m) => m.id !== modelId);
      if (remaining.length > 0 && !remaining.some((m) => m.isDefault)) {
        remaining[0].isDefault = true;
      }
      return { ...p, models: remaining };
    }));
  };

  const setDefaultModel = (providerId: string, modelId: string) => {
    persist(providers.map((p) => ({
      ...p,
      models: p.models.map((m) => ({
        ...m,
        isDefault: p.id === providerId ? m.id === modelId : false,
      })),
    })));
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafb] font-['Inter',sans-serif]">
      <div className="max-w-[720px] mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[18px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>模型配置</p>
            <p className="text-[13px] text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>管理 LLM 供应商和模型参数</p>
          </div>
          <button onClick={addProvider} className="flex items-center gap-2 px-3 py-[7px] bg-[#030213] text-white rounded-[7px] text-[12.5px] hover:bg-[#1a1a2e] transition-colors" style={{ fontWeight: 500 }}>
            <Plus className="w-[14px] h-[14px]" />
            添加 Provider
          </button>
        </div>

        <div className="space-y-3">
          {providers.map((provider) => (
            <div key={provider.id} className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)]">
              <button
                onClick={() => toggleExpand(provider.id)}
                className="w-full px-5 py-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-[8px] h-[8px] rounded-full ${provider.isActive ? "bg-[#10b981]" : "bg-[#d0d5dd]"}`} />
                  <span className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{provider.name}</span>
                  <span className="text-[11px] text-[#717182]" style={{ fontWeight: 400 }}>{provider.models.length} 个模型</span>
                </div>
                {provider.expanded ? <ChevronUp className="w-[14px] h-[14px] text-[#667085]" /> : <ChevronDown className="w-[14px] h-[14px] text-[#667085]" />}
              </button>

              {provider.expanded && (
                <div className="px-5 pb-5 border-t border-[rgba(0,0,0,0.06)] pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="text-[11px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>Provider 名称</label>
                      <Input
                        value={provider.name}
                        onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                        style={{ fontWeight: 400 }}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>Base URL</label>
                      <Input
                        value={provider.baseUrl}
                        onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                        style={{ fontWeight: 400 }}
                      />
                    </div>
                  </div>
                  <div className="relative mb-4">
                    <label className="text-[11px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>API Key</label>
                    <div className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        type={showKey[provider.id] ? "text" : "password"}
                        value={provider.apiKey}
                        onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                        placeholder="sk-..."
                        style={{ fontWeight: 400 }}
                      />
                        <button
                          onClick={() => setShowKey((p) => ({ ...p, [provider.id]: !p[provider.id] }))}
                          className="p-[6px] text-[#717182] hover:text-[#0a0a0a] rounded-[5px] hover:bg-[#f3f3f5] transition-colors"
                        >
                          {showKey[provider.id] ? <EyeOff className="w-[14px] h-[14px]" /> : <Eye className="w-[14px] h-[14px]" />}
                        </button>
                      </div>
                  </div>

                  <div className="relative mb-5">
                    <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestConnection(provider.id)}
                      disabled={testingId === provider.id}
                      className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border border-[rgba(0,0,0,0.1)] text-[#0a0a0a] hover:bg-[#f8fafb] transition-colors disabled:opacity-40"
                      style={{ fontWeight: 500 }}
                    >
                      {testingId === provider.id ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Zap className="w-[13px] h-[13px]" />}
                      测试连接
                    </button>
                    {testResult[provider.id] === "success" && <span className="flex items-center gap-1 text-[12px] text-[#10b981]"><CheckCircle2 className="w-[13px] h-[13px]" />连接成功</span>}
                    {testResult[provider.id] === "fail" && <span className="flex items-center gap-1 text-[12px] text-[#dc2626]"><XCircle className="w-[13px] h-[13px]" />{testError[provider.id] ?? "连接失败"}</span>}
                    <button onClick={() => deleteProvider(provider.id)} className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border border-[rgba(0,0,0,0.1)] text-[#dc2626] hover:bg-[#fef2f2] transition-colors ml-auto" style={{ fontWeight: 500 }}>
                      <Trash2 className="w-[13px] h-[13px]" />
                      删除
                    </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>模型列表</span>
                      <button
                        onClick={() => handleFetchModels(provider.id)}
                        disabled={fetchingModels[provider.id]}
                        className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border border-[rgba(0,0,0,0.1)] text-[#0a0a0a] hover:bg-[#f8fafb] transition-colors disabled:opacity-40"
                        style={{ fontWeight: 500 }}
                      >
                        {fetchingModels[provider.id] ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Plus className="w-[13px] h-[13px]" />}
                        添加模型
                      </button>
                    </div>
                    {showModelPicker[provider.id] && (
                      <div className="mb-3 p-3 bg-[#f3f3f5] rounded-[7px] border border-[rgba(0,0,0,0.08)]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] text-[#717182]" style={{ fontWeight: 500 }}>选择要添加的模型</span>
                          <button onClick={() => setShowModelPicker((p) => ({ ...p, [provider.id]: false }))} className="flex items-center gap-1 px-2 py-[4px] rounded-[5px] text-[11px] border border-[rgba(0,0,0,0.1)] text-[#0a0a0a] hover:bg-[#f8fafb] transition-colors" style={{ fontWeight: 500 }}>关闭</button>
                        </div>
                        <Input
                          size="xs"
                          surface="white"
                          className="mb-2"
                          placeholder="搜索模型..."
                          value={modelSearch[provider.id] ?? ""}
                          onChange={(e) => setModelSearch((p) => ({ ...p, [provider.id]: e.target.value }))}
                          style={{ fontWeight: 400 }}
                        />
                        <div className="max-h-[200px] overflow-y-auto space-y-1">
                          {(availableModels[provider.id] ?? []).length === 0 ? (
                            <div className="text-[11px] text-[#717182] py-2 text-center">未获取到可用模型，请检查 API Key 和 Base URL</div>
                          ) : (
                            (availableModels[provider.id] ?? []).filter((name) => {
                              const search = (modelSearch[provider.id] ?? "").toLowerCase();
                              return !search || name.toLowerCase().includes(search);
                            }).map((name) => {
                              const alreadyAdded = provider.models.some((m) => m.name === name);
                              return (
                                <button
                                  key={name}
                                  onClick={() => {
                                    if (alreadyAdded) {
                                      const model = provider.models.find((m) => m.name === name);
                                      if (model) deleteModel(provider.id, model.id);
                                    } else {
                                      addModelFromPicker(provider.id, name);
                                    }
                                  }}
                                  className={`w-full text-left px-2.5 py-[6px] rounded-[5px] text-[11.5px] transition-colors cursor-pointer ${
                                    alreadyAdded
                                      ? "bg-[#e8ebe8] text-[#0a0a0a] hover:bg-[#dce0dc]"
                                      : "bg-white hover:bg-[#eef1fa] text-[#0a0a0a]"
                                  }`}
                                  style={{ fontWeight: 400 }}
                                >
                                  {name}{alreadyAdded && " ✓"}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {provider.models.map((model) => (
                        <div key={model.id} className="flex items-center gap-3 px-3 py-[8px] bg-[#f8fafb] rounded-[7px]">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>{model.displayName}</span>
                              {model.isDefault ? (
                                <span className="text-[9px] px-[5px] py-[1px] rounded-[3px] bg-[#030213] text-white" style={{ fontWeight: 500 }}>默认</span>
                              ) : (
                                <button onClick={() => setDefaultModel(provider.id, model.id)} className="text-[9px] px-[5px] py-[1px] rounded-[3px] bg-[#f3f3f5] text-[#717182] hover:bg-[#ebebeb]" style={{ fontWeight: 500 }}>设为默认</button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-[#717182]" style={{ fontWeight: 400 }}>
                            <span>温度: {model.temperature}</span>
                            <span>最大Token: {model.maxTokens}</span>
                          </div>
                          <button onClick={() => deleteModel(provider.id, model.id)} className="p-1 text-[#717182] hover:text-[#dc2626]">
                            <Trash2 className="w-[13px] h-[13px]" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
