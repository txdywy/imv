import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

interface StoredSignal {
  type: string;
  from: string;
  to?: string;
  data: unknown;
  timestamp: number;
}

interface RoomData {
  messages: StoredSignal[];
  peers: string[];
  createdAt: number;
}

// In-memory store for local dev only
const memoryStore = new Map<string, RoomData>();
const isDev = process.env.NODE_ENV === "development";
const ROOM_TTL = 3600;

async function getRoom(roomId: string): Promise<RoomData | null> {
  const r = getRedis();
  if (r) return await r.get<RoomData>(`room:${roomId}`);
  if (isDev) return memoryStore.get(`room:${roomId}`) || null;
  return null;
}

async function setRoom(roomId: string, data: RoomData) {
  const r = getRedis();
  if (r) {
    await r.set(`room:${roomId}`, data, { ex: ROOM_TTL });
  } else if (isDev) {
    memoryStore.set(`room:${roomId}`, data);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, roomId } = body;

  if (!roomId || typeof roomId !== "string") {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  if (action === "createRoom") {
    const existing = await getRoom(roomId);
    if (existing) {
      return NextResponse.json({ error: "Room already exists" }, { status: 409 });
    }
    await setRoom(roomId, { messages: [], peers: [], createdAt: Date.now() });
    return NextResponse.json({ ok: true });
  }

  if (action === "joinRoom") {
    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const { peerId } = body;
    if (peerId && !room.peers.includes(peerId)) {
      room.peers.push(peerId);
      await setRoom(roomId, room);
    }
    return NextResponse.json({ ok: true, peers: room.peers });
  }

  if (action === "signal") {
    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    room.messages.push(body.message as StoredSignal);
    await setRoom(roomId, room);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  const peerId = req.nextUrl.searchParams.get("peerId");
  const targetId = req.nextUrl.searchParams.get("targetId");

  if (!roomId || !peerId) {
    return NextResponse.json({ error: "roomId and peerId required" }, { status: 400 });
  }

  const room = await getRoom(roomId);
  if (!room) {
    return NextResponse.json([]);
  }

  const messages = room.messages.filter((m) => {
    if (m.from === peerId) return false;
    if (targetId) return m.to === peerId && m.from === targetId;
    return !m.to || m.to === peerId;
  });

  const deliveredSet = new Set(messages);
  room.messages = room.messages.filter((m) => !deliveredSet.has(m));
  await setRoom(roomId, room);

  return NextResponse.json(messages);
}
