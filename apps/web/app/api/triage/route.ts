import { NextResponse } from "next/server";
import { listRecentTriageDecisions } from "@/lib/cosmos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const decisions = await listRecentTriageDecisions(200);
    return NextResponse.json({ decisions });
  } catch (err) {
    return NextResponse.json(
      {
        error: "cosmos_query_failed",
        message: (err as Error).message,
      },
      { status: 502 },
    );
  }
}
