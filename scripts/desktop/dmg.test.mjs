import { test } from "node:test";
import assert from "node:assert/strict";
import { createDmg } from "./dmg.mjs";

const args = ["create", "-srcfolder", "fixture", "output.dmg"];
function fixture(results) {
  const calls = [];
  const pauses = [];
  const warnings = [];
  return {
    calls,
    pauses,
    warnings,
    options: {
      run: (command, received, options) => {
        calls.push({ command, args: received, options });
        return results.shift();
      },
      pause: async (ms) => pauses.push(ms),
      warn: (message) => warnings.push(message),
    },
  };
}
test("DMG retries a transient hdiutil Resource busy failure then succeeds", async () => {
  const f = fixture([
    { status: 1, stderr: "hdiutil: create failed - Resource busy\n" },
    { status: 0 },
  ]);
  assert.equal(await createDmg(args, f.options), 0);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    f.calls.map((c) => [c.command, c.args]),
    [
      ["hdiutil", args],
      ["hdiutil", args],
    ],
  );
  assert.deepEqual(f.pauses, [1000]);
  assert.match(f.warnings[0], /Resource busy.*1\/3/);
});
test("DMG busy retries are bounded to three attempts", async () => {
  const f = fixture(
    Array.from({ length: 3 }, () => ({
      status: 1,
      stderr: "hdiutil: create failed - Resource busy",
    })),
  );
  assert.equal(await createDmg(args, f.options), 1);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.pauses, [1000, 2000]);
});
test("DMG does not retry unrelated errors, signals, spawn errors or successful warnings", async () => {
  for (const result of [
    { status: 1, stderr: "hdiutil: create failed - No space left on device" },
    { status: null, signal: "SIGTERM", stderr: "Resource busy" },
    { status: null, error: new Error("ENOENT"), stderr: "Resource busy" },
    { status: 0, stderr: "Resource busy" },
  ]) {
    const f = fixture([result]);
    assert.equal(await createDmg(args, f.options), result.status ?? 1);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.pauses, []);
  }
});
