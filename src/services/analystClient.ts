import type { LineItem, Vendor, VendorQuoteCell, QuestionnaireQuestion, VendorQuestionnaireResponse, ExtractionException } from '../types/procurement';
import { postJson } from './extractionClient';

export interface AnalystApiResult {
  answer: string;
  tables: { title: string; headers: string[]; rows: (string | number)[][] }[];
  toolTrace: { id: string; name: string; args: Record<string, unknown>; ok: boolean; error?: string }[];
  ungroundedFigures: string[];
  model: string;
  stoppedEarly: boolean;
}

export interface AnalystSnapshot {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  exceptions: ExtractionException[];
  usdToInrRate: number;
}

export const askAnalyst = (question: string, history: { role: 'user' | 'assistant'; text: string }[], state: AnalystSnapshot) =>
  postJson<AnalystApiResult>('/api/analyst', { question, history, state });
