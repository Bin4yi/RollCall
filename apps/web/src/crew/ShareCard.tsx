import type { Recap } from '../api';
import { ASSETS } from '../assets.gen';

const load = (id: keyof typeof ASSETS): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `/assets/${ASSETS[id].file}@2x.webp`;
  });

const contain = (g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void => {
  const s = Math.min(w / img.width, h / img.height);
  g.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
};

function backdrop(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2B2A6B');
  sky.addColorStop(0.6, '#FF6B5B');
  sky.addColorStop(1, '#FFB37A');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  return { canvas, g };
}

const font = (size: number, weight = 700): string => `${weight} ${size}px "Bricolage Grotesque Variable", "Trebuchet MS", sans-serif`;

const plate = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void => {
  g.fillStyle = 'rgba(255,246,233,0.94)';
  g.beginPath();
  g.roundRect(x, y, w, h, 36);
  g.fill();
};

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

/** Decisions and territory only, so sharing a card never shares a reading. */
export async function recapCard(recap: Recap, shape: 'portrait' | 'square'): Promise<string> {
  const w = 1080;
  const h = shape === 'portrait' ? 1350 : 1080;
  const { canvas, g } = backdrop(w, h);
  const [trophy, logo] = await Promise.all([load('trophy'), load('logo_wordmark')]);
  const top = shape === 'portrait' ? 70 : 40;
  contain(g, trophy, w / 2 - 180, top, 360, 360);
  g.fillStyle = '#FFF6E9';
  g.font = font(44, 600);
  g.fillText(`${recap.league} League season`, w / 2, top + 410);
  g.font = font(92, 800);
  g.fillText(recap.crewName, w / 2, top + 510);
  const y = top + 560;
  const cardH = shape === 'portrait' ? 480 : 300;
  plate(g, 80, y, w - 160, cardH);
  g.fillStyle = '#2B2A6B';
  const rows: [string, string][] = [
    ['Finished', `${ORDINAL[recap.rank - 1] ?? recap.rank} of ${recap.crews}`],
    ['Tiles held', String(recap.tiles)],
    ['Best crew streak', `${recap.bestStreak} days`],
  ];
  if (recap.mvp) rows.push(['Most smart calls', `${recap.mvp.name}, ${recap.mvp.smartCalls}`]);
  const gap = cardH / (rows.length + 0.4);
  rows.forEach(([label, value], i) => {
    const ry = y + gap * (i + 0.85);
    g.textAlign = 'left';
    g.font = font(38, 500);
    g.fillText(label, 130, ry);
    g.textAlign = 'right';
    g.font = font(46, 800);
    g.fillText(value, w - 130, ry);
  });
  g.textAlign = 'center';
  contain(g, logo, w / 2 - 130, h - 150, 260, 96);
  return canvas.toDataURL('image/png');
}

export async function restedCard(crewName: string, tile: string): Promise<string> {
  const w = 1080;
  const { canvas, g } = backdrop(w, w);
  const [rollo, logo] = await Promise.all([load('rollo_rested'), load('logo_wordmark')]);
  contain(g, rollo, w / 2 - 300, 80, 600, 500);
  plate(g, 80, 610, w - 160, 280);
  g.fillStyle = '#2B2A6B';
  g.font = font(72, 800);
  g.fillText('Rested and still', w / 2, 710);
  g.fillText('won the tile.', w / 2, 790);
  g.font = font(38, 500);
  g.fillText(`${crewName}, on the ${tile}`, w / 2, 855);
  contain(g, logo, w / 2 - 130, 925, 260, 96);
  return canvas.toDataURL('image/png');
}

export function saveImage(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
