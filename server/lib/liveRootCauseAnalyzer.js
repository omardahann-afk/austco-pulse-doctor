function textOf(x) {
  if (typeof x === "string") return x;
  return x?.line || x?.rawMessage || x?.message || JSON.stringify(x || "");
}

function getTimestamp(line) {
  const m = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\.\d{3})/);
  return m ? new Date(m[1].replace(" ", "T")).getTime() : null;
}

function getControllerIds(line) {
  const ids = new Set();

  for (const m of line.matchAll(/\b(\d{3,5})\.\d+\.\d+\.\d+\b/g)) {
    ids.add(m[1]);
  }

  for (const m of line.matchAll(/\bCCT[# ]?(\d{3,5})\b/gi)) {
    ids.add(m[1]);
  }

  return [...ids];
}

function getSbusDev(line) {
  const m = line.match(/Polling to dev\s+(\d+)/i);
  return m ? m[1] : null;
}

function getAlarmType(line) {
  if (/code blue/i.test(line)) return "Code Blue";
  if (/code white/i.test(line)) return "Code White";
  if (/staff assist/i.test(line)) return "Staff Assist";
  if (/maintenance/i.test(line)) return "Maintenance";
  return null;
}

export function analyzeLiveRootCause(input = {}) {
  const lines = (input.lines || input.logs || input.rawEvidence || [])
    .map(textOf)
    .filter(Boolean);

  const events = lines.map((line, index) => ({
    index,
    line,
    ts: getTimestamp(line),
    controllers: getControllerIds(line),
    sbusDev: getSbusDev(line),
    alarmType: getAlarmType(line),
    isActivated: /activated|new reply/i.test(line),
    isCancelled: /cancelled|deactivated/i.test(line),
    isRestart: /restart|reset|boot|watchdog|lock up|locked up/i.test(line),
    isBadMessage: /\bBAD\b|bad message/i.test(line),
    isVirtualAlarm: /Virtual Alarms|,\d+\.\d+\.\d+\.\d+,/i.test(line),
    isReadRegister: /READ_REGISTER|READW_REGISTER/i.test(line),
    isConnectionIssue: /connection refused|not connected|connecting|disconnect|timeout/i.test(line),
  }));

  const controllerHits = {};
  const sbusHits = {};
  let badMessages = 0;
  let restarts = 0;
  let connectionIssues = 0;

  for (const e of events) {
    for (const c of e.controllers) {
      controllerHits[c] = (controllerHits[c] || 0) + 1;
    }
    if (e.sbusDev) sbusHits[e.sbusDev] = (sbusHits[e.sbusDev] || 0) + 1;
    if (e.isBadMessage) badMessages++;
    if (e.isRestart) restarts++;
    if (e.isConnectionIssue) connectionIssues++;
  }

  const busiestController = Object.entries(controllerHits).sort((a,b)=>b[1]-a[1])[0] || null;
  const busiestSbus = Object.entries(sbusHits).sort((a,b)=>b[1]-a[1]).slice(0, 10);

  const manySameControllerEvents = busiestController && busiestController[1] >= 5;
  const manySbusDevices = Object.keys(sbusHits).length >= 3;
  const hasDelayedFlushPattern =
    /second alarm|first appear|takes a second alarm|missed earlier|stuck/i.test(lines.join("\n"));

  let rootCause = "Insufficient evidence during this capture.";
  let confidence = 35;
  let plainEnglish = "The capture does not yet show a clear first failure point.";
  let brokenStep = "Unknown";
  let fixNow = [
    "Reproduce the issue again while capturing PST, CCT, IPConnect, and Integration Gateway logs at the same time.",
  ];

  if (manySameControllerEvents && manySbusDevices) {
    rootCause = "Likely CCT overload / duplicate zone activation flood.";
    confidence = hasDelayedFlushPattern ? 92 : 82;
    brokenStep = "CCT zone activation processing";
    plainEnglish =
      `The same CCT is receiving many ODL/ZTS activation events close together. This can overwhelm the controller, causing first alarms to be delayed, missed, or stuck until a second alarm flushes the queue.`;
    fixNow = [
      "Reduce duplicate Display Assignment entries for devices on the same CCT.",
      "If multiple ODL/ZTS devices always activate together on the same CCT, combine them into one controller zone.",
      "Assign only one representative zone/device in Display Assignment instead of every physical ODL/ZTS.",
      "Retest with 1 ODL assigned, then 2, then 3+ to find the failure threshold.",
      "Capture CCT/PST sbus READ_REGISTER logs during the exact reproduction window.",
      "Check if the CCT resets, locks, or drops connection during the activation burst.",
    ];
  }

  if (badMessages > 0 && confidence < 90) {
    rootCause = "PST/CCT bad messages may be corrupting or delaying alarm propagation.";
    confidence = Math.max(confidence, 75);
    brokenStep = "PST/CCT message processing";
    plainEnglish =
      "The controller logs show BAD messages during testing. That means the alarm path may be producing invalid/garbled messages before the ODL/ZTS activation completes.";
    fixNow.unshift("Inspect PST/CCT firmware and capture BAD message timestamps against the alarm trigger time.");
  }

  if (connectionIssues > 0 && confidence < 85) {
    rootCause = "Controller/IPConnect connectivity instability may be contributing.";
    confidence = Math.max(confidence, 70);
    brokenStep = "PST/CCT connection to IPConnect";
    fixNow.unshift("Verify PST and CCT show CONNECTED to IPConnect during the entire test.");
  }

  return {
    ok: true,
    captureType: "live_root_cause",
    rootCause,
    confidence,
    brokenStep,
    plainEnglish,
    whatToCheckFirst: fixNow[0],
    fixNow,
    doNotDo: [
      "Do not blame MQTT/event broker unless directly configured and proven.",
      "Do not restart all VMs before proving where the signal path broke.",
      "Do not assume Webmin being reachable means the Tacera application path is healthy.",
      "Do not assign every ODL/ZTS individually if they belong to the same activation zone on the same CCT.",
    ],
    proof: {
      busiestController: busiestController
        ? { controller: busiestController[0], eventCount: busiestController[1] }
        : null,
      sbusDevicesSeen: busiestSbus.map(([dev, count]) => ({ dev, count })),
      badMessages,
      restarts,
      connectionIssues,
      totalLines: lines.length,
    },
    timeline: events
      .filter(e => e.isVirtualAlarm || e.isReadRegister || e.isBadMessage || e.isRestart || e.isConnectionIssue)
      .slice(-80)
      .map(e => ({
        index: e.index,
        timestamp: e.ts,
        alarmType: e.alarmType,
        controllers: e.controllers,
        sbusDev: e.sbusDev,
        summary: e.line.slice(0, 260),
      })),
  };
}
