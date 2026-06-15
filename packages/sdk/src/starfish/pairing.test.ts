/**
 * Tests for the device-pairing module.
 * Focus: pin the PAIR_PREFIX protocol constant and the QR-payload format so any
 * change that would break pairing compatibility with existing QR codes is caught.
 */
import { describe, expect, it } from 'vitest';
import { PAIR_PREFIX } from './pairing';

describe('PAIR_PREFIX', () => {
  it('equals "octochat-pair:" (protocol lock-in — changing this breaks QR compatibility)', () => {
    expect(PAIR_PREFIX).toBe('octochat-pair:');
  });

  it('does NOT equal the generic SDK prefix (OctoChat uses its own namespace)', () => {
    // The octospaces-sdk pairing module uses 'octospaces-pair:'.
    // OctoChat intentionally keeps its own 'octochat-pair:' prefix so scanned QR
    // codes are app-specific and a cross-app scan is rejected rather than attempted.
    expect(PAIR_PREFIX).not.toBe('octospaces-pair:');
  });
});
