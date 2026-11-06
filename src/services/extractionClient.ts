/**
 * Browser-side client for the server API. The browser never holds the Gemini
 * key; it only sends the file to our own server.
 */
import type { LineItem } from '../types/procurement';
import type { VendorExtractionResult } from '../extraction/schema';

export interface SourceView {
  format: 'xlsx' | 'pdf' | 'docx' | 'image' | 'eml';
  name: string;
  notes: string[];
  units: { id: string; kind: string; page: number | null; sheet?: string; row?: number; text: string; inTable?: boolean }[];
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public issues: string[] = [], public status = 0) {
    super(message);
  }
}

export interface Health {
  ok: boolean;
  aiConfigured: boolean;
  model: string;
  capabilities: { extraction: boolean; copilot: boolean; analyst: boolean };
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) return null;
    return (await r.json()) as Health;
  } catch {
    return null;
  }
}

async function toBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('SERVER_UNREACHABLE', 'The ProcureIQ server could not be reached. Start it with "npm run dev" (the AI features need the server).');
  }
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok) {
    throw new ApiError(json?.error ?? 'HTTP_' + r.status, json?.message ?? `Request failed (${r.status}).`, json?.issues ?? [], r.status);
  }
  return json as T;
}

export interface ExtractResponse {
  result: VendorExtractionResult;
  sourceView: SourceView;
  schemaMode: string;
  repaired: boolean;
}

export async function extractDocument(file: File, lineItems: LineItem[]): Promise<ExtractResponse> {
  return postJson<ExtractResponse>('/api/extract', {
    fileName: file.name,
    mimeType: file.type,
    dataBase64: await toBase64(file),
    lineItems: lineItems.map((i) => ({ id: i.id, code: i.code, description: i.description, standardUom: i.standardUom, quantity: i.quantity })),
  });
}
