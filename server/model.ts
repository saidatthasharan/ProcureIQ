/**
 * The only file that talks to Gemini.
 *
 * - The API key is read from process.env.GEMINI_API_KEY on the SERVER only.
 *   It is never sent to the browser and never logged.
 * - The model name comes from GEMINI_MODEL. The default below was taken from
 *   Google's published models page; override it if your key has access to a
 *   different model.
 * - Everything else in the server depends on the small ModelClient interface,
 *   so the pipeline can be tested with an injected stub.
 */
import { GoogleGenAI } from '@google/genai';

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export class ModelNotConfiguredError extends Error {
  code = 'GEMINI_KEY_MISSING' as const;
  constructor() {
    super('GEMINI_API_KEY is not set on the server. Add it to the server environment (.env) and restart. No result has been produced.');
  }
}

export class ModelCallError extends Error {
  code = 'MODEL_CALL_FAILED' as const;
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export type ModelPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GenerateJsonRequest {
  system: string;
  parts: ModelPart[];
  /** JSON Schema for structured output. */
  jsonSchema: unknown;
  temperature?: number;
  maxOutputTokens?: number;
}
export interface GenerateJsonResponse {
  text: string;
  /** 'json_schema' when the API accepted the schema, 'prompt_only' if it had to be dropped. */
  schemaMode: 'json_schema' | 'prompt_only';
}

export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema object describing the arguments. */
  parameters: unknown;
}
export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}
/** One conversation turn in a tool loop. Opaque to callers except for the fields below. */
export type ToolContent =
  | { role: 'user'; parts: ModelPart[] }
  | { role: 'model'; parts: unknown[] } // the model's own parts, echoed back exactly as received
  | { role: 'user'; parts: Array<{ functionResponse: { id?: string; name: string; response: Record<string, unknown> } }> };

export interface ToolTurnRequest {
  system: string;
  contents: ToolContent[];
  tools: ToolDeclaration[];
  temperature?: number;
}
export interface ToolTurnResponse {
  text: string;
  calls: ToolCall[];
  /** The model's raw response parts. Must be sent back unchanged on the next turn (keeps thought signatures intact). */
  modelParts: unknown[];
}

export interface ModelClient {
  readonly modelName: string;
  generateJson(req: GenerateJsonRequest): Promise<GenerateJsonResponse>;
  generateToolTurn(req: ToolTurnRequest): Promise<ToolTurnResponse>;
}

export function isModelConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

function describeError(e: unknown): { message: string; status?: number } {
  const anyE = e as { status?: number; message?: string };
  // Never echo anything that could contain the key.
  const key = process.env.GEMINI_API_KEY ?? '';
  let message = anyE?.message ?? String(e);
  if (key) message = message.split(key).join('[redacted]');
  return { message: message.slice(0, 600), status: anyE?.status };
}

export function createGeminiClient(): ModelClient {
  if (!isModelConfigured()) throw new ModelNotConfiguredError();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  return {
    modelName,

    async generateJson(req) {
      const base = {
        model: modelName,
        contents: [{ role: 'user', parts: req.parts }],
      };
      const common = {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        temperature: req.temperature ?? 0,
        maxOutputTokens: req.maxOutputTokens ?? 32768,
      };
      try {
        const r = await ai.models.generateContent({ ...base, config: { ...common, responseJsonSchema: req.jsonSchema } });
        return { text: r.text ?? '', schemaMode: 'json_schema' };
      } catch (e) {
        const d = describeError(e);
        // If the API rejects our schema dialect, retry once without it. The result is still
        // validated strictly by zod afterwards, and the mode is recorded in the audit trail.
        if (d.status === 400 && /schema/i.test(d.message)) {
          try {
            const r2 = await ai.models.generateContent({
              ...base,
              config: { ...common, systemInstruction: `${req.system}\n\nReturn ONLY JSON matching this JSON Schema:\n${JSON.stringify(req.jsonSchema)}` },
            });
            return { text: r2.text ?? '', schemaMode: 'prompt_only' };
          } catch (e2) {
            const d2 = describeError(e2);
            throw new ModelCallError(d2.message, d2.status);
          }
        }
        throw new ModelCallError(d.message, d.status);
      }
    },

    async generateToolTurn(req) {
      try {
        const r = await ai.models.generateContent({
          model: modelName,
          contents: req.contents as never,
          config: {
            systemInstruction: req.system,
            temperature: req.temperature ?? 0.2,
            tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
          },
        });
        const calls = (r.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? '', args: (c.args ?? {}) as Record<string, unknown> }));
        const modelParts = (r.candidates?.[0]?.content?.parts ?? []) as unknown[];
        return { text: r.text ?? '', calls, modelParts };
      } catch (e) {
        const d = describeError(e);
        throw new ModelCallError(d.message, d.status);
      }
    },
  };
}
