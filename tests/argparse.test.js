import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireValue,
  validateEnum,
  validateRange,
  validatePositiveInt
} from '../src/argparse.js';

// ─── requireValue ──────────────────────────────────────────────────────

test('requireValue returns the next argument value', () => {
  const args = ['--scope', 'user', 'content'];
  const result = requireValue(args, 0, '--scope');
  assert.equal(result, 'user');
});

test('requireValue throws when value is missing (end of array)', () => {
  const args = ['--scope'];
  assert.throws(
    () => requireValue(args, 0, '--scope'),
    { message: '--scope requires a value.' }
  );
});

test('requireValue throws when value looks like another flag', () => {
  const args = ['--scope', '--kind', 'preference'];
  assert.throws(
    () => requireValue(args, 0, '--scope'),
    { message: '--scope requires a value.' }
  );
});

// ─── validateEnum ──────────────────────────────────────────────────────

test('validateEnum returns value when it is in the allowed list', () => {
  const result = validateEnum('markdown', ['markdown', 'json', 'memories'], '--format');
  assert.equal(result, 'markdown');
});

test('validateEnum throws for value not in allowed list', () => {
  assert.throws(
    () => validateEnum('invalid', ['markdown', 'json', 'memories'], '--format'),
    { message: '--format must be one of: markdown, json, memories.' }
  );
});

// ─── validateRange ─────────────────────────────────────────────────────

test('validateRange accepts boundary values 0 and 1', () => {
  assert.equal(validateRange(0, 0, 1, '--confidence'), 0);
  assert.equal(validateRange(1, 0, 1, '--confidence'), 1);
});

test('validateRange throws for value outside range', () => {
  assert.throws(
    () => validateRange(1.5, 0, 1, '--confidence'),
    { message: '--confidence must be between 0 and 1.' }
  );
  assert.throws(
    () => validateRange(-0.1, 0, 1, '--confidence'),
    { message: '--confidence must be between 0 and 1.' }
  );
});

// ─── validatePositiveInt ───────────────────────────────────────────────

test('validatePositiveInt returns the integer for positive integer string', () => {
  const result = validatePositiveInt('10', '--limit');
  assert.equal(result, 10);
  assert.equal(typeof result, 'number');
});

test('validatePositiveInt rejects 0, negative numbers, and floats', () => {
  assert.throws(
    () => validatePositiveInt('0', '--limit'),
    { message: '--limit must be a positive integer.' }
  );
  assert.throws(
    () => validatePositiveInt('-1', '--limit'),
    { message: '--limit must be a positive integer.' }
  );
  assert.throws(
    () => validatePositiveInt('3.5', '--limit'),
    { message: '--limit must be a positive integer.' }
  );
});
