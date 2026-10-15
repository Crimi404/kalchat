import { useEffect, useRef, type ReactNode } from "react";
import { api } from "@/lib/api";

// Une publication compte comme « vue » quand au moins 40 % de sa hauteur reste affichée pendant 1 seconde.
// Les identifiants partent par lots (toutes les 5 s, ou dès qu'on quitte l'appli) vers /posts/seen : le prochain classement
// du fil « Pour vous » repousse ce qu'on a déjà vu. Aucun affichage, les échecs sont ignorés.
const DWELL_MS = 1000;
const FLUSH_MS = 5000;
const BATCH = 50;

const sent = new Set<string>();
let queue: string[] = [];
let timer: number | undefined;
let wired = false;

function flush() {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  while (queue.length) {
    const ids = queue.splice(0, BATCH);
    void api("/posts/seen", { method: "POST", body: { ids } }).catch(() => undefined);
  }
}

function markSeen(id: string) {
  if (sent.has(id)) return;
  sent.add(id);
  queue.push(id);
  if (queue.length >= 20) flush();
  else if (timer === undefined) timer = window.setTimeout(flush, FLUSH_MS);
}

function wire() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
  // Changement de compte : on repart de zéro
  window.addEventListener("kalchat:logout", () => {
    queue = [];
    sent.clear();
  });
}

/** Enveloppe une publication du fil et signale au serveur quand elle a vraiment été vue. */
export function SeenWatch({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || sent.has(id)) return;
    wire();
    let t: number | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            if (t === undefined) {
              t = window.setTimeout(() => {
                markSeen(id);
                io.disconnect();
              }, DWELL_MS);
            }
          } else if (t !== undefined) {
            window.clearTimeout(t);
            t = undefined;
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [id]);

  return <div ref={ref}>{children}</div>;
}
