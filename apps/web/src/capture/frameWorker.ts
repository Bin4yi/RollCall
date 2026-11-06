/// <reference lib="webworker" />
/**
 * Runs off the main thread, so the game's rendering can't drop the camera under the SDK's 25 fps
 * floor. Reads VideoFrames and pushes them to the sidecar's frame socket. Header layout mirrors
 * apps/sidecar/src/protocol.ts. PixelFormat values come from the SDK API reference.
 */
const HEADER = 24;
const NV12 = 4;
const RGBA = 2;
const BGRA = 3;
/** Drop rather than queue when the socket falls behind. Late frames are worthless. */
const MAX_BUFFERED_BYTES = 8_000_000;

interface StartMessage {
  type: 'start';
  readable: ReadableStream<VideoFrame>;
  url: string;
}

let running = false;
let socket: WebSocket | null = null;
let sent = 0;
let dropped = 0;

const connect = (url: string): void => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    socket = ws;
    self.postMessage({ type: 'connected' });
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (running) setTimeout(() => connect(url), 1000);
  };
  ws.onerror = () => ws.close();
};

function header(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  stride: number,
  format: number,
  ts: number,
): void {
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  view.setUint32(8, stride, true);
  view.setUint32(12, format, true);
  view.setFloat64(16, ts, true);
}

async function encode(frame: VideoFrame): Promise<ArrayBuffer> {
  const width = frame.visibleRect?.width ?? frame.codedWidth;
  const height = frame.visibleRect?.height ?? frame.codedHeight;
  const ts = frame.timestamp;

  if (frame.format === 'NV12') {
    const size = width * height + width * Math.ceil(height / 2);
    const buffer = new ArrayBuffer(HEADER + size);
    await frame.copyTo(new Uint8Array(buffer, HEADER), {
      layout: [
        { offset: 0, stride: width },
        { offset: width * height, stride: width },
      ],
    });
    header(buffer, width, height, width, NV12, ts);
    return buffer;
  }

  if (frame.format === 'I420') {
    // The SDK has no I420 input, but interleaving the chroma planes gives NV12 cheaply.
    const chromaW = Math.ceil(width / 2);
    const chromaH = Math.ceil(height / 2);
    const planar = new Uint8Array(width * height + 2 * chromaW * chromaH);
    await frame.copyTo(planar, {
      layout: [
        { offset: 0, stride: width },
        { offset: width * height, stride: chromaW },
        { offset: width * height + chromaW * chromaH, stride: chromaW },
      ],
    });
    const buffer = new ArrayBuffer(HEADER + width * height + width * chromaH);
    const out = new Uint8Array(buffer, HEADER);
    out.set(planar.subarray(0, width * height));
    const uStart = width * height;
    const vStart = uStart + chromaW * chromaH;
    let o = uStart;
    for (let i = 0; i < chromaW * chromaH; i++) {
      out[o++] = planar[uStart + i]!;
      out[o++] = planar[vStart + i]!;
    }
    header(buffer, width, height, width, NV12, ts);
    return buffer;
  }

  if (
    frame.format === 'RGBA' ||
    frame.format === 'RGBX' ||
    frame.format === 'BGRA' ||
    frame.format === 'BGRX'
  ) {
    const buffer = new ArrayBuffer(HEADER + width * height * 4);
    await frame.copyTo(new Uint8Array(buffer, HEADER), {
      layout: [{ offset: 0, stride: width * 4 }],
    });
    const format = frame.format.startsWith('RGB') ? RGBA : BGRA;
    header(buffer, width, height, width * 4, format, ts);
    return buffer;
  }

  // Anything else: let the browser convert it.
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(frame, 0, 0);
  const pixels = g.getImageData(0, 0, width, height).data;
  const buffer = new ArrayBuffer(HEADER + pixels.length);
  new Uint8Array(buffer, HEADER).set(pixels);
  header(buffer, width, height, width * 4, RGBA, ts);
  return buffer;
}

async function pump(readable: ReadableStream<VideoFrame>): Promise<void> {
  const reader = readable.getReader();
  while (running) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) break;
    try {
      if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) {
        socket.send(await encode(frame));
        sent++;
      } else {
        dropped++;
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: (err as Error).message });
    } finally {
      frame.close();
    }
  }
  await reader.cancel().catch(() => undefined);
}

setInterval(() => {
  self.postMessage({ type: 'stats', sent, dropped });
  sent = 0;
  dropped = 0;
}, 1000);

self.onmessage = (event: MessageEvent<StartMessage | { type: 'stop' }>) => {
  if (event.data.type === 'start') {
    running = true;
    connect(event.data.url);
    void pump(event.data.readable);
  } else {
    running = false;
    socket?.close();
  }
};
