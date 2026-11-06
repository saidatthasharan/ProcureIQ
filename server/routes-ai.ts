/** AI routes other than extraction: the tool-using analyst (and, later in this file, the RFx copilot). */
import type { Express, RequestHandler } from 'express';
import type { AppDeps } from './app';
import { AnalystBody, runAnalyst } from './analyst';
import type { AnalystState } from './analyst-tools';
import { CopilotBody, runCopilot } from './copilot';

export function registerAiRoutes(app: Express, deps: AppDeps, limit: RequestHandler): void {
  app.post('/api/analyst', limit, async (req, res, next) => {
    try {
      const body = AnalystBody.parse(req.body);
      const model = deps.getModel();
      const result = await runAnalyst(body.question, body.history, body.state as unknown as AnalystState, model);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/copilot', limit, async (req, res, next) => {
    try {
      const body = CopilotBody.parse(req.body);
      const model = deps.getModel();
      res.json(await runCopilot(body.instruction, body.history, body.rfx, model));
    } catch (e) {
      next(e);
    }
  });
}
