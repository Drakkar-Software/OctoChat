import { describe, expect, it, vi } from 'vitest';
import { StarfishHttpError } from '@drakkar.software/starfish-client';

import {
  coerceIntakeConfig,
  readIntakeConfig,
  writeIntakeConfig,
  DEFAULT_INTAKE_CONFIG,
  INTAKE_REPLY_MAX,
  type IntakeConfig,
} from './intake-config';
import { spaceIntakePull, spaceIntakePush } from '../starfish/paths';
import type { Session } from '../starfish/identity';

type Pull = ReturnType<typeof vi.fn>;
type Push = ReturnType<typeof vi.fn>;
const makeSession = (pull: Pull, push: Push): Session =>
  ({ userId: 'owner', keys: {}, accountClient: { pull, push } }) as unknown as Session;

describe('coerceIntakeConfig', () => {
  it('returns defaults for non-objects', () => {
    expect(coerceIntakeConfig(undefined)).toEqual(DEFAULT_INTAKE_CONFIG);
    expect(coerceIntakeConfig(null)).toEqual(DEFAULT_INTAKE_CONFIG);
    expect(coerceIntakeConfig('nope')).toEqual(DEFAULT_INTAKE_CONFIG);
  });

  it('passes a valid config through', () => {
    const cfg: IntakeConfig = { mode: 'auto-reply', replyKind: 'ai', replyText: 'hi', enc: false };
    expect(coerceIntakeConfig(cfg)).toEqual(cfg);
  });

  it('falls back per-field on invalid mode/replyKind/replyText', () => {
    expect(coerceIntakeConfig({ mode: 'bogus', replyKind: 'zzz', replyText: 42 })).toEqual(DEFAULT_INTAKE_CONFIG);
  });

  it('clamps replyText to INTAKE_REPLY_MAX', () => {
    const long = 'a'.repeat(INTAKE_REPLY_MAX + 100);
    const out = coerceIntakeConfig({ mode: 'auto-reply', replyKind: 'fixed', replyText: long });
    expect(out.replyText).toHaveLength(INTAKE_REPLY_MAX);
  });
});

describe('readIntakeConfig', () => {
  it('returns the stored config', async () => {
    const pull: Pull = vi.fn(async () => ({
      data: { v: 1, intake: { mode: 'auto-accept', replyKind: 'fixed', replyText: '' } },
      hash: 'h1',
    }));
    const cfg = await readIntakeConfig(makeSession(pull, vi.fn()), 'sp-1');
    expect(pull).toHaveBeenCalledWith(spaceIntakePull('sp-1'));
    expect(cfg.mode).toBe('auto-accept');
  });

  it('defaults to manual when the doc is missing (404)', async () => {
    const pull: Pull = vi.fn(async () => {
      throw new StarfishHttpError(404, 'not found');
    });
    expect(await readIntakeConfig(makeSession(pull, vi.fn()), 'sp-1')).toEqual(DEFAULT_INTAKE_CONFIG);
  });

  it('propagates non-404 errors (offline must NOT read as manual)', async () => {
    const pull: Pull = vi.fn(async () => {
      throw new StarfishHttpError(500, 'boom');
    });
    await expect(readIntakeConfig(makeSession(pull, vi.fn()), 'sp-1')).rejects.toBeInstanceOf(StarfishHttpError);
  });
});

describe('writeIntakeConfig', () => {
  it('pushes the doc to the intake path with the pulled hash (optimistic concurrency)', async () => {
    const pull: Pull = vi.fn(async () => ({ data: undefined, hash: 'h7' }));
    const push: Push = vi.fn(async () => undefined);
    const cfg: IntakeConfig = { mode: 'auto-reply', replyKind: 'fixed', replyText: 'thanks', enc: false };
    await writeIntakeConfig(makeSession(pull, push), 'sp-1', cfg);
    expect(push).toHaveBeenCalledWith(spaceIntakePush('sp-1'), { v: 1, intake: cfg }, 'h7');
  });
});
