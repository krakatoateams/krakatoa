type JsonResponseLike = Pick<Response, "ok" | "status" | "json">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readRequiredAdminConfigJson(
  response: JsonResponseLike,
  label: string
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : `Failed to load ${label} (${response.status}).`;
    throw new Error(message);
  }
  if (!isRecord(body)) {
    throw new Error(`Invalid ${label} response.`);
  }
  return body;
}

export function requireAdminConfigRows(
  body: Record<string, unknown>,
  field: string,
  label: string
): Array<Record<string, unknown>> {
  const rows = body[field];
  if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
    throw new Error(`Invalid ${label} response.`);
  }
  return rows;
}
