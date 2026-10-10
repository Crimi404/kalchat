import { useCallback, useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Fingerprint, Lock } from "lucide-react";
import logo from "@/assets/kalchat-logo.png";
import { PinPad } from "@/components/PinPad";
import { useAuth } from "@/lib/auth";
import { useBackHandler } from "@/lib/back";
import { checkPin, clearAppLock, lockSupported, unlockApp, useAppLock, verifyBiometric, waitSeconds } from "@/lib/applock";

type AppPlugin = { exitApp: () => void };

function leaveApp() {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor;
  cap?.Plugins?.App?.exitApp?.();
}

/**
 * Écran de verrouillage (APK uniquement), posé par-dessus l'appli.
 * Mode « app » : couvre tout ; mode « messages » : couvre seulement la messagerie.
 */
export function AppLockGate() {
  const { config, locked } = useAppLock();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const covers =
    lockSupported() && !!user && locked && config.mode !== "off" && (config.mode === "app" || pathname.startsWith("/messages"));

  if (!covers) return null;
  return <LockScreen messagesOnly={config.mode === "messages"} useBiometric={config.biometric} />;
}

function LockScreen({ messagesOnly, useBiometric }: { messagesOnly: boolean; useBiometric: boolean }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(waitSeconds());
  const [confirmReset, setConfirmReset] = useState(false);

  const goHome = useCallback(() => void navigate({ to: "/", replace: true }), [navigate]);

  // Bouton retour d'Android : on ne dévoile rien ; on quitte la messagerie, ou l'appli
  useBackHandler(() => (messagesOnly ? goHome() : leaveApp()), true);

  const tryBiometric = useCallback(async () => {
    if (await verifyBiometric(messagesOnly ? "Déverrouille ta messagerie" : "Déverrouille Kalchat")) unlockApp();
  }, [messagesOnly]);

  // Empreinte proposée dès l'affichage
  useEffect(() => {
    if (useBiometric) void tryBiometric();
  }, [useBiometric, tryBiometric]);

  // Compte à rebours après trop d'essais ratés
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setInterval(() => setWait(waitSeconds()), 1000);
    return () => window.clearInterval(t);
  }, [wait]);

  async function onPin(pin: string) {
    const res = await checkPin(pin);
    if (res.ok) {
      unlockApp();
      return;
    }
    setWait(res.wait);
    setError(res.wait > 0 ? `Trop d'essais. Réessaie dans ${res.wait} s` : "Code incorrect");
  }

  async function resetByLogout() {
    await signOut();
    clearAppLock();
    void navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="fixed inset-0 z-[500] flex flex-col items-center overflow-y-auto bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label="Verrouillage">
      <img src={logo} alt="Kalchat" width={64} height={64} className="h-16 w-16 drop-shadow-[0_0_18px_rgba(150,80,255,0.55)]" />
      <h1 className="mt-4 flex items-center gap-2 text-lg font-bold text-foreground">
        <Lock className="h-4 w-4" /> {messagesOnly ? "Messagerie verrouillée" : "Kalchat est verrouillé"}
      </h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">Entre ton code PIN{useBiometric ? " ou utilise ton empreinte" : ""}</p>

      <PinPad
        onComplete={onPin}
        disabled={wait > 0}
        error={wait > 0 ? `Réessaie dans ${wait} s` : error}
        extra={
          useBiometric ? (
            <button type="button" aria-label="Utiliser l'empreinte" onClick={() => void tryBiometric()} className="flex h-16 w-16 items-center justify-center rounded-full text-primary transition active:scale-95">
              <Fingerprint className="h-8 w-8" />
            </button>
          ) : null
        }
      />

      <div className="mt-8 flex flex-col items-center gap-3 text-sm">
        {messagesOnly && (
          <button type="button" onClick={goHome} className="font-semibold text-primary">Retour à l'accueil</button>
        )}
        {!confirmReset ? (
          <button type="button" onClick={() => setConfirmReset(true)} className="text-muted-foreground underline underline-offset-2">Code oublié ?</button>
        ) : (
          <div className="max-w-xs rounded-2xl border border-border bg-card p-4 text-center">
            <p className="text-xs leading-snug text-muted-foreground">Pour retrouver l'accès, tu seras déconnecté de Kalchat sur cet appareil. Reconnecte-toi ensuite avec ton nom d'utilisateur et ton mot de passe.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => setConfirmReset(false)} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground">Annuler</button>
              <button type="button" onClick={() => void resetByLogout()} className="rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-white">Me déconnecter</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
