import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getEnv, hasR2Config } from "@/lib/env";

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

export async function uploadDocument(
  runId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const context = getContext();
  if (!context) {
    return null;
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
