import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("keeps the Control Center responsive on narrow phones", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(css, /\.role-actions\{[^}]*min-width:142px/);
  assert.match(css, /@media\(max-width:390px\)[^{]*\{[^}]*\.role-actions/);
  assert.match(css, /\.coin-grant-form\{[^}]*grid-template-columns/);
  assert.match(css, /\.admin-duty-list\{[^}]*grid-template-columns/);
});

test("labels the owner Coin controls for assistive technology", async () => {
  const app = await readFile(new URL("app/picklester-app.tsx", root), "utf8");

  assert.match(app, /aria-label="Member receiving Gold Coins"/);
  assert.match(app, /aria-label="Gold Coin amount"/);
  assert.match(app, /aria-label="Reason for Gold Coin grant"/);
});
