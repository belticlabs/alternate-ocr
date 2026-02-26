import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ACCESS_COOKIE = "glm_ocr_access";

export function middleware(request: NextRequest): NextResponse {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie === accessCode) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  if (path === "/access" || path.startsWith("/api/access")) {
    return NextResponse.next();
  }

  const url = new URL("/access", request.url);
  url.searchParams.set("from", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
