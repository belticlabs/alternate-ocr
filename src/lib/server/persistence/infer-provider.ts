/**
 * Infer OCR provider from stored raw payload when run.provider is missing
 * (e.g. runs created before provider was stored, or SpacetimeDB schema without provider column).
 */
export function inferProviderFromRawPayload(
  rawProviderJson: string
): "glm" | "mistral" | undefined {
  if (!rawProviderJson || rawProviderJson.trim() === "" || rawProviderJson === "{}") {
    return undefined;
  }
  try {
    const raw = JSON.parse(rawProviderJson) as Record<string, unknown>;
    if (raw && typeof raw === "object") {
      if ("document_annotation" in raw || (Array.isArray(raw.pages) && raw.pages.length > 0)) {
        return "mistral";
      }
      if ("layout_details" in raw || "md_results" in raw) {
        return "glm";
      }
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}
