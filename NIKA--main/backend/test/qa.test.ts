import { describe, it, expect, vi } from 'vitest';
import { generateGeminiAnswer, __setModel } from '../src/services/qa';

describe('generateGeminiAnswer', () => {
  it('returns fallback when not configured', async () => {
    const res = await generateGeminiAnswer({ query: 'test', context: { columns: ['a'], sampleRows: [{ a: 1 }] } });
    expect(res.meta.fallback).toBe(true);
    expect(typeof res.answer).toBe('string');
  });

  it('parses structured JSON when provided', async () => {
    const fake: any = {
      generateContent: vi.fn(async () => ({ response: { text: () => JSON.stringify({ answer: 'ok', explanation: 'e', calculations: [{ k: 1 }], sources: ['s'] }) } }))
    };
    __setModel(fake);
    const res = await generateGeminiAnswer({ query: 'q', context: { columns: [], sampleRows: [] }, config: { timeoutMs: 500 } });
    expect(res.meta.fallback).toBe(false);
    expect(res.answer).toBe('ok');
  });

  it('times out and falls back', async () => {
    const slow: any = { generateContent: vi.fn(async () => new Promise((r) => setTimeout(() => r({ response: { text: () => '{}' } }), 2000))) };
    __setModel(slow);
    const res = await generateGeminiAnswer({ query: 'q', context: { columns: [], sampleRows: [] }, config: { timeoutMs: 100 } });
    expect(res.meta.fallback).toBe(true);
  });
});
