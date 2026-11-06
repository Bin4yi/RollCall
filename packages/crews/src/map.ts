/** The Dawn Map: pure rules, so the same points always light the same tiles. */

export type TileKind = 'meadow' | 'forest' | 'river' | 'lake' | 'hill' | 'pass' | 'coast' | 'lighthouse' | 'village';

export interface Hex {
  q: number;
  r: number;
}

export interface Tile extends Hex {
  kind: TileKind;
}

export const MAP = {
  radius: 4,
  /** Mean points per member needed to light one tile. Means, so a big crew has no built-in edge. */
  pointsPerTile: 2,
  maxTilesPerDay: 3,
  /** How much light a tile loses each day its crew didn't check in. */
  fadePerDay: 0.34,
} as const;

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

const DIRS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const neighbours = (h: Hex): Hex[] => DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));

export const hexDistance = (a: Hex, b: Hex): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/** Where crews start: the six corners of the valley. */
export const HOME_SLOTS: Hex[] = [
  { q: -4, r: 0 },
  { q: 4, r: 0 },
  { q: 0, r: -4 },
  { q: 0, r: 4 },
  { q: 4, r: -4 },
  { q: -4, r: 4 },
];

function kindAt(h: Hex): TileKind {
  const { q, r } = h;
  const s = -q - r;
  if (q === 0 && r === 0) return 'village';
  if (q === 4 && r === -2) return 'lighthouse';
  if (q >= 3 && r <= 0) return 'coast';
  if (Math.abs(q + 1) <= 1 && Math.abs(r - 1) <= 0 && s <= 0) return 'lake';
  if (r === -1 || (r === 0 && q < -1)) return 'river';
  if (r <= -3) return 'pass';
  if (r === -2) return 'hill';
  if ((q + 2 * r) % 3 === 0) return 'forest';
  return 'meadow';
}

/** The valley, always the same: hills, a river, a forest, a lake and a lighthouse coast. */
export function valley(): Tile[] {
  const tiles: Tile[] = [];
  for (let q = -MAP.radius; q <= MAP.radius; q++) {
    for (let r = Math.max(-MAP.radius, -q - MAP.radius); r <= Math.min(MAP.radius, -q + MAP.radius); r++) {
      tiles.push({ q, r, kind: kindAt({ q, r }) });
    }
  }
  return tiles;
}

export interface TileState {
  crewId: string;
  /** 0..1. Fades if the crew stops checking in. */
  light: number;
}

export type MapState = Map<string, TileState>;

export interface CrewDay {
  id: string;
  home: Hex;
  /** Mean points per member today. */
  score: number;
  /** Mean points per member yesterday. Zero means they didn't check in, so their light fades. */
  yesterday: number;
}

export interface DayClaim {
  crewId: string;
  hex: Hex;
  /** Taken from this crew, if anyone. */
  from: string | null;
}

export interface DayResult {
  state: MapState;
  claims: DayClaim[];
}

/**
 * One day's light. Each crew's budget comes from its mean points. A tile next to a crew that's scoring
 * less today is contested, and goes to the crew with more points that day on that frontier. Otherwise
 * light spreads to the nearest unlit tile. Homes are never lost, and consistency beats bursts: a tile
 * only fades after a day with no check-ins, and a burst is capped by the daily maximum.
 */
export function advanceDay(previous: MapState, crews: readonly CrewDay[]): DayResult {
  const state: MapState = new Map([...previous].map(([k, v]) => [k, { ...v }]));
  const tiles = valley();
  const onMap = new Set(tiles.map(hexKey));
  const homes = new Map(crews.map((c) => [hexKey(c.home), c.id]));
  const byId = new Map(crews.map((c) => [c.id, c]));

  for (const c of crews) {
    state.set(hexKey(c.home), { crewId: c.id, light: 1 });
  }
  for (const [key, tile] of [...state]) {
    const owner = byId.get(tile.crewId);
    if (!owner) {
      state.delete(key);
      continue;
    }
    if (owner.yesterday > 0 || homes.has(key)) {
      tile.light = 1;
    } else {
      tile.light = Math.round((tile.light - MAP.fadePerDay) * 100) / 100;
      if (tile.light <= 0) state.delete(key);
    }
  }

  const claims: DayClaim[] = [];
  const order = [...crews].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const budget = new Map(order.map((c) => [c.id, Math.min(MAP.maxTilesPerDay, Math.floor(c.score / MAP.pointsPerTile))]));

  const frontier = (c: CrewDay): { hex: Hex; from: string | null }[] => {
    const seen = new Map<string, { hex: Hex; from: string | null }>();
    for (const [key, tile] of state) {
      if (tile.crewId !== c.id) continue;
      const [q, r] = key.split(',').map(Number) as [number, number];
      for (const n of neighbours({ q, r })) {
        const k = hexKey(n);
        if (!onMap.has(k) || seen.has(k) || homes.has(k)) continue;
        const other = state.get(k);
        if (!other) seen.set(k, { hex: n, from: null });
        else if (other.crewId !== c.id && (byId.get(other.crewId)?.score ?? 0) < c.score) {
          seen.set(k, { hex: n, from: other.crewId });
        }
      }
    }
    return [...seen.values()].sort((a, b) => {
      // Contested tiles first: that's where the day is decided. Then nearest home, in a stable order.
      if ((a.from === null) !== (b.from === null)) return a.from === null ? 1 : -1;
      return hexDistance(a.hex, c.home) - hexDistance(b.hex, c.home) || hexKey(a.hex).localeCompare(hexKey(b.hex));
    });
  };

  let moved = true;
  while (moved) {
    moved = false;
    for (const c of order) {
      const left = budget.get(c.id) ?? 0;
      if (left <= 0) continue;
      const pick = frontier(c)[0];
      budget.set(c.id, left - 1);
      if (!pick) continue;
      state.set(hexKey(pick.hex), { crewId: c.id, light: 1 });
      claims.push({ crewId: c.id, hex: pick.hex, from: pick.from });
      moved = true;
    }
  }
  return { state, claims };
}

export function tileCounts(state: MapState): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of state.values()) out.set(t.crewId, (out.get(t.crewId) ?? 0) + 1);
  return out;
}

/** Tiles a crew could lose or win next: its own or a neighbour's, along a border between two crews. */
export function contestedKeys(state: MapState): Set<string> {
  const out = new Set<string>();
  for (const [key, tile] of state) {
    const [q, r] = key.split(',').map(Number) as [number, number];
    for (const n of neighbours({ q, r })) {
      const other = state.get(hexKey(n));
      if (other && other.crewId !== tile.crewId) out.add(key);
    }
  }
  return out;
}
