import { NextRequest, NextResponse } from "next/server";

// Stateless signaling — this endpoint exists only for the POST-answer flow.
// The offer is embedded in the URL hash. The answer is POSTed here and
// returned via polling. Uses Upstash Redis if available, memory otherwise.
// If neither works, the client falls back to URL-only mode (copy answer link).

import { getRedis } from "@/lib/redis";

interface SignalData {
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

async function setData(roomId: string, data: SignalData): Promise<boolean> {
  const r = getRedis();
  if (r) {
    await r.set(`sig:${roomId}`, data, { ex: SIGNAL_TTL });
    return true;
  } else if (isDev) {
    memoryStore.set(`sig:${roomId}`, data);
    return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, roomId } = body;

  if (!roomId || typeof roomId !== "string") {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  if (action === "answer") {
    const stored = await setData(roomId, { answer: body.sdp, candidates: [] });
    return NextResponse.json({ ok: true, stored });
  }

  if (action === "candidate") {
    const data = (await getData(roomId)) || {};
    if (!data.candidates) data.candidates = [];
    data.candidates.push(body.candidate);
    const stored = await setData(roomId, data);
    return NextResponse.json({ ok: true, stored });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  const data = await getData(roomId);
  if (!data) return NextResponse.json({});

  // Return and clear candidates
  const result: SignalData = { ...data };
  if (data.candidates?.length) {
    data.candidates = [];
    await setData(roomId, data);
  }
  return NextResponse.json(result);
}
