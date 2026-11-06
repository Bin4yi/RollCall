interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
}

export interface CaptureStats {
  fps: number;
  dropped: number;
}

/**
 * Captures the webcam in the browser and pushes frames to the sidecar. This is the path that works
 * with built-in webcams on Windows (see docs/SDK_NOTES.md). Needs Chromium's
 * MediaStreamTrackProcessor; Chrome and Edge both have it.
 */
export class FrameCapture {
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  onStats: ((stats: CaptureStats) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  static get supported(): boolean {
    return 'MediaStreamTrackProcessor' in window;
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  async start(url = 'ws://127.0.0.1:8766'): Promise<void> {
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
      .MediaStreamTrackProcessor;
    if (!Processor) throw new Error('This browser cannot read camera frames. Use Chrome or Edge.');

    // Only `ideal`: a hard minimum makes cameras refuse outright. The SDK warns if the rate is low.
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    const track = this.stream.getVideoTracks()[0]!;
    const { readable } = new Processor({ track });

    this.worker = new Worker(new URL('./frameWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        sent?: number;
        dropped?: number;
        message?: string;
      };
      if (data.type === 'stats')
        this.onStats?.({ fps: data.sent ?? 0, dropped: data.dropped ?? 0 });
      if (data.type === 'error') this.onError?.(data.message ?? 'Camera frame error');
    };
    this.worker.postMessage({ type: 'start', readable, url }, [
      readable as unknown as Transferable,
    ]);
  }

  stop(): void {
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
