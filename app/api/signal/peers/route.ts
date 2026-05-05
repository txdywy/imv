import { NextRequest, NextResponse } from "next/server";

interface RoomData {
  messages: unknown[];
  peers: string[];
  createdAt: number;
}

const memoryStore = new Map<string, RoomData>();
const isDev = process.env.NODE_ENV === "development";

let kvInstance: typeof import("@vercel/kv").kv | null | undefined = undefined;

async function getKV() {
  if (kvInstance !== undefined) return kvInstance;
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv");
    kvInstance = kv;
    return kv;
  }
  kvInstance = null;
  return null;
}

async function getRoom(roomId: string) {
  const kv = await getKV();
  if (kv) return await kv.get<RoomData>(`room:${roomId}`);
  if (isDev) return memoryStore.get(`room:${roomId}`) || null;
  return null;
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  const room = await getRoom(roomId);
  if (!room) return NextResponse.json({ peers: [] });

  return NextResponse.json({ peers: room.peers });
}
