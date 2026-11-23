import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

/** Lazily-created Neon SQL tag, so builds don't need DATABASE_URL. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return db()(strings, ...values) as Promise<Record<string, unknown>[]>;
}

/** Run several statements atomically in one round trip. Build them with the `q` tag (not awaited). */
export async function transaction(build: (q: NeonQueryFunction<false, false>) => ReturnType<NeonQueryFunction<false, false>>[]) {
  const c = db();
  return c.transaction(build(c));
}
