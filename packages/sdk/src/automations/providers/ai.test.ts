import { describe, expect, it, vi } from 'vitest';

import { aiProvider, clampSteps, parseAgentStep } from './ai';
import type { LlmAdapter } from '../../ai/engine-port';
import type { RunCtx, RunResult } from '../types';

/** A RunCtx whose `llm` returns the queued outputs in order (one per call). */
function ctx(over: Partial<RunCtx> = {}): RunCtx {
  return {
    lastRunAt: null,
    secretParams: {},
    httpFetch: (async () => new Response('', { status: 200 })) as typeof fetch,
    ...over,
  };
}

/** Build an `llm` stub that yields `outputs[i]` on the i-th call. */
function scriptedLlm(...outputs: string[]): LlmAdapter {
  let i = 0;
  return vi.fn(async () => outputs[Math.min(i++, outputs.length - 1)]);
}

describe('parseAgentStep', () => {
  it('parses GET / POST / FINAL', () => {
    expect(parseAgentStep('GET https://x.test/a')).toEqual({ kind: 'get', url: 'https://x.test/a' });
    expect(parseAgentStep('POST https://x.test/a {"k":1}')).toEqual({ kind: 'post', url: 'https://x.test/a', body: '{"k":1}' });
    expect(parseAgentStep('FINAL all good')).toEqual({ kind: 'final', text: 'all good' });
  });
  it('keeps a multi-line FINAL body', () => {
    expect(parseAgentStep('FINAL line one\nline two')).toEqual({ kind: 'final', text: 'line one\nline two' });
  });
  it('finds the directive after leading reasoning', () => {
    expect(parseAgentStep('Let me check.\nGET https://x.test/a')).toEqual({ kind: 'get', url: 'https://x.test/a' });
  });
  it('treats keyword-free output as the final answer', () => {
    expect(parseAgentStep('just a plain reply')).toEqual({ kind: 'final', text: 'just a plain reply' });
  });
  it('returns none for empty output', () => {
    expect(parseAgentStep('   ')).toEqual({ kind: 'none' });
  });
});

describe('clampSteps', () => {
  it('defaults junk and clamps to 1..6', () => {
    expect(clampSteps(undefined)).toBe(3);
    expect(clampSteps('nope')).toBe(3);
    expect(clampSteps(0)).toBe(3);
    expect(clampSteps(2)).toBe(2);
    expect(clampSteps(99)).toBe(6);
    expect(clampSteps('4')).toBe(4);
  });
});

describe('ai provider', () => {
  it('posts a direct FINAL answer without any tool call', async () => {
    const llm = scriptedLlm('FINAL hello team');
    const r = (await aiProvider.onCommand!('ai', ['say', 'hi'], {}, ctx({ llm }))) as { text: string };
    expect(r.text).toBe('hello team');
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('runs a GET tool then posts the FINAL synthesis', async () => {
    const httpFetch = vi.fn(async () => new Response('OK status: green', { status: 200 })) as unknown as typeof fetch;
    const llm = scriptedLlm('GET https://x.test/health', 'FINAL all systems green');
    const r = (await aiProvider.fetch!({ instruction: 'check health' }, ctx({ llm, httpFetch }))) as { text: string };
    expect(httpFetch).toHaveBeenCalledWith('https://x.test/health');
    expect(r.text).toBe('all systems green');
  });

  it('feeds the http error back as an observation rather than throwing', async () => {
    const httpFetch = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const llm = scriptedLlm('GET https://x.test/down', 'FINAL endpoint is unreachable');
    const r = (await aiProvider.fetch!({ instruction: 'check' }, ctx({ llm, httpFetch }))) as { text: string };
    expect(r.text).toBe('endpoint is unreachable');
  });

  it('forces a tool-free synthesis when the step budget is exhausted', async () => {
    const httpFetch = vi.fn(async () => new Response('data', { status: 200 })) as unknown as typeof fetch;
    // Always asks for a tool; maxSteps=1 → one tool turn, then a forced final turn.
    const llm = vi.fn(async (_m, opts) => (opts?.systemPrompt?.includes('final message') ? 'forced answer' : 'GET https://x.test/a'));
    const r = (await aiProvider.fetch!({ instruction: 'loop', maxSteps: 1 }, ctx({ llm: llm as LlmAdapter, httpFetch }))) as { text: string };
    expect(r.text).toBe('forced answer');
  });

  it('skips a scheduled run with no instruction', async () => {
    const r = (await aiProvider.fetch!({}, ctx({ llm: scriptedLlm('FINAL x') }))) as RunResult;
    expect(r).toEqual({ skip: true });
  });

  it('hints usage on a bare /ai', async () => {
    const r = (await aiProvider.onCommand!('ai', [], {}, ctx({ llm: scriptedLlm('FINAL x') }))) as { text: string };
    expect(r.text).toMatch(/Usage/);
  });

  it('reports gracefully when no model is wired', async () => {
    const r = (await aiProvider.onCommand!('ai', ['hi'], {}, ctx())) as { text: string };
    expect(r.text).toMatch(/not available on this device/i);
  });
});
