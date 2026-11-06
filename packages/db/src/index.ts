import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { MIGRATIONS } from './schema';
import * as schema from './schema';

export * from './schema';
export * from './read';
export * from './seed';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export async function openDb(url = 'file:./rollcall.db'): Promise<Db> {
  const client = createClient({ url });
  for (const sql of MIGRATIONS) await client.execute(sql);
  return drizzle(client, { schema });
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
