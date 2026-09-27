import { describe, expect, it } from 'vitest';
import {
  describeError,
  inputError,
  MindlmError,
  outputError,
  usageError,
} from '../../src/util/errors.js';

describe('MindlmError', () => {
  it('maps codes onto the documented exit codes', () => {
    expect(usageError('bad flag').exitCode).toBe(1);
    expect(inputError('cannot fetch').exitCode).toBe(2);
    expect(outputError('cannot write').exitCode).toBe(2);
    expect(new MindlmError('llm', 'model said no').exitCode).toBe(3);
  });

  it('keeps the hint separate from the message', () => {
    const error = inputError('no text layer', 'run OCR first');
    expect(error.message).toBe('no text layer');
    expect(error.hint).toBe('run OCR first');
  });

  it('preserves a cause', () => {
    const cause = new Error('socket closed');
    expect(new MindlmError('input', 'fetch failed', { cause }).cause).toBe(cause);
  });
});

describe('describeError', () => {
  it('appends the hint for our own errors', () => {
    expect(describeError(inputError('a', 'b'))).toBe('a\n  b');
    expect(describeError(inputError('a'))).toBe('a');
  });

  it('handles plain errors and non-errors', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('just a string')).toBe('just a string');
    expect(describeError(undefined)).toBe('undefined');
  });
});
