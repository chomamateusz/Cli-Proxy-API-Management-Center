import { describe, expect, test } from 'bun:test';
import { DEFAULT_TTL, TTL_PRESETS, parseTtl, previewExpiry } from '../src/features/clientKeys/ttl';

describe('parseTtl', () => {
  test.each([
    ['24h', '86400s'],
    ['1.5h', '5400s'],
    ['90m', '5400s'],
    ['1h30m', '5400s'],
    ['2d', '172800s'],
    ['1w', '604800s'],
    [' 8760h ', '31536000s'],
    ['1m', '60s'],
    ['60000ms', '60s'],
  ])('%p -> %p', (input, ttl) => {
    expect(parseTtl(input)).toMatchObject({ ok: true, ttl });
  });

  test('empty input', () => {
    expect(parseTtl('')).toEqual({ ok: false, error: 'empty' });
    expect(parseTtl('   ')).toEqual({ ok: false, error: 'empty' });
  });

  test.each(['-1h', 'abc', '1x', 'h', '1h 30m', '+1h', '1.h', '.5h'])('%p is invalid', (input) => {
    expect(parseTtl(input)).toEqual({ ok: false, error: 'invalid' });
  });

  test.each(['0h', '30s', '59s'])('%p is too short', (input) => {
    expect(parseTtl(input)).toEqual({ ok: false, error: 'too_short' });
  });

  test('more than ten years is too long', () => {
    expect(parseTtl('87601h')).toEqual({ ok: false, error: 'too_long' });
    expect(parseTtl('87600h')).toMatchObject({ ok: true });
  });

  test('every preset parses and the default is one year', () => {
    for (const preset of TTL_PRESETS) expect(parseTtl(preset.value).ok).toBe(true);
    expect(DEFAULT_TTL).toBe('8760h');
  });
});

test('previewExpiry adds the duration to now', () => {
  expect(previewExpiry(3_600_000, 1_000)).toBe(3_601_000);
});
