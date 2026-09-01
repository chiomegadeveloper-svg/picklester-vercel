import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("keeps Gold Coin grants owner-only and auditable", async () => {
  const migration = await readFile(
    new URL("supabase/picklester-v32-staff-coins.sql", root),
    "utf8",
  );

  assert.match(migration, /grant_picklester_coins/);
  assert.match(migration, /if not public\.is_picklester_owner\(\)/);
  assert.match(migration, /'owner_grant'/);
  assert.match(migration, /picklester_coin_ledger/);
});

test("supports Player, Game Master, and Admin assignments", async () => {
  const [migration, app] = await Promise.all([
    readFile(new URL("supabase/picklester-v32-staff-coins.sql", root), "utf8"),
    readFile(new URL("app/picklester-app.tsx", root), "utf8"),
  ]);

  assert.match(migration, /new_role not in \('player', 'gm', 'admin'\)/);
  assert.match(app, /<option value="gm">Game Master<\/option>/);
  assert.match(app, /currentRole === "owner"/);
});

test("publishes exactly ten Admin responsibilities", async () => {
  const app = await readFile(new URL("app/picklester-app.tsx", root), "utf8");
  const duties = app.match(/const ADMIN_TASKS = \[([\s\S]*?)\] as const;/)?.[1];

  assert.ok(duties);
  assert.equal((duties.match(/^\s*"/gm) || []).length, 10);
});

test("activates new and existing registrations without an approval queue", async () => {
  const [migration, app] = await Promise.all([
    readFile(new URL("supabase/picklester-v33-immediate-registration.sql", root), "utf8"),
    readFile(new URL("app/picklester-app.tsx", root), "utf8"),
  ]);

  assert.match(migration, /alter column verified set default true/);
  assert.match(migration, /where verified = false/);
  assert.match(migration, /handle_new_picklester_user/);
  assert.doesNotMatch(app, /Pending verification/);
  assert.doesNotMatch(app, /No pending applications/);
});
