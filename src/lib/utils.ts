export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function bytesToMegabytes(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function summarizeText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}
