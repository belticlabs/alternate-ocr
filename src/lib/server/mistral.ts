import { getEnv } from "@/lib/env";
import { LayoutDetail } from "@/lib/types";
import { clamp } from "@/lib/utils";

interface MistralPageDimensions {
  dpi?: number;
  height?: number;
  width?: number;
}

interface MistralPageImage {
  id?: string;
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
  image_base64?: string;
}

interface MistralPageTable {
  id?: string;
  content?: string;
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
}

export interface MistralOcrPage {
  index?: number;
  markdown?: string;
  dimensions?: MistralPageDimensions;
  images?: MistralPageImage[];
  tables?: MistralPageTable[];
}

interface MistralUsageInfo {
  pages_processed?: number;
  doc_size_bytes?: number;
}

export interface MistralOcrResponse {
  pages?: MistralOcrPage[];
  document_annotation?: unknown;
  usage_info?: MistralUsageInfo;
  model?: string;
}

interface MistralChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface MistralChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: MistralChatUsage;
}

interface CallMistralOcrInput {
  fileDataUrl: string;
  mimeType: string;
  documentAnnotationSchema?: Record<string, unknown>;
  documentAnnotationPrompt?: string;
}

function buildMistralUrl(pathname: string): string {
  const env = getEnv();
  const base = env.MISTRAL_BASE_URL.endsWith("/")
    ? env.MISTRAL_BASE_URL.slice(0, -1)
    : env.MISTRAL_BASE_URL;
  return `${base}${pathname}`;
}

function getMistralAuthHeaders(): HeadersInit {
  const env = getEnv();
  if (!env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY is required for Mistral OCR operations.");
  }

  return {
    Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
  };
}

function normalizeCoordinate(value: number | undefined, pageSize: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const asNumber = value ?? 0;
  const normalized = pageSize > 1 && asNumber > 1 ? asNumber / pageSize : asNumber;
  return clamp(normalized, 0, 1);
}

function normalizeBox(
  topLeftX: number | undefined,
  topLeftY: number | undefined,
  bottomRightX: number | undefined,
  bottomRightY: number | undefined,
  width: number,
  height: number
): [number, number, number, number] {
  const x1 = normalizeCoordinate(topLeftX, width);
  const y1 = normalizeCoordinate(topLeftY, height);
  const x2 = normalizeCoordinate(bottomRightX, width);
  const y2 = normalizeCoordinate(bottomRightY, height);

  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

function guessImageMimeFromId(id: string | undefined): string {
  const value = (id ?? "").toLowerCase();
  if (value.endsWith(".png")) return "image/png";
  if (value.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function toDataUrl(mimeType: string, base64Data: string): string {
  const trimmed = base64Data.trim();
  if (/^data:/i.test(trimmed)) {
    return trimmed;
  }
  return `data:${mimeType};base64,${trimmed}`;
}

function toLayoutPage(page: MistralOcrPage): LayoutDetail[] {
  const width = page.dimensions?.width ?? 0;
  const height = page.dimensions?.height ?? 0;

  const out: LayoutDetail[] = [
    {
      index: 0,
      label: "text",
      bbox_2d: [0, 0, 1, 1],
      content: page.markdown ?? "",
      width,
      height,
    },
  ];

  const images = [...(page.images ?? [])].sort((a, b) => {
    const ay = a.top_left_y ?? 0;
    const by = b.top_left_y ?? 0;
    if (ay !== by) return ay - by;
    const ax = a.top_left_x ?? 0;
    const bx = b.top_left_x ?? 0;
    return ax - bx;
  });

  images.forEach((image, index) => {
    const mime = guessImageMimeFromId(image.id);
    const content = image.image_base64 ? toDataUrl(mime, image.image_base64) : "";
    out.push({
      index: 1 + index,
      label: "image",
      bbox_2d: normalizeBox(
        image.top_left_x,
        image.top_left_y,
        image.bottom_right_x,
        image.bottom_right_y,
        width,
        height
      ),
      content,
      width,
      height,
    });
  });

  const tableBaseIndex = out.length;
  (page.tables ?? []).forEach((table, localIndex) => {
    out.push({
      index: tableBaseIndex + localIndex,
      label: "table",
      bbox_2d: normalizeBox(
        table.top_left_x,
        table.top_left_y,
        table.bottom_right_x,
        table.bottom_right_y,
        width,
        height
      ),
      content: table.content ?? "",
      width,
      height,
    });
  });

  // Ensure deterministic order if page.index is absent in provider output.
  if (!Number.isFinite(page.index)) {
    out.forEach((item, index) => {
      item.index = index;
    });
  }

  return out;
}

export function mistralPagesToLayoutDetails(pages: MistralOcrPage[]): LayoutDetail[][] {
  return pages.map((page) => toLayoutPage(page));
}

export function collectMistralMarkdown(pages: MistralOcrPage[]): string {
  return pages
    .map((page, index) => `# Page ${index + 1}\n${page.markdown ?? ""}`.trim())
    .join("\n\n");
}

export function parseMistralDocumentAnnotation(annotation: unknown): Record<string, unknown> {
  if (!annotation) {
    return {};
  }

  if (typeof annotation === "string") {
    try {
      const parsed = JSON.parse(annotation) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof annotation === "object" && !Array.isArray(annotation)) {
    return annotation as Record<string, unknown>;
  }

  return {};
}

function buildDocumentPayload(fileDataUrl: string, mimeType: string): Record<string, unknown> {
  if (mimeType === "application/pdf") {
    return {
      type: "document_url",
      document_url: fileDataUrl,
    };
  }

  return {
    type: "image_url",
    image_url: fileDataUrl,
  };
}

export async function callMistralOcr({
  fileDataUrl,
  mimeType,
  documentAnnotationSchema,
  documentAnnotationPrompt,
}: CallMistralOcrInput): Promise<MistralOcrResponse> {
  const env = getEnv();
  const body: Record<string, unknown> = {
    model: env.MISTRAL_OCR_MODEL,
    document: buildDocumentPayload(fileDataUrl, mimeType),
    include_image_base64: true,
    table_format: "html",
  };

  if (documentAnnotationSchema) {
    body.document_annotation_format = {
      type: "json_schema",
      json_schema: {
        name: "extraction",
        schema: documentAnnotationSchema,
      },
    };
  }

  if (documentAnnotationPrompt?.trim()) {
    body.document_annotation_prompt = documentAnnotationPrompt.trim();
  }

  const response = await fetch(buildMistralUrl("/v1/ocr"), {
    method: "POST",
    headers: {
      ...getMistralAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Mistral OCR request failed (${response.status}): ${responseBody}`);
  }

  return (await response.json()) as MistralOcrResponse;
}

function extractMistralMessageContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export async function callMistralChatCompletionJson(
  systemPrompt: string,
  userPrompt: string
): Promise<{ json: unknown; usage: MistralChatUsage }> {
  const env = getEnv();
  const response = await fetch(buildMistralUrl("/v1/chat/completions"), {
    method: "POST",
    headers: {
      ...getMistralAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.MISTRAL_STRUCTURED_MODEL,
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
      temperature: 0,
      response_format: {
        type: "json_object",
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mistral chat request failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as MistralChatCompletionResponse;
  const content = extractMistralMessageContent(result.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error("Mistral chat returned empty content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Mistral chat response was not valid JSON.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    json: parsed,
    usage: result.usage ?? {},
  };
}
