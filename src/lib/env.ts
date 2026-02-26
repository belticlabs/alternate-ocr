import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ZAI_API_KEY: z.string().min(1).optional(),
  ZAI_BASE_URL: z.string().url().default("https://api.z.ai/api"),
  GLM_OCR_MODEL: z.string().default("glm-ocr"),
  GLM_STRUCTURED_MODEL: z.string().default("glm-5"),
  SPACETIMEDB_BASE_URL: z.string().url().optional(),
  SPACETIMEDB_DATABASE: z.string().min(1).optional(),
  SPACETIMEDB_TOKEN: z.string().min(1).optional(),
  PROCESS_SYNC_MAX_FILE_MB: z.coerce.number().positive().default(12),
  PROCESS_SYNC_MAX_PAGES: z.coerce.number().int().positive().default(8),
  PROCESS_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  /** Set to false to request clean page images (no OCR-drawn boxes); only schema citation overlays will show. */
  NEED_LAYOUT_VISUALIZATION: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function hasSpacetimeConfig(env: AppEnv): boolean {
  return Boolean(env.SPACETIMEDB_BASE_URL && env.SPACETIMEDB_DATABASE && env.SPACETIMEDB_TOKEN);
}
