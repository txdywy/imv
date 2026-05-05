import { NextRequest, NextResponse } from "next/server";

// Stateless signaling API backed by Upstash Redis when configured, with an
// in-memory fallback for simple deployments. It stores one WebRTC offer/answer
// pair per room id.

import { getRedis } from "@/lib/redis";

interface SignalData {
  offer?: unknown;
  answer?: unknown;
  expiresAt?: number;
}

const memoryStore = new Map<string, SignalData>();
const SIGNAL_TTL = 300;

async function getData(roomId: string): Promise<SignalData | null> {
  const r = getRedis();
  if (r) return await r.get<SignalData>(`sig:${roomId}`);

  const key = `sig:${roomId}`;
  const data = memoryStore.get(key);
  if (!data) return null;
  if (data.expiresAt && data.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return data;
}

async function setData(roomId: string, data: SignalData): Promise<boolean> {
  const r = getRedis();
  if (r) {
    await r.set(`sig:${roomId}`, data, { ex: SIGNAL_TTL });
    return true;
  }

  memoryStore.set(`sig:${roomId}`, {
    ...data,
    expiresAt: Date.now() + SIGNAL_TTL * 1000,
  });
  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, roomId } = body;

  if (!roomId || typeof roomId !== "string") {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  if (action === "offer") {
    const existing = await getData(roomId);
    if (existing?.offer && !existing.answer) {
      return NextResponse.json({ error: "Room already has a waiting peer" }, { status: 409 });
    }

    const stored = await setData(roomId, { offer: body.sdp });
    if (!stored) {
      return NextResponse.json({ error: "Signaling store unavailable" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, stored });
  }

  if (action === "answer") {
    const data = (await getData(roomId)) || {};
    const stored = await setData(roomId, { ...data, answer: body.sdp });
    if (!stored) {
      return NextResponse.json({ error: "Signaling store unavailable" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, stored });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  const data = await getData(roomId);
  if (!data) {
    return NextResponse.json({});
  }

  return NextResponse.json(data);
}
