import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { mqttFreshnessProbe } from "../lib/probes/mqttFreshnessProbe.js";
import { webminProbe } from "../lib/probes/webminProbe.js";
import { readSiteConfig, writeSiteConfig } from "../lib/siteConfigStore.js";

test("mqttFreshnessProbe: invalid host returns evidence (does not throw)", async () => {
  const ev = await mqttFreshnessProbe({ host: "", port: 1883, meta: {} });
  assert.equal(ev.ok, false);
  assert.equal(ev.protocol, "mqtt-fresh");
  assert.equal(typeof ev.timestamp, "string");
});

test("mqttFreshnessProbe: unreachable broker returns evidence within window", async () => {
  const ev = await mqttFreshnessProbe({ host: "127.0.0.1", port: 1, meta: { mqttTopics: ["#"], freshnessWindowMs: 1000 } });
  assert.equal(ev.ok, false);
  assert.equal(ev.protocol, "mqtt-fresh");
  assert.ok(ev.error);
});

test("webminProbe: invalid host returns evidence (does not throw)", async () => {
  const ev = await webminProbe({ host: "", port: 10000 });
  assert.equal(ev.ok, false);
  assert.equal(ev.protocol, "webmin");
});

test("webminProbe: unreachable host returns evidence", async () => {
  const ev = await webminProbe({ host: "127.0.0.1", port: 1, tls: false }, { timeoutMs: 1000 });
  assert.equal(ev.ok, false);
  assert.ok(ev.error);
});

test("siteConfigStore: round-trip write/read with atomic rename", () => {
  const tmp = path.join(os.tmpdir(), `tacera-site-config-${Date.now()}.json`);
  try {
    const cfg = { site: { siteName: "Test Site" }, monitor: { pollingEnabled: true } };
    const info = writeSiteConfig(cfg, tmp);
    assert.ok(info.bytes > 0);
    const back = readSiteConfig(tmp);
    assert.equal(back.site.siteName, "Test Site");
    assert.equal(back.monitor.pollingEnabled, true);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test("siteConfigStore: missing file returns null", () => {
  const r = readSiteConfig(path.join(os.tmpdir(), `does-not-exist-${Date.now()}.json`));
  assert.equal(r, null);
});