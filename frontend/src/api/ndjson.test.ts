import { describe, expect, it } from 'vitest';
import { consumeNdjsonStream } from './ndjson';

function buildNdjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

describe('consumeNdjsonStream', () => {
  it('parses a trailing result line without a final newline', async () => {
    const progressEvents: Array<{ type: 'progress'; pct: number }> = [];
    const response = buildNdjsonResponse([
      '{"type":"progress","pct":0.4}\n',
      '{"type":"result","data":{"status":"ok"}}',
    ]);

    const result = await consumeNdjsonStream<
      { type: 'progress'; pct: number },
      { status: string }
    >(
      response,
      (event) => progressEvents.push(event),
      'Missing result',
    );

    expect(progressEvents).toEqual([{ type: 'progress', pct: 0.4 }]);
    expect(result).toEqual({ status: 'ok' });
  });

  it('surfaces stream error events', async () => {
    const response = buildNdjsonResponse([
      '{"type":"error","message":"backend failed"}',
    ]);

    await expect(
      consumeNdjsonStream(response, () => undefined, 'Missing result'),
    ).rejects.toThrow('backend failed');
  });
});
