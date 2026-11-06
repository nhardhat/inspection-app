/**
 * A step's name: in full, or shortened on a phone where three steps share
 * the width ("Pre-insp."; engineer, 2026-11-06). Screen readers always get
 * the full name.
 */
export function StepLabel({ label }: { label: string }) {
  const short = SHORT[label];
  if (!short) return <>{label}</>;
  return (
    <>
      <span className="step-long">{label}</span>
      <span className="step-short" aria-hidden="true">
        {short}
      </span>
    </>
  );
}

const SHORT: Record<string, string> = { "Pre-inspection": "Pre-insp." };
