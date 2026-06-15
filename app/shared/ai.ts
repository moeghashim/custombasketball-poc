interface JsonCallResult<T> {
  data: T;
  model: string;
  rawText: string;
}

interface OpenAIJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export async function callKimiJson<T>(params: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<JsonCallResult<T>> {
  const apiKey = optionalEnv(["KIMI_API_KEY", "MOONSHOT_API_KEY"]);
  if (!apiKey) throw new Error("KIMI_API_KEY or MOONSHOT_API_KEY is required");

  const model = process.env.KIMI_MODEL || "kimi-k2.7-code";
  const endpoint = chatCompletionsEndpoint(process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1");
  const body = {
    model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 6000,
    response_format: { type: "json_object" },
  };

  const response = await postJson(endpoint, apiKey, body).catch((error) => {
    if (!String(error).includes("response_format")) throw error;
    const { response_format: _responseFormat, ...retryBody } = body;
    return postJson(endpoint, apiKey, retryBody);
  });
  const rawText = extractChatMessageText(response);
  return { data: parseJsonObject<T>(rawText), model, rawText };
}

export async function callOpenAIJson<T>(params: {
  system: string;
  user: string;
  schema?: OpenAIJsonSchema;
}): Promise<JsonCallResult<T>> {
  const apiKey = optionalEnv(["OPENAI_API_KEY"]);
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  const endpoint = `${stripTrailingSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")}/responses`;
  const body: Record<string, unknown> = {
    model,
    instructions: params.system,
    input: params.user,
    reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "high" },
  };
  if (params.schema) {
    body.text = {
      format: {
        type: "json_schema",
        name: params.schema.name,
        strict: true,
        schema: params.schema.schema,
      },
    };
  }

  const response = await postJson(endpoint, apiKey, body).catch((error) => {
    if (!params.schema) throw error;
    const { text: _text, ...retryBody } = body;
    return postJson(endpoint, apiKey, retryBody);
  });
  const rawText = extractResponsesText(response);
  return { data: parseJsonObject<T>(rawText), model, rawText };
}

export function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model response did not contain a JSON object");
    }
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = stripTrailingSlash(baseUrl);
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function postJson(endpoint: string, apiKey: string, body: unknown): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 1000)}`);
  }
  return text ? JSON.parse(text) : {};
}

function extractChatMessageText(response: unknown): string {
  const choice = firstObject((response as { choices?: unknown[] }).choices);
  const message = choice?.message as { content?: unknown } | undefined;
  return contentToText(message?.content);
}

function extractResponsesText(response: unknown): string {
  const outputText = (response as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText;

  const output = (response as { output?: unknown[] }).output;
  if (Array.isArray(output)) {
    const parts = output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown[] }).content;
      return Array.isArray(content) ? content : [];
    });
    const text = parts.map((part) => contentToText(part)).filter(Boolean).join("\n");
    if (text.trim()) return text;
  }
  throw new Error("Model response did not contain output text");
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join("\n");
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    return contentToText(record.text ?? record.content ?? record.value);
  }
  return "";
}

function firstObject(items: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(items)) return undefined;
  const item = items.find((entry) => entry && typeof entry === "object");
  return item as Record<string, unknown> | undefined;
}

function optionalEnv(names: string[]): string | undefined {
  return names.map((name) => process.env[name]).find((value): value is string => Boolean(value));
}
