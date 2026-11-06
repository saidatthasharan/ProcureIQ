/**
 * HTTP API. Same-origin only; the browser never receives the Gemini key.
 *
 * NOT production-grade yet: there is no user authentication, no per-user quota
 * and no persistent audit log. The in-memory rate limiter only slows abuse of
 * the key. See docs/ (Phase 2 report) for the deployment changes required.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ModelCallError, ModelNotConfiguredError, createGeminiClient, isModelConfigured, DEFAULT_MODEL, type ModelClient } from './model';
import { ExtractionError, extractVendorDocument } from './extract';
import { UnsupportedFileError } from './parsers';
import { registerAiRoutes } from './routes-ai';
import { CopilotError } from './copilot';

export interface AppDeps {
  /** Returns a model client. Throws ModelNotConfiguredError when no key is set. */
  getModel: () => ModelClient;
  /** Requests per window per client for AI endpoints. */
  rateLimit?: { max: number; windowMs: number };
}

const LineItemInput = z.object({
  id: z.string(), code: z.string(), description: z.string(), standardUom: z.string(), quantity: z.number(),
});
const ExtractBody = z.object({
  fileName: z.string().min(1).max(260),
  mimeType: z.string().max(100).default(''),
  dataBase64: z.string().min(1),
  lineItems: z.array(LineItemInput).min(1).max(500),
});

export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many AI requests. Please wait a moment and try again.' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

export function createApp(deps: AppDeps = { getModel: createGeminiClient }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '30mb' }));
  const limit = createRateLimiter(deps.rateLimit?.max ?? 60, deps.rateLimit?.windowMs ?? 10 * 60 * 1000);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: isModelConfigured(),
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
      // Honest status for the UI: these are the capabilities the server really has.
      capabilities: { extraction: true, copilot: true, analyst: true }, // each is true only because its route exists
    });
  });

  app.post('/api/extract', limit, async (req, res, next) => {
    try {
      const body = ExtractBody.parse(req.body);
      const bytes = Buffer.from(body.dataBase64, 'base64');
      const model = deps.getModel();
      const out = await extractVendorDocument({ fileName: body.fileName, mimeType: body.mimeType, bytes, lineItems: body.lineItems }, model);
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  registerAiRoutes(app, deps, limit);

  // Unknown API routes must be JSON, not the SPA page.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown API route.' }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof ModelNotConfiguredError) return void res.status(503).json({ error: err.code, message: err.message });
    if (err instanceof ModelCallError) return void res.status(502).json({ error: err.code, message: `The AI service returned an error: ${err.message}` });
    if (err instanceof ExtractionError) return void res.status(422).json({ error: err.code, message: err.message, issues: err.issues });
    if (err instanceof CopilotError) return void res.status(422).json({ error: err.code, message: err.message, issues: err.issues });
    if (err instanceof UnsupportedFileError) return void res.status(400).json({ error: 'UNSUPPORTED_FILE', message: err.message });
    if (err instanceof z.ZodError) {
      return void res.status(400).json({ error: 'BAD_REQUEST', message: 'The request was not in the expected format.', issues: err.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    const status = (err as { status?: number; type?: string })?.type === 'entity.too.large' ? 413 : 500;
    if (status === 500) console.error('[server] unhandled error:', (err as Error)?.message);
    res.status(status).json({ error: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL', message: status === 413 ? 'The upload is too large.' : 'Unexpected server error.' });
  });

  return app;
}
