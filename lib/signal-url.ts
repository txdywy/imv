// Encode SDP offer/answer into URL-safe base64
export function encodeSignal(sdp: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(sdp))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeSignal(encoded: string): RTCSessionDescriptionInit {
  const base64 = toBase64(encoded);
  return JSON.parse(atob(base64));
}

// Encode full ICE config + SDP into a compact shareable link
export function encodeOfferLink(
  origin: string,
  roomId: string,
  offer: RTCSessionDescriptionInit,
  iceServers?: RTCIceServer[]
): string {
  const payload = { sdp: offer, ice: iceServers };
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${origin}/room/${roomId}#offer=${encoded}`;
}

export function decodeOfferFromHash(hash: string): {
  sdp: RTCSessionDescriptionInit;
  ice?: RTCIceServer[];
} | null {
  const match = hash.match(/^#offer=(.+)$/);
  if (!match) return null;
  try {
    return JSON.parse(atob(toBase64(match[1])));
  } catch {
    return null;
  }
}

export function encodeAnswerHash(answer: RTCSessionDescriptionInit): string {
  const encoded = btoa(JSON.stringify(answer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `#answer=${encoded}`;
}

export function decodeAnswerFromHash(hash: string): RTCSessionDescriptionInit | null {
  const match = hash.match(/^#answer=(.+)$/);
  if (!match) return null;
  try {
    return JSON.parse(atob(toBase64(match[1])));
  } catch {
    return null;
  }
}

function toBase64(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
}
