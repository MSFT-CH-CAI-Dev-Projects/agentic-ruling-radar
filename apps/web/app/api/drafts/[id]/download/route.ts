import { NextResponse } from "next/server";

import { getRulingById } from "@/lib/cosmos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing draft id" }, { status: 400 });
  }
  let doc;
  try {
    doc = await getRulingById(id);
  } catch (err) {
    return NextResponse.json(
      { error: `Cosmos read failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  if (!doc) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const filename = `${doc.docket.replace(/[^A-Za-z0-9_-]+/g, "_")}_${doc.ts.slice(0, 10)}.md`;
  const body = `# ${doc.title_de}\n\n${doc.summary_markdown}\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
