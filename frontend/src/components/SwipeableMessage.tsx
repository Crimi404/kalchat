import { Reply } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

const TRIGGER_PX = 56; // distance à parcourir pour déclencher « répondre »
const MAX_PX = 80;
const LONG_PRESS_MS = 450;

/**
 * Enveloppe d'un message :
 * - glisser à droite OU à gauche  → répondre (comme sur WhatsApp)
 * - appui long (ou clic droit sur ordinateur) → ouvre le menu d'actions
 * Le défilement vertical de la conversation reste normal.
 */
export function SwipeableMessage({
  children,
  disabled,
  onReply,
  onLongPress,
}: {
  children: ReactNode;
  disabled?: boolean;
  onReply: () => void;
  onLongPress: () => void;
}) {
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const moved = useRef(false);
  const longPressed = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const setOffset = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };
  const reset = () => {
    clearTimer();
    start.current = null;
    setOffset(0);
  };

  function onPointerDown(e: React.PointerEvent) {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Les lecteurs vidéo / vocal, boutons et liens gardent leur comportement normal
    if ((e.target as HTMLElement).closest("video, audio, button, a, input")) return;
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    longPressed.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (!moved.current) {
        longPressed.current = true;
        navigator.vibrate?.(15);
        onLongPress();
      }
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s || longPressed.current) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!moved.current && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
      moved.current = true;
      clearTimer();
    }
    if (Math.abs(ddx) > Math.abs(ddy)) setOffset(Math.max(-MAX_PX, Math.min(MAX_PX, ddx)));
  }

  function onPointerUp() {
    const passed = Math.abs(dxRef.current) >= TRIGGER_PX && !longPressed.current;
    reset();
    if (passed) {
      navigator.vibrate?.(10);
      onReply();
    }
  }

  const progress = Math.min(1, Math.abs(dx) / TRIGGER_PX);

  return (
    <div className="relative">
      {dx !== 0 && (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-secondary p-1.5 text-muted-foreground ${dx > 0 ? "left-1" : "right-1"}`}
          style={{ opacity: progress, transform: `translateY(-50%) scale(${0.6 + progress * 0.4})` }}
        >
          <Reply className="h-4 w-4" />
        </span>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onPointerLeave={() => { if (start.current && !moved.current) clearTimer(); }}
        onContextMenu={(e) => { e.preventDefault(); if (!disabled && !longPressed.current) onLongPress(); }}
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 0.2s ease-out" : "none", touchAction: "pan-y" }}
        className="select-none [-webkit-touch-callout:none]"
      >
        {children}
      </div>
    </div>
  );
}
