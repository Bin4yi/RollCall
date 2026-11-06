interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
}

export interface CaptureStats {
  fps: number;
  dropped: number;
}

const HEADER = 24;
const JPEG_FORMAT = 100;
const JPEG_QUALITY = 0.85;
const MAX_BUFFERED_BYTES = 4_000_000;

/**
 * On this computer the server is one hop away, so uncompressed frames are fine. Anywhere else, 30 raw
 * frames a second would swamp Wi-Fi, so frames are JPEGs. See docs/DECISIONS.md.
 */
export const isLocalServer = (host = location.hostname): boolean =>
  host === 'localhost' || host === '127.0.0.1';

/**
 * Captures the camera and pushes frames to the server, which hands them to the SDK and discards them.
 * The SDK asks for at least ~25 fps, so 30 is requested. Chromium uses a Web Worker; Safari has no
 * MediaStreamTrackProcessor, so there it falls back to a canvas on the main thread.
 */
export class FrameCapture {
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private socket: WebSocket | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private sent = 0;
  private dropped = 0;
  private statsTimer = 0;
  onStats: ((stats: CaptureStats) => void) | null = null;

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  async start(url: string, encoding?: 'raw' | 'jpeg'): Promise<void> {
    const local = isLocalServer();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: local ? 1280 : 640 },
        height: { ideal: local ? 720 : 480 },
        // Only `ideal`: a hard minimum makes cameras refuse outright. The SDK warns if the rate is low.
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    this.running = true;
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
      .MediaStreamTrackProcessor;
    if (Processor) this.startWorker(Processor, url, encoding ?? (local ? 'raw' : 'jpeg'));
    else await this.startCanvas(url);
  }

  private startWorker(Processor: TrackProcessorCtor, url: string, encoding: 'raw' | 'jpeg'): void {
    const track = this.stream!.getVideoTracks()[0]!;
    const { readable } = new Processor({ track });
    this.worker = new Worker(new URL('./frameWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; sent?: number; dropped?: number };
      if (data.type === 'stats') this.onStats?.({ fps: data.sent ?? 0, dropped: data.dropped ?? 0 });
    };
    this.worker.postMessage({ type: 'start', readable, url, encoding }, [
      readable as unknown as Transferable,
    ]);
  }

  private async startCanvas(url: string): Promise<void> {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = this.stream;
    this.video = video;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const g = canvas.getContext('2d')!;
    let encoding = false;

    const capture = (): void => {
      if (socket.readyState !== WebSocket.OPEN || encoding || socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        this.dropped++;
        return;
      }
      encoding = true;
      const ts = performance.now() * 1000;
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          encoding = false;
          if (!blob || socket.readyState !== WebSocket.OPEN) return;
          void blob.arrayBuffer().then((body) => {
            const out = new ArrayBuffer(HEADER + body.byteLength);
            const view = new DataView(out);
            view.setUint32(0, canvas.width, true);
            view.setUint32(4, canvas.height, true);
            view.setUint32(8, 0, true);
            view.setUint32(12, JPEG_FORMAT, true);
            view.setFloat64(16, ts, true);
            new Uint8Array(out, HEADER).set(new Uint8Array(body));
            if (socket.readyState === WebSocket.OPEN) socket.send(out);
            this.sent++;
          });
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    };

    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const loop = (): void => {
      if (!this.running) return;
      capture();
      if (withCallback.requestVideoFrameCallback) withCallback.requestVideoFrameCallback(loop);
      else window.setTimeout(loop, 33);
    };
    loop();
    this.statsTimer = window.setInterval(() => {
      this.onStats?.({ fps: this.sent, dropped: this.dropped });
      this.sent = 0;
      this.dropped = 0;
    }, 1000);
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.statsTimer);
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.socket?.close();
    this.socket = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
