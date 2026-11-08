import { describe, expect, test } from 'bun:test';
import {
  isIndexLikeName,
  KEY_NAME_PATTERN,
  validateKeyName,
} from '../src/features/clientKeys/issueValidation';

const existing = new Set(['Foo', 'mac-pro-m1']);

describe('validateKeyName', () => {
  test('requires a value', () => {
    expect(validateKeyName('', existing)).toBe('required');
  });

  test.each(['has space', 'ünicode', 'a'.repeat(65), ' lead'])('%p is invalid', (name) => {
    expect(validateKeyName(name, existing)).toBe('invalid');
  });

  test.each(['slash/name', '/', 'a/b/c'])('%p contains a path separator', (name) => {
    expect(validateKeyName(name, existing)).toBe('slash');
  });

  test('accepts 64 characters', () => {
    expect(validateKeyName('a'.repeat(64), existing)).toBeNull();
  });

  test.each(['.', '..', '...'])('%p is a dots-only name', (name) => {
    expect(validateKeyName(name, existing)).toBe('dots');
  });

  test.each(['0', '7', '007', '-0', '9223372036854775807'])(
    '%p would be read as a list index',
    (name) => {
      expect(validateKeyName(name, existing)).toBe('numeric');
    }
  );

  test.each(['-1', '1a', '1.0', '1_000', '1e3', '9223372036854775808'])(
    '%p is not an index',
    (name) => {
      expect(validateKeyName(name, existing)).toBeNull();
    }
  );

  test('isIndexLikeName mirrors strconv.Atoi with a non-negative result', () => {
    expect(isIndexLikeName('+3')).toBe(true);
    expect(isIndexLikeName('0')).toBe(true);
    expect(isIndexLikeName('-0')).toBe(true);
    expect(isIndexLikeName('-3')).toBe(false);
    expect(isIndexLikeName(' 3')).toBe(false);
    expect(isIndexLikeName('')).toBe(false);
  });

  test('taken compares exact case only', () => {
    expect(validateKeyName('Foo', existing)).toBe('taken');
    expect(validateKeyName('foo', existing)).toBeNull();
  });

  test('pattern matches the backend regex', () => {
    expect(KEY_NAME_PATTERN.source).toBe('^[A-Za-z0-9._-]{1,64}$');
  });
});
