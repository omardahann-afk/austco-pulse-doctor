import test from "node:test";
import assert from "node:assert/strict";
import { TACERA_EXPECTED_PORTS } from "../lib/taceraMachineExaminer.js";

test("license-service does not assume port 8080", () => {
  assert.deepEqual(TACERA_EXPECTED_PORTS["license-service"], [22, 10000]);
  assert.equal(TACERA_EXPECTED_PORTS["license-service"].includes(8080), false);
});

test("ipconnect uses SSH and Webmin as management defaults", () => {
  assert.deepEqual(TACERA_EXPECTED_PORTS["ipconnect"], [22, 10000]);
});

test("event bridge is optional and has no default MQTT ports", () => {
  assert.deepEqual(TACERA_EXPECTED_PORTS["event-bridge-optional"], []);
});
