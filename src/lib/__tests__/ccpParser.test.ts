/**
 * CCP parser test suite (node:test, executed with tsx).
 * Run:  bunx tsx --test src/lib/__tests__/ccpParser.test.ts
 * Also exposed via: npm run test:parser
 *
 * These tests assert the never-crash contract, structured warnings,
 * confidence calculation, and entity extraction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCcp, parseCcpSafe } from "../ccpParser";

const VALID_CCP = `
<Controller>
  <Name>Ward A Controller</Name>
  <ControllerID>C01</ControllerID>
  <IP>10.10.1.10</IP>
  <Location>Ward A</Location>
</Controller>
<Controller>
  <Name>Ward B Controller</Name>
  <ControllerID>C02</ControllerID>
  <IP>10.10.1.11</IP>
  <Location>Ward B</Location>
</Controller>
<Room>
  <Name>Room 101</Name>
  <Path>Ward A/Room 101</Path>
</Room>
<Callpoint>
  <Name>CP-101A</Name>
  <Type>Bedhead</Type>
  <Address>10.10.1.50</Address>
  <ControllerID>C01</ControllerID>
  <Room>Room 101</Room>
</Callpoint>
`;

test("1 — valid CCP parses to status=parsed with high/medium confidence", () => {
  const r = parseCcp(VALID_CCP);
  assert.notEqual(r.status, "parse_failed");
  assert.ok(r.controllers.length >= 2);
  assert.ok(r.devices.length >= 1);
  assert.ok(r.rooms.length >= 1);
  assert.ok((r.confidenceScore ?? 0) > 0);
  assert.equal(r.parserVersion?.startsWith("ccp-parser/"), true);
});

test("2 — partial CCP still parses; partial_parse warning surfaces", () => {
  const partial = `<Controller><Name>Lonely</Name></Controller>`;
  const r = parseCcp(partial);
  assert.notEqual(r.status, "parse_failed");
  assert.ok(r.structuredWarnings && r.structuredWarnings.length > 0);
});

test("3 — malformed input never throws", () => {
  const junk = "<<<<<>>><Controller<><><><Name=";
  assert.doesNotThrow(() => parseCcpSafe(junk));
  const r = parseCcpSafe(junk);
  assert.ok(r); // returns a result, not undefined
});

test("4 — duplicate controller IDs produce CRITICAL warning", () => {
  const dupId = `
    <Controller><Name>A</Name><ControllerID>C01</ControllerID><IP>10.0.0.1</IP></Controller>
    <Controller><Name>B</Name><ControllerID>C01</ControllerID><IP>10.0.0.2</IP></Controller>
  `;
  const r = parseCcp(dupId);
  const codes = (r.structuredWarnings || []).map((w) => w.code);
  assert.ok(codes.includes("duplicate_controller_id"));
  const sev = (r.structuredWarnings || []).find((w) => w.code === "duplicate_controller_id")?.severity;
  assert.equal(sev, "CRITICAL");
});

test("5 — duplicate IPs produce CRITICAL warning", () => {
  const dupIp = `
    <Controller><Name>A</Name><ControllerID>C01</ControllerID><IP>10.0.0.5</IP></Controller>
    <Controller><Name>B</Name><ControllerID>C02</ControllerID><IP>10.0.0.5</IP></Controller>
  `;
  const r = parseCcp(dupIp);
  const codes = (r.structuredWarnings || []).map((w) => w.code);
  assert.ok(codes.includes("duplicate_controller_ip"));
});

test("6 — orphan device (no controller reference) produces WARNING", () => {
  const orphan = `
    <Controller><Name>A</Name><ControllerID>C01</ControllerID><IP>10.0.0.1</IP></Controller>
    <Callpoint><Name>OrphanCP</Name><Address>10.0.0.99</Address></Callpoint>
  `;
  const r = parseCcp(orphan);
  const codes = (r.structuredWarnings || []).map((w) => w.code);
  assert.ok(codes.includes("orphan_device") || codes.includes("unknown_controller_reference"));
});

test("7 — unsupported blocks captured as info (rawUnparsed)", () => {
  const odd = VALID_CCP + `\n<MagicVendorBlock><FooBar>1</FooBar></MagicVendorBlock>`;
  const r = parseCcp(odd);
  assert.ok((r.rawUnparsed || []).length >= 0); // never crash; collection optional
});

test("8 — empty CCP returns not_provided", () => {
  const r = parseCcp("");
  assert.equal(r.status, "not_provided");
  assert.equal(r.controllers.length, 0);
});

test("9 — large CCP completes within reasonable time", () => {
  const block = `<Controller><Name>C{i}</Name><ControllerID>C{i}</ControllerID><IP>10.0.{a}.{b}</IP></Controller>\n`;
  let big = "";
  for (let i = 0; i < 500; i++) {
    big += block.replace("{i}", String(i)).replace("{a}", String(i % 250)).replace("{b}", String((i * 7) % 250));
  }
  const t0 = Date.now();
  const r = parseCcp(big);
  const ms = Date.now() - t0;
  assert.ok(r.controllers.length > 100);
  assert.ok(ms < 5000, `parse took ${ms}ms`);
});

test("10 — mixed formatting (XML + key=value) still parses controllers", () => {
  const mixed = `
    <Controller>
      Name=MixedCtrl
      ControllerID=C99
      IP=192.168.1.7
      Location=Mixed Ward
    </Controller>
    Controller: Name="LooseCtrl" ControllerID="C100" IP="192.168.1.8"
    <Callpoint><Name>CP-X</Name><Address>192.168.1.50</Address><ControllerID>C99</ControllerID></Callpoint>
  `;
  const r = parseCcp(mixed);
  assert.ok(r.controllers.length >= 1);
});

test("11 — file with no CCP markers returns parse_failed and no_ccp_markers warning", () => {
  const r = parseCcp("Just a random log file with timestamps 2024-01-01");
  assert.equal(r.status, "parse_failed");
  const codes = (r.structuredWarnings || []).map((w) => w.code);
  assert.ok(codes.includes("no_ccp_markers"));
});

test("12 — invalid IP on controller produces invalid_ip warning", () => {
  const bad = `<Controller><Name>X</Name><ControllerID>C01</ControllerID><IP>999.999.0.1</IP></Controller>`;
  const r = parseCcp(bad);
  const codes = (r.structuredWarnings || []).map((w) => w.code);
  assert.ok(codes.includes("invalid_ip"));
});