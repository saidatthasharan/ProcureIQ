/**
 * Entry point. Serves the API and the web app from one origin.
 *   dev:   npm run dev     (Vite middleware, hot reload)
 *   prod:  npm run build && npm start
 * The Gemini key lives only in this process's environment (.env or host secrets).
 */
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createApp } from './server/app';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = createApp();

if (isProd) {
  const dist = path.resolve(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ProcureIQ server on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
  console.log(`AI configured: ${Boolean(process.env.GEMINI_API_KEY?.trim())}`);
});
