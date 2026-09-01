import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("keeps the Control Center responsive on narrow phones", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(css, /\.member-role-list\{/);
  assert.match(css, /\.member-summary\{/);
  assert.match(css, /\.member-tools\{/);
  assert.match(css, /\.coin-grant-form\{[^}]*grid-template-columns/);
});

test("hides Restore Purchases from the owner profile", async () => {
  const social = await readFile(new URL("app/picklester-social.tsx", root), "utf8");

  assert.match(social, /\{isOwn && !isOwner && \(/);
});

test("labels the owner Coin controls for assistive technology", async () => {
  const app = await readFile(new URL("app/picklester-app.tsx", root), "utf8");

  assert.match(app, /aria-label="Member receiving Gold Coins"/);
  assert.match(app, /aria-label="Gold Coin amount"/);
  assert.match(app, /aria-label="Reason for Gold Coin grant"/);
});
