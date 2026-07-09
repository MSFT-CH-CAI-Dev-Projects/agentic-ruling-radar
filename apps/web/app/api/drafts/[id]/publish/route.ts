import { NextResponse } from "next/server";

import { getRulingById, updateRulingSharePoint } from "@/lib/cosmos";
import { uploadDraftToSharePoint } from "@/lib/sharepoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  const contentMarkdown = `# ${doc.title_de}\n\n${doc.summary_markdown}\n`;
  let upload;
  try {
    upload = await uploadDraftToSharePoint({
      docket: doc.docket,
      decisionDate: doc.decision_date ?? null,
      contentMarkdown,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `SharePoint upload failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  try {
    await updateRulingSharePoint(doc.id, doc.docket, upload.webUrl);
  } catch (err) {
    console.warn("[publish] cosmos update failed:", (err as Error).message);
  }

  return NextResponse.json({
    ok: true,
    sharepoint_url: upload.webUrl,
    file_name: upload.fileName,
    drive_item_id: upload.driveItemId,
  });
}
