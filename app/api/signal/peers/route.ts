import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

interface RoomData {
  messages: unknown[];
  peers: string[];
  createdAt: number;
}

const memoryStore = new Map<string, RoomData>();
const isDev = process.env.NODE_ENV === "development";

async function getRoom(roomId: string): Promise<RoomData | null> {
  const r = getRedis();
  if (r) return await r.get<RoomData>(`room:${roomId}`);
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
