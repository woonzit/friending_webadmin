/**
 * A stream's bytes while they fit in `limit`, or `null`: the stream is longer
 * (the rest is never read) or the caller gave up. The one bounded reader of
 * the console's private bridges - a request body a route has to bound itself,
 * and private media Core serves - so that neither trusts a declared length.
 * A stream that fails while it is read rejects, as its reader does.
 */
export async function readBoundedStream(stream: ReadableStream<Uint8Array>, limit: number, signal?: AbortSignal): Promise<Uint8Array | null> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit || signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
