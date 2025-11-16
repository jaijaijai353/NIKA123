import { isGeminiConfigured, model as gemModel } from './gemini';

type QAOpts = {
  query: string;
  context: { summary?: string; columns?: string[]; sampleRows?: any[] };
  config?: { timeoutMs?: number; modelName?: string };
};

type QAResult = {
  answer: string;
  explanation?: string;
  calculations?: Array<Record<string, any>>;
  sources?: string[];
  meta: { model: string; tokensEstimate: number; fallback: boolean };
};

let localModel: any = gemModel;

// Log model initialization status
if (!localModel || !isGeminiConfigured) {
  console.warn('⚠️ QA Service: Gemini model not available. Will use fallback responses.');
} else {
  console.log('✅ QA Service: Gemini model initialized successfully');
}

const breaker = {
  failures: [] as number[],
  openUntil: 0,
};

const now = () => Date.now();

const breakerOpen = () => breaker.openUntil > now();

const recordFailure = () => {
  breaker.failures.push(now());
  const cutoff = now() - 15 * 60 * 1000;
  breaker.failures = breaker.failures.filter((t) => t >= cutoff);
  if (breaker.failures.length >= 5) {
    breaker.openUntil = now() + 30 * 60 * 1000;
  }
};

const resetBreaker = () => {
  breaker.failures = [];
  breaker.openUntil = 0;
};

const sanitizeInput = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 4000);

const promptFrom = (q: string, ctx: { summary?: string; columns?: string[]; sampleRows?: any[] }) => {
  const cols = (ctx.columns || []).slice(0, 50);
  const rows = (ctx.sampleRows || []).slice(0, 5);
  const rowsJson = JSON.stringify(rows);
  const summary = ctx.summary || '';
  const hasData = cols.length > 0 || (rows && rows.length > 0);
  
  // Debug logging to trace dataset context
  console.log('🔍 QA Debug - Dataset context:', {
    hasData,
    columnsCount: cols.length,
    rowsCount: rows.length,
    columns: cols,
    sampleRows: rows,
    summary: summary
  });
  
  let base: string;
  if (hasData) {
    base = `You are a data analytics expert. Analyze the provided dataset and answer the user query with specific insights. Return ONLY valid JSON with keys: answer (string with specific insights), explanation (string), calculations (array of numeric results), sources (array of column names used).
Dataset Summary: ${summary}
Columns: ${cols.join(', ')}
Sample Data: ${rowsJson}
User Query: ${q}`;
  } else {
    base = `You are a helpful assistant. Answer the user's question helpfully and comprehensively. If dataset context is provided, use it to inform your response. Return ONLY valid JSON with keys: answer (string with your response), explanation (string with additional details), calculations (empty array []), sources (array []).
User Query: ${q}`;
  }
  return sanitizeInput(base);
};

const parseJson = (text: string) => {
  const m = text.match(/\{[\s\S]*\}/);
  const t = m ? m[0] : text;
  return JSON.parse(t);
};

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export async function generateGeminiAnswer(opts: QAOpts): Promise<QAResult> {
  const timeoutMs = opts.config?.timeoutMs ?? 15000;
  const mdl = opts.config?.modelName ?? 'gemini-pro';
  const fallbackRes = (query?: string): QAResult => ({
    answer: query ? `I apologize, I cannot process your query at this moment. Query: "${query}"` : 'Service temporarily unavailable.',
    explanation: 'The AI service encountered an issue. Please try again or upload data for analysis.',
    calculations: [],
    sources: [],
    meta: { model: 'fallback', tokensEstimate: 0, fallback: true },
  });

  const inputPrompt = promptFrom(opts.query, opts.context);

  // Check preconditions
  // Debug: log Gemini configuration and model availability
  try {
    console.log('🔎 Gemini config:', { isGeminiConfigured, gemModelPresent: !!gemModel, localModelPresent: !!localModel });
  } catch (e) {
    console.warn('⚠️ Failed to log Gemini debug info', e);
  }

  if (!isGeminiConfigured) {
    console.warn('⚠️ Gemini not configured. Using fallback.');
    return fallbackRes(opts.query);
  }

  if (breakerOpen()) {
    console.warn('⚠️ Circuit breaker is open. Using fallback.');
    return fallbackRes(opts.query);
  }

  // Update localModel from current gemModel (in case it was reloaded)
  localModel = gemModel;
  
  if (!localModel) {
    console.error('❌ Gemini model is null/undefined. Using fallback.');
    return fallbackRes(opts.query);
  }

  try {
    console.log('🤖 Calling Gemini AI with query:', opts.query.slice(0, 100));
    const genPromise = (localModel as any).generateContent(inputPrompt);
    const toPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
    const result = (await Promise.race([genPromise, toPromise])) as any;
    const response = await result.response;
    const text = response.text();
    console.log('✅ Received response from Gemini:', text.slice(0, 100));
    
    let parsed: any;
    try {
      parsed = parseJson(text);
    } catch (parseErr) {
      console.error('❌ Failed to parse Gemini response as JSON:', parseErr);
      console.log('Raw response:', text);
      // If parsing fails, try to create a valid response from the raw text
      parsed = {
        answer: text.slice(0, 2000) || 'Unable to process response',
        explanation: 'Response parsing encountered an issue.',
        calculations: [],
        sources: [],
      };
    }
    resetBreaker();
    const ans: QAResult = {
      answer: String(parsed.answer || '').slice(0, 4000) || 'No answer',
      explanation: parsed.explanation ? String(parsed.explanation).slice(0, 4000) : undefined,
      calculations: Array.isArray(parsed.calculations) ? parsed.calculations.slice(0, 50) : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 20).map(String) : [],
      meta: { model: mdl, tokensEstimate: estimateTokens(inputPrompt + text), fallback: false },
    };
    return ans;
  } catch (err) {
    console.error('❌ Error calling Gemini AI:', err instanceof Error ? err.message : String(err));
    if ((err as any)?.status === 404) {
      console.error('⚠️ Model not found (404). Possible causes:');
      console.error('   1. GEMINI_API_KEY is invalid or expired');
      console.error('   2. API key lacks generative model permissions');
      console.error('   💡 Check: https://aistudio.google.com/app/apikey');
    }
    recordFailure();
    return fallbackRes(opts.query);
  }
}

export function getBreakerState() {
  return { failures: breaker.failures.length, openUntil: breaker.openUntil };
}

export function __setModel(m: any) {
  localModel = m;
}