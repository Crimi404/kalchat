import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Bandeau « Pas de connexion » quand le réseau est perdu pendant l'utilisation ; disparaît tout seul au retour du réseau. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[130] flex items-center justify-center gap-2 bg-destructive px-4 pb-2 text-xs font-semibold text-destructive-foreground"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      <WifiOff className="h-3.5 w-3.5" /> Pas de connexion — Kalchat reprendra dès que le réseau revient
    </div>
  );
}
