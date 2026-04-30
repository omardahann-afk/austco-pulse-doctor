import type { TraceStep } from "./types";

export type TraceRequest = {
  room: string;
  callType: string;
  expectedGroup: string;
};

export type TraceResult = {
  request: TraceRequest;
  steps: TraceStep[];
  finalDiagnosis: string;
  failurePoint?: string;
};

/**
 * Simulated live call trace. Real Austco integration goes here —
 * subscribe to live event stream and walk the chain in real time.
 */
export async function traceLiveCall(
  request: TraceRequest,
  onStep?: (steps: TraceStep[]) => void,
  stepDelayMs = 600,
): Promise<TraceResult> {
  const isProblemRoom = /230/.test(request.room);

  const blueprint: Array<Omit<TraceStep, "status" | "timestamp">> = [
    { id: "s1", label: `${request.room} Call Activated`, detail: `Bedside call point pressed in ${request.room}` },
    { id: "s2", label: "Controller Received", detail: "Controller East Wing forwarded active event to Pulse" },
    { id: "s3", label: "Server Processed", detail: "Pulse Primary logged active event in queue" },
    { id: "s4", label: "CCT Logic Matched", detail: `Matched group: ${request.expectedGroup}` },
    { id: "s5", label: "Output Generated", detail: `Output event created for ${request.expectedGroup}` },
    { id: "s6", label: "Output Sent to Controller", detail: "Routed to Controller West Wing (relay 4)" },
    { id: "s7", label: "Controller Ack", detail: "Awaiting acknowledgement (timeout 5000ms)" },
    { id: "s8", label: "Signal Light Activation", detail: `${request.expectedGroup} expected to illuminate` },
  ];

  const steps: TraceStep[] = blueprint.map((b) => ({ ...b, status: "Pending" }));
  onStep?.(structuredClone(steps));

  // Steps 1-6 succeed, 7-8 fail for the problem room.
  for (let i = 0; i < steps.length; i++) {
    steps[i].status = "Running";
    onStep?.(structuredClone(steps));
    await new Promise((r) => setTimeout(r, stepDelayMs));
    if (isProblemRoom && i === 6) {
      steps[i].status = "Failed";
      steps[i].detail = "No acknowledgement received within 5000ms timeout";
    } else if (isProblemRoom && i === 7) {
      steps[i].status = "Failed";
      steps[i].detail = "Group signal light did not activate";
    } else {
      steps[i].status = "Passed";
    }
    steps[i].timestamp = new Date().toISOString();
    onStep?.(structuredClone(steps));
  }

  const failurePoint = isProblemRoom
    ? "After CCT logic and output generation — controller did not acknowledge output."
    : undefined;

  const finalDiagnosis = isProblemRoom
    ? "Failure point detected after CCT logic and before output activation. Server logic is valid. Controller / output delivery failed."
    : "Full chain succeeded — call activated, processed, output generated, controller acknowledged, signal light activated.";

  return { request, steps, finalDiagnosis, failurePoint };
}