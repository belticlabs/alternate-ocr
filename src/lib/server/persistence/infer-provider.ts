/**
 * Infer OCR provider from stored raw payload when run.provider is missing
 * (e.g. runs created before provider was stored, or SpacetimeDB schema without provider column).
 */
export function inferProviderFromRawPayload(
  rawProviderJson: string
): "glm" | "mistral" | "marker" | undefined {
  if (!rawProviderJson || rawProviderJson.trim() === "" || rawProviderJson === "{}") {
    return undefined;
  }
  try {
    const raw = JSON.parse(rawProviderJson) as Record<string, unknown>;
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.pages) && raw.pages.length > 0) {
        return "mistral";
      }
      if ("document_annotation" in raw) {
        return "mistral";
      }
      // Marker responses have convert_time_s and text fields
      if ("convert_time_s" in raw && "text" in raw) {
        return "marker";
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
