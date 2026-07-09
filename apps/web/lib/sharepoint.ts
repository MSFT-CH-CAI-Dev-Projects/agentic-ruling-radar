/**
 * Microsoft Graph upload for Ruling Radar drafts.
 *
 * Uses an Entra app registration (client-credentials flow) with
 * Sites.Selected or Files.ReadWrite.All to upload draft markdown to
 * the configured SharePoint drive.
 *
 * Required env:
 *   GRAPH_TENANT_ID
 *   GRAPH_APP_CLIENT_ID
 *   GRAPH_APP_CLIENT_SECRET
 *   SHAREPOINT_DRIVE_ID
 *   SHAREPOINT_SITE_URL (display only, used to build the human link)
 *
 * Files land under /Drafts/<docket>_<YYYY-MM-DD>.md in the configured
 * drive's root.
 */
import { ClientSecretCredential } from "@azure/identity";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const FOLDER = "Drafts";

let cachedCred: ClientSecretCredential | null = null;

function getCred(): ClientSecretCredential {
  if (cachedCred) return cachedCred;
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_APP_CLIENT_ID;
  const secret = process.env.GRAPH_APP_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) {
    throw new Error(
      "Graph credentials missing — set GRAPH_TENANT_ID, GRAPH_APP_CLIENT_ID, GRAPH_APP_CLIENT_SECRET",
    );
  }
  cachedCred = new ClientSecretCredential(tenant, clientId, secret);
  return cachedCred;
}

async function getAccessToken(): Promise<string> {
  const tok = await getCred().getToken(GRAPH_SCOPE);
  if (!tok?.token) throw new Error("Graph token acquisition returned empty");
  return tok.token;
}

export type SharePointUploadResult = {
  webUrl: string;
  fileName: string;
  driveItemId: string;
};

export async function uploadDraftToSharePoint(opts: {
  docket: string;
  decisionDate?: string | null;
  contentMarkdown: string;
}): Promise<SharePointUploadResult> {
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  if (!driveId) throw new Error("SHAREPOINT_DRIVE_ID missing");

  const safeDocket = opts.docket.replace(/[^A-Za-z0-9_-]+/g, "_");
  const datePart = (opts.decisionDate ?? new Date().toISOString().slice(0, 10))
    .slice(0, 10)
    .replace(/[^0-9-]/g, "");
  const fileName = `${safeDocket}_${datePart}.md`;
  const path = `${FOLDER}/${fileName}`;

  const token = await getAccessToken();
  const url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}` +
    `/root:/${encodeURI(path)}:/content`;

  const body = Buffer.from(opts.contentMarkdown, "utf-8");
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/markdown; charset=utf-8",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph upload failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const item = (await res.json()) as {
    id: string;
    name: string;
    webUrl?: string;
  };
  return {
    webUrl: item.webUrl ?? "",
    fileName: item.name ?? fileName,
    driveItemId: item.id,
  };
}
