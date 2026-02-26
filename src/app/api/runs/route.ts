import { NextResponse } from "next/server";
import { z } from "zod";
import { startRun } from "@/lib/server/run-service";
import { getRepository } from "@/lib/server/persistence";
import { serializeRun } from "@/lib/server/serializers";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

const runInputSchema = z.object({
  mode: z.enum(["template", "everything"]),
  provider: z.enum(["glm", "mistral"]).default("glm"),
});

export async function GET(): Promise<NextResponse> {
  try {
    const repository = getRepository();
    const runs = await repository.listRuns();

    return NextResponse.json({
      runs: runs.map(serializeRun),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list runs.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const { mode, provider } = runInputSchema.parse({
      mode: formData.get("mode"),
      provider: formData.get("provider") ?? undefined,
    });
    const templateId = String(formData.get("templateId") ?? "");
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return jsonError("A file is required.", 400);
    }

    const fileBytes = Buffer.from(await fileEntry.arrayBuffer());
    const mimeType = fileEntry.type || "application/octet-stream";

    const result = await startRun({
      mode,
      provider,
      templateId,
      fileName: fileEntry.name || "upload",
      mimeType,
      fileBytes,
    });

    const repository = getRepository();
    const run = await repository.getRun(result.runId);

    return NextResponse.json(
      {
        runId: result.runId,
        execution: result.execution,
        run: run ? serializeRun(run) : null,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issuePath = error.issues[0]?.path?.[0];
      if (issuePath === "provider") {
        return jsonError("provider must be either glm or mistral.", 400);
      }
      return jsonError("mode must be either template or everything.", 400);
    }

    const message = error instanceof Error ? error.message : "Failed to start run.";
    return jsonError(message, 500);
  }
}
