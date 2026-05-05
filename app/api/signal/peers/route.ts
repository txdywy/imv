import { NextRequest, NextResponse } from "next/server";

interface RoomData {
  messages: unknown[];
  peers: string[];
  createdAt: number;
}

let kvInstance: unknown = undefined;

async function getKV() {
  if (kvInstance !== undefined) return kvInstance as typeof import("@vercel/kv").kv | null;
  if (process.env.KV_REST_API_URL) {
    const { kv } = await import("@vercel/kv");
    kvInstance = kv;
    return kv;
  }
  kvInstance = null;
  return null;
}

const memoryStore = new Map<string, RoomData>();

async function getRoom(roomId: string) {
  const kv = await getKV();
  if (kv) return await kv.get<RoomData>(`room:${roomId}`);
  return memoryStore.get(`room:${roomId}`) || null;
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  const room = await getRoom(roomId);
  if (!room) return NextResponse.json({ peers: [] });

  return NextResponse.json({ peers: room.peers });
}
