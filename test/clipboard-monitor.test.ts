import assert from 'node:assert/strict';
import test from 'node:test';
import {
  processClipboardOnce,
  type ClipboardTextPort
} from '../src/clipboard-monitor.js';

class InMemoryClipboardTextPort implements ClipboardTextPort {
  text: string;
  readonly reads: Array<string | Error> = [];
  readonly writes: string[] = [];
  writeError: Error | undefined;

  constructor(text: string) {
    this.text = text;
  }

  async readText(): Promise<string> {
    const nextValue = this.reads.shift();
    if (nextValue === undefined) {
      return this.text;
    }
    if (nextValue instanceof Error) {
      throw nextValue;
    }
    this.text = nextValue;
    return nextValue;
  }

  async writeText(text: string): Promise<void> {
    if (this.writeError !== undefined) {
      throw this.writeError;
    }
    this.text = text;
    this.writes.push(text);
  }
}

test('writes one transformed value for a new supported link', async () => {
  const source = 'https://www.instagram.com/p/CODE_123';
  const target = 'https://kkinstagram.com/p/CODE_123';
  const port = new InMemoryClipboardTextPort(source);

  const result = await processClipboardOnce(port, undefined, true);

  assert.equal(result, target);
  assert.deepEqual(port.writes, [target]);
  assert.equal(port.text, target);
});

test('does not write unchanged clipboard text', async () => {
  const source = 'https://www.instagram.com/p/CODE_123';
  const port = new InMemoryClipboardTextPort(source);

  const result = await processClipboardOnce(port, source, true);

  assert.equal(result, source);
  assert.deepEqual(port.writes, []);
});

test('does not write while paused', async () => {
  const source = 'https://www.instagram.com/p/CODE_123';
  const port = new InMemoryClipboardTextPort(source);

  const result = await processClipboardOnce(port, undefined, false);

  assert.equal(result, source);
  assert.deepEqual(port.writes, []);
});

test('does not overwrite a newer clipboard value and retries it next pass', async () => {
  const firstValue = 'https://www.instagram.com/p/CODE_123';
  const newerValue = 'https://x.com/example/status/1234567890';
  const port = new InMemoryClipboardTextPort(firstValue);
  port.reads.push(firstValue, newerValue);

  const racedState = await processClipboardOnce(port, 'previous value', true);

  assert.equal(racedState, firstValue);
  assert.deepEqual(port.writes, []);
  assert.equal(port.text, newerValue);

  const retriedValue = await processClipboardOnce(port, racedState, true);

  assert.equal(retriedValue, 'https://fixupx.com/example/status/1234567890');
  assert.deepEqual(port.writes, ['https://fixupx.com/example/status/1234567890']);
});

test('retains previous state after the first read fails', async () => {
  const previousValue = 'previous value';
  const port = new InMemoryClipboardTextPort('current value');
  port.reads.push(new Error('read failed'));

  const result = await processClipboardOnce(port, previousValue, true);

  assert.equal(result, previousValue);
});

test('retains previous state after the race-check read fails', async () => {
  const previousValue = 'previous value';
  const source = 'https://www.instagram.com/p/CODE_123';
  const port = new InMemoryClipboardTextPort(source);
  port.reads.push(source, new Error('race read failed'));

  const result = await processClipboardOnce(port, previousValue, true);

  assert.equal(result, previousValue);
  assert.deepEqual(port.writes, []);
});

test('retains previous state after a write fails', async () => {
  const previousValue = 'previous value';
  const source = 'https://www.instagram.com/p/CODE_123';
  const port = new InMemoryClipboardTextPort(source);
  port.writeError = new Error('write failed');

  const result = await processClipboardOnce(port, previousValue, true);

  assert.equal(result, previousValue);
  assert.deepEqual(port.writes, []);
  assert.equal(port.text, source);
});
