/** Rollo's farm grows with check-ins and smart calls. It never shrinks. */
export const BUILDINGS = ['coop', 'patch', 'track', 'barn', 'windmill', 'lighthouse'] as const;
export type Building = (typeof BUILDINGS)[number];

export const BUILDING_WORDS: Record<Building, string> = {
  coop: 'Coop',
  patch: 'Vegetable patch',
  track: 'Running track',
  barn: 'Barn',
  windmill: 'Windmill',
  lighthouse: 'Lighthouse',
};

/** Growth needed for each building. */
export const BUILDING_AT = [1, 8, 20, 35, 55, 80] as const;

/** A check-in day is worth one growth, a smart call two. */
export const campGrowth = (checkins: number, smartCalls: number): number => checkins + smartCalls * 2;

/** Buildings earned so far, 0..6. */
export function campStage(growth: number): number {
  return BUILDING_AT.filter((need) => growth >= need).length;
}

/** The stored stage only ever goes up, even if data behind the growth changes. */
export const nextStage = (stored: number, growth: number): number => Math.max(stored, campStage(growth));

export function nextBuilding(stage: number, growth: number): { name: Building; left: number } | null {
  const name = BUILDINGS[stage];
  const need = BUILDING_AT[stage];
  return name && need !== undefined ? { name, left: Math.max(0, need - growth) } : null;
}
