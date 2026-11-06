import { ChevronLeft, CloudOff } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { AppBarSlot } from "./appBarSlot";
import { useOnlineStatus } from "./useOnlineStatus";

/**
 * The screen header beside the rail: context on the left (back and a
 * title), the screen's sections in the centre, status on the right.
 * Rendered into the shell's header so it stays put while the screen
 * scrolls; screens without one leave it empty (and hidden).
 */
export function AppBar({
  left,
  centre,
  right,
}: {
  left?: ReactNode;
  centre?: ReactNode;
  right?: ReactNode;
}) {
  const slot = useContext(AppBarSlot);
  if (!slot) return null;
  return createPortal(
    <>
      <div className="app-bar-left">{left}</div>
      <div className="app-bar-centre">{centre}</div>
      <div className="app-bar-right">{right}</div>
    </>,
    slot,
  );
}

/** Back to where this screen was opened from. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="app-bar-back" aria-label={label} title={label}>
      <ChevronLeft aria-hidden="true" />
    </Link>
  );
}

/** A title in the bar: an optional small line above a bold one. */
export function BarTitle({
  kicker,
  heading,
}: {
  kicker?: ReactNode;
  heading: ReactNode;
}) {
  return (
    <div className="app-bar-title">
      {kicker && <span className="app-bar-kicker">{kicker}</span>}
      <span className="app-bar-heading">{heading}</span>
    </div>
  );
}

/** In the rail: online is a quiet dot; offline is spelled out. */
export function NetStatus() {
  const online = useOnlineStatus();
  return (
    <span
      className={`net-status ${online ? "online" : "offline"}`}
      role="status"
      data-testid="net-status"
      title={
        online ? "Online" : "Offline: everything still saves on this device"
      }
    >
      {online ? (
        <span className="net-dot" aria-hidden="true" />
      ) : (
        <CloudOff aria-hidden="true" />
      )}
      <span className={online ? "sr-only" : "net-label"}>
        {online ? "Online" : "Offline"}
      </span>
    </span>
  );
}
