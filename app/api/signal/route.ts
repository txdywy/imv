import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

interface SignalData {
  offer?: unknown;
  answer?: unknown;
  candidates?: unknown[];
}

const memoryStore = new Map<string, SignalData>();
const isDev = process.env.NODE_ENV === "development";
const SIGNAL_TTL = 300;

async function getData(roomId: string): Promise<SignalData | null> {
  const r = getRedis();
  if (r) return await r.get<SignalData>(`sig:${roomId}`);
  if (isDev) return memoryStore.get(`sig:${roomId}`) || null;
  return null;
}

async function setData(roomId: string, data: SignalData) {
  const r = getRedis();
  if (r) {
    await r.set(`sig:${roomId}`, data, { ex: SIGNAL_TTL });
  } else if (isDev) {
    memoryStore.set(`sig:${roomId}`, data);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, roomId } = body;

  if (!roomId || typeof roomId !== "string") {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  if (action === "offer") {
    await setData(roomId, { offer: body.sdp, candidates: [] });
    return NextResponse.json({ ok: true });
  }

  if (action === "answer") {
    const data = (await getData(roomId)) || {};
    data.answer = body.sdp;
    await setData(roomId, data);
    return NextResponse.json({ ok: true });
  }

  if (action === "candidate") {
    const data = (await getData(roomId)) || {};
    if (!data.candidates) data.candidates = [];
    data.candidates.push(body.candidate);
    await setData(roomId, data);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  const data = await getData(roomId);
  if (!data) return NextResponse.json({});

  return NextResponse.json(data);
}
