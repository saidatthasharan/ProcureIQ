import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Sparkles,
  Send,
  Database,
  Calculator,
  AlertTriangle,
  FileCheck,
  Download,
  RotateCcw,
} from 'lucide-react';
import {
  LineItem,
  Vendor,
  VendorQuoteCell,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  ExtractionException,
  AnalystMessage,
} from '../types/procurement';
import { askAnalyst } from '../services/analystClient';
import { ApiError, type Health } from '../services/extractionClient';
import { TrustBadge } from './GovernanceUI';

interface AiAnalystViewProps {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  exceptions: ExtractionException[];
  usdToInrRate: number;
  health?: Health | null;
}

const SUGGESTED_QUESTIONS = [
  'Which vendor is cheapest for every line item?',
  'What is the total cost if we award everything to one vendor?',
  'What happens if we split the purchase among the cheapest quality-qualified vendors?',
  'Which vendors failed mandatory quality checks?',
  'Which vendors quoted fewer than 30 items?',
  'What is the impact of freight charges?',
  'Which quotations contain unresolved assumptions?',
  'What is our potential savings against the baseline?',
  'Which vendor provides the best delivery commitment?',
  'Prepare an award recommendation for the VP.',
];

export const AiAnalystView: React.FC<AiAnalystViewProps> = ({
  lineItems,
  vendors,
  quoteCells,
  questions,
  responses,
  exceptions,
  usdToInrRate,
  health,
}) => {
  const [messages, setMessages] = useState<AnalystMessage[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const handleAskQuestion = async (questionText: string) => {
    if (isThinking) return;
    const cleanQ = questionText.replace(/^\d+\.\s*/, '');
    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: AnalystMessage = { id: `usr-${Date.now()}`, role: 'user', timestamp: now(), promptText: cleanQ, isDemoSimulation: false };
    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsThinking(true);
    const history = messages
      .filter((m) => m.role === 'user' || m.headlineAnswer)
      .map((m) => ({ role: m.role, text: m.role === 'user' ? m.promptText : [m.headlineAnswer, ...(m.narrativeParagraphs ?? [])].join('\n') }));
    try {
      const r = await askAnalyst(cleanQ, history, { lineItems, vendors, quoteCells, questions, responses, exceptions, usdToInrRate });
      const paras = r.answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const reply: AnalystMessage = {
        id: `ast-${Date.now()}`, role: 'assistant', timestamp: now(), promptText: cleanQ, isDemoSimulation: false,
        headlineAnswer: paras[0], narrativeParagraphs: paras.slice(1),
        tables: r.tables, tableData: r.tables[0], toolTrace: r.toolTrace, ungroundedFigures: r.ungroundedFigures, model: r.model,
      };
      setMessages((prev) => [...prev, reply]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'The analyst could not answer.';
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', timestamp: now(), promptText: cleanQ, isDemoSimulation: false, error: msg }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleExportAnalysisCsv = (msg: AnalystMessage) => {
    const lines: string[] = [
      `"Query","${msg.promptText.replace(/"/g, '""')}"`,
      `"Headline Conclusion","${(msg.headlineAnswer || '').replace(/"/g, '""')}"`,
      '',
    ];
    if (msg.tableData) {
      lines.push(msg.tableData.headers.map((h) => `"${h}"`).join(','));
      msg.tableData.rows.forEach((r) => {
        lines.push(r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
      });
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ProcureIQ_Analyst_Brief.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              AI Procurement Analyst
            </h1>
            <TrustBadge
              type="ai_generated"
              labelOverride={
                health?.aiConfigured && health.capabilities.analyst
                  ? `Gemini tool-using analyst · ${health.model}`
                  : 'Unavailable: server AI key not set'
              }
            />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Ask questions in plain language. The AI chooses which controlled tools to run; every figure comes from deterministic code and can be traced to the tools listed under each answer
          </p>
        </div>

        <button
          onClick={() => setMessages([])}
          className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset History</span>
        </button>
      </div>

      {/* Main Two-Column Analyst Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Suggested Queries */}
        <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-900">
              Suggested Analytical Queries (10)
            </h2>
            <span className="text-[10px] font-mono text-slate-400">{quoteCells.length} cells</span>
          </div>

          <div className="space-y-1">
            {SUGGESTED_QUESTIONS.map((q, idx) => (
              <button
                key={q}
                onClick={() => void handleAskQuestion(q)}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-[#6161F5]/[0.05] hover:text-slate-900 rounded-md transition-colors flex items-start gap-2 cursor-pointer"
              >
                <span className="font-mono text-[10px] text-slate-400 mt-0.5">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span className="leading-snug">{q}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Structured Analyst Feed & Prompt Input */}
        <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-lg flex flex-col h-[700px] overflow-hidden">
          <div className="flex-1 p-5 overflow-y-auto space-y-6">
            {messages.length === 0 && !isThinking && (
              <div className="text-xs text-slate-500 leading-relaxed">
                No questions asked yet. Pick a suggested query or type your own. If no vendor document has been processed, the analyst will tell you there is nothing to analyse.
              </div>
            )}
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-[#32323A] text-white px-4 py-2.5 rounded-lg max-w-xl text-xs">
                      <div className="text-[10px] text-slate-300 font-mono mb-0.5">
                        Query · {msg.timestamp}
                      </div>
                      <div className="font-medium">{msg.promptText}</div>
                    </div>
                  </div>
                );
              }

              if (msg.error) {
                return (
                  <div key={msg.id} className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-xs text-amber-900">
                    {msg.error} Nothing was calculated.
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className="border border-slate-200/90 rounded-lg p-5 space-y-4 text-xs bg-white"
                >
                  {/* Top Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-[#6161F5]/[0.1] text-[#6161F5] flex items-center justify-center">
                        <Sparkles className="w-3 h-3" />
                      </span>
                      <span className="font-semibold text-slate-900">
                        Analyst Report
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {msg.timestamp}
                      </span>
                    </div>

                    <button
                      onClick={() => handleExportAnalysisCsv(msg)}
                      className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      <span>Export Table (.CSV)</span>
                    </button>
                  </div>

                  {/* Prominent Headline Answer */}
                  {msg.headlineAnswer && (
                    <div className="p-3.5 bg-[#6161F5]/[0.04] border border-[#6161F5]/20 rounded-md text-sm font-semibold text-slate-900 leading-snug">
                      {msg.headlineAnswer}
                    </div>
                  )}

                  {/* Narrative Paragraphs */}
                  {msg.narrativeParagraphs && (
                    <div className="space-y-2 text-slate-600 leading-relaxed">
                      {msg.narrativeParagraphs.map((p, i) => (
                        <p key={i} className="whitespace-pre-line">{p}</p>
                      ))}
                    </div>
                  )}

                  {/* Structured Result Tables (taken from tool output, never from model text) */}
                  {(msg.tables ?? (msg.tableData ? [{ title: '', ...msg.tableData }] : [])).map((tb, tIdx) => (
                    <div key={tIdx} className="border border-slate-200/90 rounded-md overflow-x-auto">
                      {tb.title && <div className="px-3 py-1.5 text-[11px] font-medium text-slate-600 bg-slate-50/70 border-b border-slate-200">{tb.title}</div>}
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 font-medium text-slate-500">
                            {tb.headers.map((h, i) => (
                              <th key={i} className="py-2 px-3">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70">
                          {tb.rows.map((r, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50/70">
                              {r.map((cellVal, cIdx) => (
                                <td key={cIdx} className="py-2 px-3 font-mono text-slate-800">{cellVal}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  {msg.ungroundedFigures && msg.ungroundedFigures.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-900">
                      Check before relying on this: the figure(s) {msg.ungroundedFigures.join(', ')} appear in the answer but were not found in any tool result. Treat them as unverified.
                    </div>
                  )}

                  {/* Chart */}
                  {msg.chartData && (
                    <div className="p-4 border border-slate-200/80 rounded-md space-y-2 bg-slate-50/30">
                      <div className="text-xs font-medium text-slate-700">
                        {msg.chartData.title}
                      </div>
                      <div className="h-40 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={msg.chartData.data}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#E4E4E7"
                            />
                            <XAxis dataKey={msg.chartData.xKey} tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{
                                fontSize: '11px',
                                borderRadius: '6px',
                                borderColor: '#E4E4E7',
                              }}
                            />
                            <Bar
                              dataKey={msg.chartData.yKey}
                              fill="#6161F5"
                              radius={[4, 4, 0, 0]}
                              barSize={32}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Calculation Explanations, Sources, Assumptions, Risks */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {msg.toolTrace && (
                      <div className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-md space-y-1 md:col-span-2">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5 text-[11px]">
                          <Calculator className="w-3.5 h-3.5 text-[#6161F5]" />
                          <span>Tools the analyst ran{msg.model ? ` (${msg.model})` : ''}</span>
                        </div>
                        <ul className="space-y-1 text-[11px] font-mono text-slate-600">
                          {msg.toolTrace.length === 0 && <li>• None. The answer did not use any data.</li>}
                          {msg.toolTrace.map((t) => (
                            <li key={t.id}>• {t.id} {t.name}({Object.keys(t.args).length ? JSON.stringify(t.args) : ''}) {t.ok ? '' : `— failed: ${t.error}`}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {msg.calculationBreakdown && (
                      <div className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-md space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5 text-[11px]">
                          <Calculator className="w-3.5 h-3.5 text-[#6161F5]" />
                          <span>Calculation Breakdown</span>
                        </div>
                        <ul className="space-y-1 text-[11px] font-mono text-slate-600">
                          {msg.calculationBreakdown.map((c, i) => (
                            <li key={i}>• {c}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {msg.dataSources && (
                      <div className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-md space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5 text-[11px]">
                          <Database className="w-3.5 h-3.5 text-slate-500" />
                          <span>Source References</span>
                        </div>
                        <ul className="space-y-1 text-[11px] font-mono text-slate-500">
                          {msg.dataSources.map((s, i) => (
                            <li key={i}>• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {msg.assumptions && (
                      <div className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-md space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5 text-[11px]">
                          <FileCheck className="w-3.5 h-3.5 text-slate-500" />
                          <span>Assumptions</span>
                        </div>
                        <ul className="space-y-1 text-[11px] text-slate-600">
                          {msg.assumptions.map((a, i) => (
                            <li key={i}>• {a}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {msg.unresolvedRisks && (
                      <div className="p-3 bg-amber-50/50 border border-amber-200/80 rounded-md space-y-1">
                        <div className="font-semibold text-amber-900 flex items-center gap-1.5 text-[11px]">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          <span>Unresolved Risks</span>
                        </div>
                        <ul className="space-y-1 text-[11px] text-amber-800">
                          {msg.unresolvedRisks.map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isThinking && <div className="px-5 pb-2 text-[11px] text-slate-500">Analyst is running tools…</div>}

          {/* Prompt Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputQuery.trim()) {
                void handleAskQuestion(inputQuery.trim());
              }
            }}
            className="p-3.5 border-t border-slate-200/80 bg-slate-50/50 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask about line item prices, freight impact, quality disqualifications, or savings..."
              className="flex-1 px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#6161F5]"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Run Analysis</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
