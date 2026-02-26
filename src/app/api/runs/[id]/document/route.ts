import { jsonError } from "@/lib/server/http";
import { getRepository } from "@/lib/server/persistence";
import { getDocumentStream } from "@/lib/server/r2";

export const runtime = "nodejs";

function toInlineDisposition(filename: string): string {
  const safeFilename = filename.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${safeFilename}"`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    const run = await repository.getRun(id);

    if (!run?.documentKey) {
      return jsonError("Document not found.", 404);
    }

    const document = await getDocumentStream(run.documentKey);
    if (!document) {
      return jsonError("Document not found.", 404);
    }

    const headers = new Headers({
      "Content-Type": run.mimeType || "application/octet-stream",
      "Content-Disposition": toInlineDisposition(run.filename),
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
    if (document.contentLength != null) {
      headers.set("Content-Length", String(document.contentLength));
    }

    return new Response(document.stream, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch run document.";
    return jsonError(message, 500);
  }
}
