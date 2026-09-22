export interface IntegrationEnvironment {
  WEBEX_CLIENT_ID?: string;
  WEBEX_CLIENT_SECRET?: string;
  WEBEX_REDIRECT_URI?: string;
  SESSION_ENCRYPTION_KEY?: string;
  WEBEX_BOT_ACCESS_TOKEN?: string;
  WEBEX_BOT_NAME?: string;
  WEBEX_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_AI_API?: string;
  LLM_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_CONTEXT_TOKENS?: string;
}

function isConfigured(...values: Array<string | undefined>): boolean {
  return values.every((value) => Boolean(value?.trim()));
}

export function geminiKey(env: IntegrationEnvironment): string | undefined {
  return env.GEMINI_AI_API?.trim() || env.LLM_API_KEY?.trim();
}

export function llmProvider(env: IntegrationEnvironment): "gemini" | "ollama" {
  return env.LLM_PROVIDER?.trim().toLowerCase() === "ollama" ? "ollama" : "gemini";
}

export function llmModel(env: IntegrationEnvironment): string {
  return env.LLM_MODEL?.trim() || (llmProvider(env) === "ollama" ? "qwen2.5vl:3b" : "gemini-2.5-flash");
}

export function llmBaseUrl(env: IntegrationEnvironment): string {
  return (env.LLM_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

export function llmConfigured(env: IntegrationEnvironment): boolean {
  return llmProvider(env) === "ollama" ? Boolean(llmBaseUrl(env)) : Boolean(geminiKey(env));
}

export function supabaseSecret(env: IntegrationEnvironment): string | undefined {
  return env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
}

export function integrationStatus(env: IntegrationEnvironment) {
  return {
    webexOAuthConfigured: isConfigured(env.WEBEX_CLIENT_ID, env.WEBEX_CLIENT_SECRET, env.WEBEX_REDIRECT_URI, env.SESSION_ENCRYPTION_KEY),
    webexBotConfigured: isConfigured(env.WEBEX_BOT_ACCESS_TOKEN, env.WEBEX_BOT_NAME, env.WEBEX_WEBHOOK_SECRET),
    supabaseConfigured: isConfigured(env.SUPABASE_URL, supabaseSecret(env)),
    llmConfigured: llmConfigured(env),
    llmProvider: llmProvider(env),
    llmModel: llmModel(env),
  };
}
