import { NextResponse } from "next/server";

import { listRecentRulings } from "@/lib/cosmos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const drafts = await listRecentRulings(50);
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json(
      { error: `Cosmos read failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
