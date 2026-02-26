import { NextResponse } from "next/server";
import { getRepository } from "@/lib/server/persistence";
import { serializeRunDetail } from "@/lib/server/serializers";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    const detail = await repository.getRunDetail(id);

    if (!detail) {
      return jsonError("Run not found.", 404);
    }

    return NextResponse.json({
      runDetail: serializeRunDetail(detail),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch run.";
    return jsonError(message, 500);
  }
}
