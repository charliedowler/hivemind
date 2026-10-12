import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { HiveUnavailableError } from "../errors";

const state = globalThis as typeof globalThis & { hiveSql?: ReturnType<typeof postgres> };

export function getSql() {
  if (!process.env.DATABASE_URL) throw new HiveUnavailableError();
  state.hiveSql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 3 });
  return state.hiveSql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}

let embeddingColumn: Promise<boolean> | undefined;
export function hasEmbeddingColumn(): Promise<boolean> {
  embeddingColumn ??= getSql()`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'learnings' AND column_name = 'embedding') AS present`.then((rows) => Boolean(rows[0].present));
  return embeddingColumn;
}
