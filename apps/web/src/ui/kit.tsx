import { useState, type CSSProperties, type ReactNode } from 'react';
import { ASSETS } from '../assets.gen';

export type AssetId = keyof typeof ASSETS;

/** A code-drawn stand-in, so the app still looks right if an image fails to load. */
function Fallback({ alt, style, className }: { alt: string; style?: CSSProperties; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={!alt} style={style} className={className}>
      <circle cx="50" cy="58" r="30" fill="#FFB37A" stroke="#2B2A6B" strokeWidth="4" />
      <path d="M36 28l8-14 6 12 6-12 8 14" fill="#FF6B5B" stroke="#2B2A6B" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

export function Art({
  id,
  className,
  style,
  alt,
  eager,
}: {
  id: AssetId;
  className?: string;
  style?: CSSProperties;
  /** Overrides the catalogue's alt text. Pass "" for purely decorative art. */
  alt?: string;
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const asset = ASSETS[id];
  const label = alt ?? asset?.alt ?? '';
  if (!asset || broken) return <Fallback alt={label} className={className} style={style} />;
  return (
    <img
      src={`/assets/${asset.file}.webp`}
      srcSet={`/assets/${asset.file}.webp 1x, /assets/${asset.file}@2x.webp 2x`}
      width={asset.width}
      height={asset.height}
      alt={label}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setBroken(true)}
      className={className}
      style={{ height: 'auto', ...style }}
    />
  );
}

/** Avatars come from the demo art; a real athlete gets their initial on a dawn colour. */
export function Avatar({ name, avatar, size = 48 }: { name: string; avatar: string | null; size?: number }) {
  if (avatar && avatar in ASSETS) {
    return <Art id={avatar as AssetId} alt="" className="shrink-0 rounded-full" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-indigo bg-apricot font-display font-bold text-indigo"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return <Art id="logo_wordmark" alt="Roll Call" className={className} eager />;
}

/** The mark: the sun rising over a heartbeat horizon. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M10 30a14 14 0 0 1 28 0Z" fill="#FF6B5B" />
      <path d="M3 30h13l3-6 4 12 4-16 3 10h15" fill="none" stroke="#2B2A6B" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Rollo's six-frame wave. Reduced motion holds it still, through the global rule in style.css. */
export function RolloWave({ size = 150 }: { size?: number }) {
  return <div className="wave-sprite mx-auto" style={{ '--frame': `${size}px` } as CSSProperties} role="img" aria-label="Rollo waving hello" />;
}

export function DemoBanner({ children }: { children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-indigo px-4 py-2 text-center text-sm font-semibold text-paper">
      <span className="rounded bg-apricot px-2 py-0.5 text-xs font-bold tracking-wide text-ink">DEMO DATA</span>
      <span>Fictional athletes and invented numbers.</span>
      {children}
    </div>
  );
}

export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-sm leading-relaxed text-mute ${className}`}>
      Roll Call is not a medical device. Readings are wellness estimates to help with training decisions. For adults 18+. The coach makes every decision.
    </p>
  );
}

export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 ${className}`}>{children}</main>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 text-mute">
      <LogoMark size={48} />
      <span>{label}…</span>
    </div>
  );
}

export function Problem({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center">
      <Art id="rollo_offline" alt="" className="w-36" eager />
      <h1 className="text-2xl">{title}</h1>
      {children}
    </div>
  );
}
