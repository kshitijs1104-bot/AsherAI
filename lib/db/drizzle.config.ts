import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Paths are relative and POSIX-style, not built with path.join(__dirname, …).
// drizzle-kit treats `schema` as a GLOB, and on Windows path.join produces
// backslashes, which its matcher reads as escape characters — so the absolute
// form failed with "No schema files found" against a file that was plainly
// there. Relative paths resolve against the config file's own directory, which
// is what the package scripts already run from, and they behave identically on
// both platforms.
export default defineConfig({
  schema: "./src/schema/index.ts",

  // ---- Where generated migrations land, and why this line matters ----
  //
  // THE FAILURE THIS PREVENTS. Without `out`, drizzle-kit generates nothing:
  // the only schema mechanism available was `drizzle-kit push`, which diffs the
  // TypeScript schema against the LIVE database and applies the difference
  // immediately. No SQL is written down, so nothing is reviewed before it runs
  // and nothing records what shape the database was in yesterday.
  //
  // That is not a style preference. `push` resolves a renamed column as a DROP
  // plus a CREATE, so renaming a column in this schema silently destroys the
  // data in it. There was also a `push-force` script that skipped the one
  // interactive confirmation standing between a typo and that outcome — it has
  // been removed.
  //
  // THE WORKFLOW NOW:
  //   1. change the schema in src/schema/
  //   2. `pnpm --filter @workspace/db run generate` — writes SQL to ./drizzle
  //   3. READ THE SQL. This is the step the whole change exists to create. A
  //      DROP COLUMN you did not intend is visible here and nowhere else.
  //   4. commit it, then `pnpm --filter @workspace/db run migrate` to apply
  //
  // `push` is kept for local development against a scratch database, where
  // losing data costs nothing and the fast loop is worth it. It must not be
  // run against production — that is what `migrate` is for.
  out: "./drizzle",

  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },

  // Fails generation instead of silently reordering statements when a change
  // is ambiguous, so an ambiguous change is a question rather than a guess.
  strict: true,
  verbose: true,
});
