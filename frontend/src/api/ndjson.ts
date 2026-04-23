interface NdjsonProgressEvent {
  type: 'progress';
}

interface NdjsonResultEvent<TResult> {
  type: 'result';
  data: TResult;
}

interface NdjsonErrorEvent {
  type: 'error';
  message?: string;
}

type NdjsonEvent<TProgress extends NdjsonProgressEvent, TResult> =
  | TProgress
  | NdjsonResultEvent<TResult>
  | NdjsonErrorEvent;

export async function consumeNdjsonStream<
  TProgress extends NdjsonProgressEvent,
  TResult,
>(
  response: Response,
  onProgress: (event: TProgress) => void,
  missingResultMessage: string,
): Promise<TResult> {
  if (!response.body) {
    throw new Error('No response body received from stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: TResult | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;

    const event = JSON.parse(line) as NdjsonEvent<TProgress, TResult>;
    if (event.type === 'progress') {
      onProgress(event);
      return;
    }
    if (event.type === 'result') {
      result = event.data;
      return;
    }
    if (event.type === 'error') {
      throw new Error(event.message ?? 'Stream request failed');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      handleLine(line);
    }

    if (done) {
      break;
    }
  }

  handleLine(buffer);

  if (result === null) {
    throw new Error(missingResultMessage);
  }
  return result;
}
