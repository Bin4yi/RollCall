import { Assets, Rectangle, Texture } from 'pixi.js';
import { emptyManifest, pickedFile, placeholderColor, type Manifest } from './manifest';

const BASE = '/hush-assets/';

/**
 * Loads the art pack from the manifest. Any id that's missing or fails gets a labelled placeholder,
 * so the game always runs, even with no art at all.
 */
export class AssetRegistry {
  private manifest: Manifest = emptyManifest();
  private textures = new Map<string, Texture>();

  async init(): Promise<void> {
    try {
      const res = await fetch(`${BASE}manifest.json`);
      if (res.ok) this.manifest = (await res.json()) as Manifest;
    } catch {
      /* Placeholders it is. */
    }
  }

  /** URL for DOM use, or null to let the caller show a placeholder. */
  url(id: string): string | null {
    const file = pickedFile(this.manifest, id);
    return file ? BASE + file : null;
  }

  /** First existing id, for art that may not have been generated yet. */
  firstUrl(...ids: string[]): string | null {
    for (const id of ids) {
      const url = this.url(id);
      if (url) return url;
    }
    return null;
  }

  async preload(ids: string[], onProgress?: (share: number) => void): Promise<void> {
    let done = 0;
    await Promise.all(
      ids.map(async (id) => {
        await this.load(id);
        onProgress?.(++done / ids.length);
      }),
    );
  }

  async load(id: string): Promise<Texture> {
    const cached = this.textures.get(id);
    if (cached) return cached;
    const url = this.url(id);
    let texture: Texture | null = null;
    if (url) {
      try {
        texture = (await Assets.load<Texture>(url)) ?? null;
      } catch {
        texture = null;
      }
    }
    texture ??= this.placeholder(id);
    this.textures.set(id, texture);
    return texture;
  }

  /** Synchronous lookup for things already preloaded. */
  get(id: string): Texture {
    let texture = this.textures.get(id);
    if (!texture) {
      texture = this.placeholder(id);
      this.textures.set(id, texture);
    }
    return texture;
  }

  /** True if real art exists, as opposed to a placeholder. */
  has(id: string): boolean {
    return this.url(id) !== null;
  }

  /** Slices the frames of a horizontal/grid sprite sheet, or nothing if it's unavailable. */
  async frames(name: string): Promise<Texture[]> {
    const anim = this.manifest.animations[name];
    if (!anim?.sheet) return [];
    try {
      const sheet = await Assets.load<Texture>(BASE + anim.sheet);
      const cols = Math.max(1, Math.floor(sheet.width / anim.frameWidth));
      const out: Texture[] = [];
      for (let i = 0; i < anim.frameCount; i++) {
        const x = (i % cols) * anim.frameWidth;
        const y = Math.floor(i / cols) * anim.frameHeight;
        if (y + anim.frameHeight > sheet.height) break;
        out.push(
          new Texture({
            source: sheet.source,
            frame: new Rectangle(x, y, anim.frameWidth, anim.frameHeight),
          }),
        );
      }
      return out;
    } catch {
      return [];
    }
  }

  private placeholder(id: string): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    const g = canvas.getContext('2d')!;
    g.fillStyle = placeholderColor(id);
    g.fillRect(0, 0, 480, 320);
    g.strokeStyle = '#cffaf4';
    g.strokeRect(4, 4, 472, 312);
    g.fillStyle = '#cffaf4';
    g.font = '24px monospace';
    g.textAlign = 'center';
    g.fillText(id, 240, 165);
    return Texture.from(canvas);
  }
}
