import { NextResponse } from "next/server";

import { listRecentRuns } from "@/lib/cosmos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = await listRecentRuns(20);
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      { error: `Cosmos query failed: ${(err as Error).message}`, runs: [] },
      { status: 502 },
    );
  }
}
