import { getEnv } from "@/lib/env";
import { LayoutDetail } from "@/lib/types";

interface ZaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface LayoutParsingResponse {
  id: string;
  model: string;
  md_results?: string;
  layout_details?: LayoutDetail[][];
  layout_visualization?: string[];
  data_info?: {
    num_pages?: number;
    pages?: Array<{ width: number; height: number }>;
  };
  usage?: ZaiUsage;
  request_id?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: ZaiUsage;
}

function buildUrl(pathname: string): string {
  const env = getEnv();
  const base = env.ZAI_BASE_URL.endsWith("/")
    ? env.ZAI_BASE_URL.slice(0, -1)
    : env.ZAI_BASE_URL;

  return `${base}${pathname}`;
}

function getAuthHeaders(): HeadersInit {
  const env = getEnv();
  if (!env.ZAI_API_KEY) {
    throw new Error("ZAI_API_KEY is required for OCR/LLM operations.");
  }

  return {
    Authorization: `Bearer ${env.ZAI_API_KEY}`,
  };
}

export async function callLayoutParsing(fileData: string): Promise<LayoutParsingResponse> {
  const env = getEnv();
  const needLayoutVisualization = env.NEED_LAYOUT_VISUALIZATION !== false;

  const response = await fetch(buildUrl("/paas/v4/layout_parsing"), {
    method: "POST",
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.GLM_OCR_MODEL,
      file: fileData,
      return_crop_images: true,
      need_layout_visualization: needLayoutVisualization,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GLM OCR request failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as LayoutParsingResponse;
  return result;
}

export async function callChatCompletionJson(
  systemPrompt: string,
  userPrompt: string
): Promise<{ json: unknown; usage: ZaiUsage }> {
  const env = getEnv();
  const response = await fetch(buildUrl("/paas/v4/chat/completions"), {
    method: "POST",
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.GLM_STRUCTURED_MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      stream: false,
      temperature: 0,
      response_format: {
        type: "json_object",
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GLM chat request failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as ChatCompletionResponse;
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("GLM chat returned empty content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("GLM chat response was not valid JSON.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    json: parsed,
    usage: result.usage ?? {},
  };
}
