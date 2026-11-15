import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ROOT = join(__dirname, "..");

export interface TestDb {
  pool: pg.Pool;
  drop: () => Promise<void>;
}

/** Creates an isolated database, applies the Supabase shim and all migrations. */
export async function createTestDatabase(): Promise<TestDb> {
  const url = process.env.DATABASE_TEST_URL;
  if (!url) throw new Error("DATABASE_TEST_URL is not set (run `npm run test:db`).");

  const name = `sp_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const dbUrl = new URL(url);
  dbUrl.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: dbUrl.toString(), max: 6 });

  const files = [
    join(ROOT, "tests", "supabase-shim.sql"),
    ...readdirSync(join(ROOT, "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(ROOT, "migrations", f)),
  ];
  for (const file of files) {
    await pool.query(readFileSync(file, "utf8"));
  }

  return {
    pool,
    drop: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

export async function createUser(pool: pg.Pool, email: string, fullName = email.split("@")[0]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName],
  );
  return rows[0].id;
}

type Role = "authenticated" | "anon" | "service_role";

async function withRole<T>(
  pool: pg.Pool,
  role: Role,
  claims: Record<string, unknown>,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs fn as a signed-in Supabase user, exactly as PostgREST would. */
export function asUser<T>(pool: pg.Pool, userId: string, fn: (c: pg.PoolClient) => Promise<T>) {
  return withRole(pool, "authenticated", { sub: userId, role: "authenticated" }, fn);
}
export function asAnon<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>) {
  return withRole(pool, "anon", { role: "anon" }, fn);
}
export function asService<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>) {
  return withRole(pool, "service_role", { role: "service_role" }, fn);
}

/** Convenience: run a single query as a user and return rows. */
export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asUser(pool, userId, async (c) => (await c.query<T>(sql, params)).rows);
}

export function key(prefix = "test"): string {
  return `${prefix}:${randomUUID()}`;
}
