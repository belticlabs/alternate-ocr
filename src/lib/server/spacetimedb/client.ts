import { getEnv } from "@/lib/env";

interface SqlStatementResult {
  schema?: unknown;
  rows?: unknown[];
}

function ensureUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export class SpacetimeHttpClient {
  private readonly baseUrl: string;
  private readonly database: string;
  private readonly token: string;

  constructor() {
    const env = getEnv();

    if (!env.SPACETIMEDB_BASE_URL || !env.SPACETIMEDB_DATABASE || !env.SPACETIMEDB_TOKEN) {
      throw new Error(
        "SpaceTimeDB is not configured. Set SPACETIMEDB_BASE_URL, SPACETIMEDB_DATABASE, and SPACETIMEDB_TOKEN."
      );
    }

    this.baseUrl = ensureUrl(env.SPACETIMEDB_BASE_URL);
    this.database = env.SPACETIMEDB_DATABASE;
    this.token = env.SPACETIMEDB_TOKEN;
  }

  private get authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
    };
  }

  async callReducer(reducerName: string, args: unknown[]): Promise<void> {
    const endpoint = `${this.baseUrl}/v1/database/${this.database}/call/${reducerName}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...this.authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SpaceTimeDB reducer call failed (${response.status}): ${body}`);
    }
  }

  async sql(query: string): Promise<SqlStatementResult[]> {
    const endpoint = `${this.baseUrl}/v1/database/${this.database}/sql`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...this.authHeaders,
        "Content-Type": "text/plain",
      },
      body: query,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SpaceTimeDB SQL failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as SqlStatementResult[];
    return data;
  }
}
