import { NextResponse } from "next/server";

export async function GET() {
  const hasKV = !!process.env.KV_REST_API_URL;
  return NextResponse.json({
    storage: hasKV ? "kv" : "memory",
    ready: hasKV || process.env.NODE_ENV === "development",
  });
}
