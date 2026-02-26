import { NextResponse } from "next/server";

const ACCESS_COOKIE = "glm_ocr_access";

export async function POST(request: Request): Promise<NextResponse> {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) {
    return NextResponse.json({ ok: false, error: "Access code not configured." }, { status: 400 });
  }

  let body: { code?: string };
  try {
    body = (await request.json()) as { code?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (code !== accessCode) {
    return NextResponse.json({ ok: false, error: "Invalid code." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(ACCESS_COOKIE, accessCode, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
