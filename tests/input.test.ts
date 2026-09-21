import { describe, expect, it } from 'vitest';
import {
  InputValidationError,
  MAX_INPUT_BYTES,
  parseInput,
} from '../src/input.js';

describe('input boundary', () => {
  it.each([
    null,
    '',
    [],
    {},
    { intention: 'x' },
    { data: 'x' },
    { intention: '  ', data: 'x' },
    { intention: 1, data: 'x' },
    { intention: 'x', data: 'x', threshold: 0.9 },
    { intention: 'x'.repeat(2001), data: 'x' },
  ])('rejects an invalid two-input contract %#', (input) => {
    expect(() => parseInput(input)).toThrow(InputValidationError);
  });

  it.each([
    undefined,
    NaN,
    Infinity,
    1n,
    () => 1,
    Symbol('x'),
    new Date(),
    new Uint8Array([1]),
    /test/,
    new Map(),
    Object.assign([], { extra: 'lost' }),
    Array(2),
    { key: undefined },
    JSON.parse('{"__proto__":"silently dropped"}'),
  ])('rejects non-JSON or lossy data %#', (data) => {
    expect(() => parseInput({ intention: 'Test', data })).toThrow(
      InputValidationError,
    );
  });

  it('does not execute getters or serialization hooks', () => {
    let calls = 0;
    const getter = {
      get content() {
        calls++;
        return 'secret';
      },
    };
    class WithHook extends Array<string> {
      toJSON() {
        calls++;
        return ['changed'];
      }
    }
    for (const data of [
      getter,
      new WithHook('secret'),
      {
        toJSON() {
          calls++;
          return 'changed';
        },
      },
    ]) {
      expect(() => parseInput({ intention: 'Test', data })).toThrow(
        InputValidationError,
      );
    }
    expect(calls).toBe(0);
  });

  it('rejects cycles, symbols, non-enumerable properties, excessive depth and size', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    let deep: unknown = 'value';
    for (let i = 0; i < 40; i++) deep = [deep];
    const hidden = Object.defineProperty({}, 'secret', {
      value: 'not serialized',
    });
    for (const data of [
      cyclic,
      deep,
      hidden,
      { [Symbol('s')]: 'hidden' },
      'é'.repeat(MAX_INPUT_BYTES),
    ]) {
      expect(() => parseInput({ intention: 'Test', data })).toThrow(
        InputValidationError,
      );
    }
  });

  it('preserves JSON meaning and allows repeated references without mutating input', () => {
    const shared = { text: 'source', zero: 0, flag: false, empty: null };
    const input = { intention: ' Test ', data: [shared, shared] };
    expect(parseInput(input)).toEqual({
      intention: 'Test',
      data: [shared, shared],
    });
    expect(input.intention).toBe(' Test ');
  });

  it('never includes submitted data in error messages', () => {
    expect(() =>
      parseInput({
        intention: 'Test',
        data: { secret: 'never-print', invalid: undefined },
      }),
    ).toThrow(/^Expected exactly intention/);
  });

  it('rejects proxies before invoking traps or serialization hooks', () => {
    let calls = 0;
    const input = new Proxy(
      { intention: 'Test', data: 'original' },
      {
        get(target, key, receiver) {
          calls++;
          if (key === 'toJSON') return () => target;
          if (key === 'data') return 'x'.repeat(MAX_INPUT_BYTES + 1);
          return Reflect.get(target, key, receiver);
        },
      },
    );
    expect(() => parseInput(input)).toThrow(InputValidationError);
    expect(() => parseInput({ intention: 'Test', data: input })).toThrow(
      InputValidationError,
    );
    expect(calls).toBe(0);
  });
});
