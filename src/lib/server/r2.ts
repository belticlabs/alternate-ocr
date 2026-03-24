import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getEnv, hasR2Config } from "@/lib/env";

/** Stored in DB when R2 is not configured; files live under data/run-documents/{runId}. */
const LOCAL_DOCUMENT_KEY_PREFIX = "local:";

interface R2Context {
  client: S3Client;
  bucket: string;
}

export interface StoredDocumentStream {
  stream: ReadableStream<Uint8Array>;
  contentLength?: number;
}

let cachedClient: S3Client | null = null;
let cachedClientSignature = "";

function getObjectKey(runId: string): string {
  return `runs/${runId}`;
}

function getLocalDocumentDir(): string {
  return path.join(process.cwd(), "data", "run-documents");
}

function getLocalDocumentPath(runId: string): string {
  return path.join(getLocalDocumentDir(), runId);
}

export function isLocalDocumentKey(key: string): boolean {
  return key.startsWith(LOCAL_DOCUMENT_KEY_PREFIX);
}

function localKeyForRunId(runId: string): string {
  return `${LOCAL_DOCUMENT_KEY_PREFIX}${runId}`;
}

function runIdFromLocalKey(key: string): string {
  return key.slice(LOCAL_DOCUMENT_KEY_PREFIX.length);
}

function getContext(): R2Context | null {
  const env = getEnv();
  if (!hasR2Config(env)) {
    return null;
  }

  const signature = `${env.R2_ENDPOINT}|${env.R2_ACCESS_KEY_ID}|${env.R2_BUCKET}`;
  if (!cachedClient || signature !== cachedClientSignature) {
    cachedClient = new S3Client({
      endpoint: env.R2_ENDPOINT,
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
    cachedClientSignature = signature;
  }

  return {
    client: cachedClient,
    bucket: env.R2_BUCKET!,
  };
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typed = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return typed.name === "NoSuchKey" || typed.$metadata?.httpStatusCode === 404;
}

function toWebReadableStream(
  body: GetObjectCommandOutput["Body"]
): ReadableStream<Uint8Array> | null {
  if (!body) {
    return null;
  }

  if (body instanceof ReadableStream) {
    return body;
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }

  if ("transformToWebStream" in body && typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }

  return null;
}

export function isDocumentStorageEnabled(): boolean {
  return getContext() !== null;
}

async function uploadDocumentLocal(runId: string, buffer: Buffer): Promise<string | null> {
  try {
    const dir = getLocalDocumentDir();
    await mkdir(dir, { recursive: true });
    await writeFile(getLocalDocumentPath(runId), buffer);
    return localKeyForRunId(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[r2] Local document write failed (set R2_* or fix data/ permissions)", {
      runId,
      message,
    });
    return null;
  }
}

export async function uploadDocument(
  runId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const context = getContext();
  if (!context) {
    return uploadDocumentLocal(runId, buffer);
  }

  const key = getObjectKey(runId);
  await context.client.send(
    new PutObjectCommand({
      Bucket: context.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.byteLength,
    })
  );

  return key;
}

export async function getDocumentStream(key: string): Promise<StoredDocumentStream | null> {
  if (isLocalDocumentKey(key)) {
    const filePath = getLocalDocumentPath(runIdFromLocalKey(key));
    try {
      const st = await stat(filePath);
      const nodeStream = createReadStream(filePath);
      const stream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
      return {
        stream,
        contentLength: Number(st.size),
      };
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  const context = getContext();
  if (!context) {
    return null;
  }

  try {
    const response = await context.client.send(
      new GetObjectCommand({
        Bucket: context.bucket,
        Key: key,
      })
    );
    const stream = toWebReadableStream(response.Body);
    if (!stream) {
      return null;
    }

    return {
      stream,
      contentLength:
        typeof response.ContentLength === "number" ? response.ContentLength : undefined,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function deleteDocument(key: string): Promise<void> {
  if (isLocalDocumentKey(key)) {
    try {
      await unlink(getLocalDocumentPath(runIdFromLocalKey(key)));
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "ENOENT") {
        return;
      }
      throw error;
    }
    return;
  }

  const context = getContext();
  if (!context) {
    return;
  }

  try {
    await context.client.send(
      new DeleteObjectCommand({
        Bucket: context.bucket,
        Key: key,
      })
    );
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}
