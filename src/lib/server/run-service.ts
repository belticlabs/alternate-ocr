import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { bytesToMegabytes, toIsoNow } from "@/lib/utils";
import { RunMode } from "@/lib/types";
import { getRepository } from "./persistence";
import { enqueueRun } from "./processing-queue";
import { processRun } from "./run-processor";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function toDataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function assertSupportedMimeType(mimeType: string): void {
  if (SUPPORTED_MIME_TYPES.has(mimeType)) {
    return;
  }

  throw new Error(`Unsupported file type: ${mimeType}. Use PDF, PNG, JPG, WEBP, or HEIC.`);
}

export interface StartRunInput {
  mode: RunMode;
  templateId: string;
  fileName: string;
  mimeType: string;
  fileBytes: Buffer;
}

export async function startRun(input: StartRunInput): Promise<{
  runId: string;
  execution: "sync" | "async";
}> {
  const env = getEnv();
  const repository = getRepository();

  assertSupportedMimeType(input.mimeType);

  const fileMb = bytesToMegabytes(input.fileBytes.length);
  if (fileMb > env.MAX_UPLOAD_MB) {
    throw new Error(`File exceeds MAX_UPLOAD_MB (${env.MAX_UPLOAD_MB}MB).`);
  }

  if (input.mode === "template" && !input.templateId) {
    throw new Error("templateId is required when mode=template.");
  }

  const runId = randomUUID();
  const createdAt = toIsoNow();
  const fileDataUrl = toDataUrl(input.mimeType, input.fileBytes);

  await repository.createRun({
    id: runId,
    mode: input.mode,
    templateId: input.templateId,
    status: "queued",
    filename: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.fileBytes.length,
    createdAt,
  });

  const runInput = {
    runId,
    mode: input.mode,
    templateId: input.templateId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.fileBytes.length,
    fileDataUrl,
  };

  const execution = fileMb <= env.PROCESS_SYNC_MAX_FILE_MB ? "sync" : "async";

  if (execution === "sync") {
    await processRun(runInput);
    return { runId, execution };
  }

  enqueueRun(async () => {
    await processRun(runInput);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[run-queue] Async run failed", { runId, message });
  });

  return { runId, execution };
}
