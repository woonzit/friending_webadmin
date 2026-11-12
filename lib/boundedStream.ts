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

/** The UTF-8 byte-order mark `Body.text()` drops from the front of a body. */
const UTF8_BOM_BYTES = 3;

/**
 * A request body as `Request.text()` reads it - UTF-8, a leading byte-order
 * mark dropped, an invalid sequence replaced by U+FFFD - or `null` when that
 * text is longer than `limit` UTF-8 bytes, which is the rule every route
 * applied after `text()`. The difference is when it is applied: `text()` held
 * the whole body before anything was counted, so a chunked body without a
 * Content-Length was buffered to its end. Here the body is read through
 * `readBoundedStream` and cancelled as soon as it cannot fit.
 *
 * The decoded text is never shorter than the raw body less a byte-order mark:
 * every invalid sequence of one to three bytes becomes the three bytes of
 * U+FFFD. A body over `limit` + 3 bytes therefore always failed the old count,
 * and is refused unread; anything shorter is decoded and counted exactly as
 * before. Rejects when the body cannot be read, as `text()` does.
 */
export async function readBoundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (body === null) return "";
  const bytes = await readBoundedStream(body, limit + UTF8_BOM_BYTES);
  if (bytes === null) return null;
  const text = new TextDecoder("utf-8").decode(bytes);
  return new TextEncoder().encode(text).byteLength > limit ? null : text;
}

type BodyRequest = { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null };

/**
 * A form body as `Request.formData()` parses it, or `null` once more than
 * `limit` bytes of it have arrived. The parser is the same one - the
 * platform's `formData()`, given the request's own Content-Type - and it is
 * fed the request's chunks as they come, so the memory an upload costs does
 * not change; but past `limit` the feed stops with an error, the request body
 * is cancelled and nothing more of it is read. Rejects, as `formData()` does,
 * on a body that does not parse or cannot be read.
 */
export async function readBoundedFormData(request: BodyRequest, limit: number): Promise<FormData | null> {
  const type = request.headers.get("content-type");
  const reader = request.body?.getReader() ?? null;
  let length = 0, exceeded = false;
  const bounded = reader && new ReadableStream<Uint8Array>({
    async pull(controller) {
      const part = await reader.read();
      if (part.done) { controller.close(); return; }
      length += part.value.byteLength;
      if (length > limit) {
        exceeded = true;
        await reader.cancel().catch(() => undefined);
        controller.error(new RangeError("request body over its limit"));
        return;
      }
      controller.enqueue(part.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  }, { highWaterMark: 0 });
  try {
    return await new Response(bounded, type === null ? undefined : { headers: { "content-type": type } }).formData();
  } catch (error) {
    if (exceeded) return null;
    throw error;
  }
}
