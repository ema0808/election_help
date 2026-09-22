import { NextResponse } from "next/server";

// Trivial endpoint the client pings to confirm *actual* connectivity, since
// navigator.onLine only reflects whether a network interface is up (e.g. it
// stays true on wifi with no real internet access). Must never be served
// from a cache (HTTP or service worker) or it stops being a real probe.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
