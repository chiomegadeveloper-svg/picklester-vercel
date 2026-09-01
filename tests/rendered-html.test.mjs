import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("publishes Picklester metadata and install manifest", async () => {
  const [layout, manifestText] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("public/manifest.webmanifest", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(layout, /Picklester — Play\. Prove\. Rank\./);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(manifest.name, /^Picklester/);
  assert.equal(manifest.short_name, "Picklester");
  assert.equal(manifest.display, "standalone");
});

test("serves both the home and profile App Router pages", async () => {
  const [home, profile] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/profile/page.tsx", root), "utf8"),
  ]);

  assert.match(home, /<PicklesterApp/);
  assert.match(profile, /initialView="profile"/);
});
