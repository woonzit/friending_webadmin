/**
 * Request bodies as Next hands them to a route handler: a stream of byte chunks, read only when the route
 * pulls (high-water mark 0, as a socket that is not read is not drained). `state` tells what the route took.
 */
export type BodyState = { pulled: number; reads: number; cancelled: boolean };

/** `content` in chunks of `chunk` bytes; `onRead` runs before the first chunk is handed over. */
export function requestBody(content: string | Uint8Array, options: { chunk?: number; onRead?: () => void } = {}) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const chunk = options.chunk ?? 64 * 1024, state: BodyState = { pulled: 0, reads: 0, cancelled: false };
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.reads++ === 0) options.onRead?.();
      if (offset >= bytes.byteLength) { controller.close(); return; }
      const part = bytes.slice(offset, offset + chunk);
      offset += part.byteLength; state.pulled += part.byteLength;
      controller.enqueue(part);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, state };
}

/**
 * A chunked upload with no Content-Length of `total` bytes (spaces by default), produced only as it is
 * pulled - the shape of the audit's probe, without holding it in the test either.
 */
export function chunkedBody(total: number, options: { chunk?: number; fill?: number; prefix?: Uint8Array } = {}) {
  const chunk = options.chunk ?? 64 * 1024, state: BodyState = { pulled: 0, reads: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.reads++;
      if (state.pulled >= total) { controller.close(); return; }
      // A form upload starts with its part's headers; what follows is the file, and it does not end.
      if (state.pulled === 0 && options.prefix) { state.pulled += options.prefix.byteLength; controller.enqueue(options.prefix.slice()); return; }
      const size = Math.min(chunk, total - state.pulled);
      state.pulled += size;
      controller.enqueue(new Uint8Array(size).fill(options.fill ?? 0x20));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, state };
}
