interface ProductSchemaElement {
  name?: { some?: string; none?: unknown[] } | string;
}

interface ProductSchema {
  elements?: ProductSchemaElement[];
}

function decodeSumLike(value: Record<string, unknown>): unknown {
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return value;
  }

  const key = keys[0]!;
  const nested = value[key];

  if (key === "none") {
    return null;
  }

  if (key === "some") {
    return decodeSatsValue(nested);
  }

  if (/^\d+$/.test(key)) {
    return decodeSatsValue(nested);
  }

  if (Array.isArray(nested) && nested.length === 0) {
    return key;
  }

  return decodeSatsValue(nested);
}

export function decodeSatsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => decodeSatsValue(item));
  }

  if (value && typeof value === "object") {
    return decodeSumLike(value as Record<string, unknown>);
  }

  return value;
}

function getColumnNames(schema: unknown, defaultCount: number): string[] {
  const product = schema as ProductSchema;

  if (!product?.elements || product.elements.length === 0) {
    return Array.from({ length: defaultCount }, (_, index) => `column_${index}`);
  }

  return product.elements.map((element, index) => {
    const rawName = element?.name;

    if (typeof rawName === "string" && rawName.length > 0) {
      return rawName;
    }

    if (rawName && typeof rawName === "object" && "some" in rawName && typeof rawName.some === "string") {
      return rawName.some;
    }

    return `column_${index}`;
  });
}

export function parseSqlRows<T extends Record<string, unknown>>(
  schema: unknown,
  rows: unknown[] | undefined
): T[] {
  if (!rows || rows.length === 0) {
    return [];
  }

  const firstRow = rows[0];
  const defaultCount = Array.isArray(firstRow) ? firstRow.length : 0;
  const names = getColumnNames(schema, defaultCount);

  return rows.map((row) => {
    if (Array.isArray(row)) {
      const mapped: Record<string, unknown> = {};

      row.forEach((value, index) => {
        const key = names[index] ?? `column_${index}`;
        mapped[key] = decodeSatsValue(value);
      });

      return mapped as T;
    }

    if (row && typeof row === "object") {
      const mapped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        mapped[key] = decodeSatsValue(value);
      }

      return mapped as T;
    }

    return {} as T;
  });
}
