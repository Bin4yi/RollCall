import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { MIGRATIONS } from './schema';
import * as baseSchema from './schema';
import { GAME_MIGRATIONS } from './schema-game';
import * as gameSchema from './schema-game';

const schema = { ...baseSchema, ...gameSchema };

export * from './schema';
export * from './schema-game';
export * from './read';
export * from './seed';
export * from './game';
export * from './seed-game';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export async function openDb(url = 'file:./rollcall.db'): Promise<Db> {
  const client = createClient({ url });
  for (const sql of [...MIGRATIONS, ...GAME_MIGRATIONS]) await client.execute(sql);
  return drizzle(client, { schema });
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
