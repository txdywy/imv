import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export async function GET() {
  const hasRedis = !!getRedis();
  return NextResponse.json({
    storage: hasRedis ? "redis" : "memory",
    ready: hasRedis || process.env.NODE_ENV === "development",
  });
}
