/**
 * Tiny svg sparkline. Pure presentation, no animation lib.
 * Renders the latency series. Failed probes (latency null) become gaps.
 */
type Props = { values: (number | null)[]; width?: number; height?: number; stroke?: string };
export function Sparkline({ values, width = 120, height = 28, stroke = "currentColor" }: Props) {
  if (!values.length) return <svg width={width} height={height} />;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return (
    <svg width={width} height={height} className="text-muted-foreground">
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeDasharray="2,3" strokeOpacity={0.4} />
    </svg>
  );
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return { x, y };
  });
  // Build a path string with M/L commands, breaking at gaps.
  let d = "";
  let started = false;
  for (const p of points) {
    if (!p) { started = false; continue; }
    d += (started ? " L" : "M") + p.x.toFixed(1) + "," + p.y.toFixed(1);
    started = true;
  }
  return (
    <svg width={width} height={height} style={{ color: stroke }}>
      {d && <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}