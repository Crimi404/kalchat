import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint, KeyRound, Lock, MessageCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PinPad } from "@/components/PinPad";
import { useBackHandler } from "@/lib/back";
import {
  LOCK_DELAYS,
  PIN_LENGTH,
  biometricAvailable,
  checkPin,
  clearAppLock,
  lockSupported,
  setPin,
  updateLock,
  useAppLock,
  verifyBiometric,
  waitSeconds,
  type LockMode,
} from "@/lib/applock";

export const Route = createFileRoute("/_authenticated/parametres/verrouillage")({
  head: () => ({ meta: [{ title: "Verrouillage — Kalchat" }] }),
  component: VerrouillagePage,
});

type Flow =
  | { kind: "create"; first: string | null; title: string; onDone: (pin: string) => Promise<void> | void }
  | { kind: "verify"; title: string; onDone: () => Promise<void> | void };

const MODES: { value: Exclude<LockMode, "off">; title: string; description: string; icon: typeof Smartphone }[] = [
  { value: "app", title: "Toute l'application", description: "Le code est demandé pour ouvrir Kalchat (fil, profil, messages…).", icon: Smartphone },
  { value: "messages", title: "La messagerie uniquement", description: "Le reste de Kalchat reste libre ; le code est demandé pour lire tes discussions.", icon: MessageCircle },
];

function VerrouillagePage() {
  const { config } = useAppLock();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState(false);
  const supported = lockSupported();
  const active = config.mode !== "off";

  useBackHandler(() => setFlow(null), !!flow);

  useEffect(() => {
    if (supported) void biometricAvailable().then(setBioOk);
  }, [supported]);

  function closeFlow() {
    setFlow(null);
    setError(null);
  }

  /** Demande le code actuel avant une action sensible (changer / supprimer le verrouillage). */
  function requirePin(title: string, onDone: () => Promise<void> | void) {
    setError(null);
    setFlow({ kind: "verify", title, onDone });
  }

  /** Demande un nouveau code, saisi deux fois. */
  function askNewPin(onDone: (pin: string) => Promise<void> | void) {
    setError(null);
    setFlow({ kind: "create", first: null, title: "Crée ton code PIN", onDone });
  }

  function chooseMode(mode: Exclude<LockMode, "off">) {
    if (config.mode === mode) return;
    if (!config.pinHash) {
      askNewPin(async (pin) => {
        await setPin(pin);
        updateLock({ mode });
        toast.success("Verrouillage activé");
      });
      return;
    }
    requirePin("Entre ton code PIN", () => {
      updateLock({ mode });
      toast.success("Verrouillage modifié");
    });
  }

  function disable() {
    requirePin("Entre ton code PIN pour désactiver", () => {
      clearAppLock();
      toast.success("Verrouillage désactivé");
    });
  }

  function changePin() {
    requirePin("Entre ton code PIN actuel", () => {
      askNewPin(async (pin) => {
        await setPin(pin);
        toast.success("Code PIN modifié");
      });
    });
  }

  async function toggleBiometric(on: boolean) {
    if (!on) {
      updateLock({ biometric: false });
      return;
    }
    if (await verifyBiometric("Confirme ton empreinte pour l'activer")) {
      updateLock({ biometric: true });
      toast.success("Empreinte activée");
    } else {
      toast.error("Empreinte non reconnue");
    }
  }

  async function onPad(pin: string) {
    if (!flow) return;
    if (flow.kind === "verify") {
      const res = await checkPin(pin);
      if (!res.ok) {
        setError(res.wait > 0 ? `Trop d'essais. Réessaie dans ${res.wait} s` : "Code incorrect");
        return;
      }
      const next = flow.onDone;
      closeFlow();
      await next();
      return;
    }
    // création : première saisie, puis confirmation
    if (flow.first === null) {
      setError(null);
      setFlow({ ...flow, first: pin, title: "Confirme ton code PIN" });
      return;
    }
    if (flow.first !== pin) {
      setError("Les deux codes sont différents");
      setFlow({ ...flow, first: null, title: "Crée ton code PIN" });
      return;
    }
    const done = flow.onDone;
    closeFlow();
    await done(pin);
  }

  if (!supported) {
    return (
      <SettingsShell title="Verrouillage">
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">Disponible dans l'application Android</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">Le verrouillage par code PIN et empreinte est réservé à l'APK Kalchat.</p>
        </div>
      </SettingsShell>
    );
  }

  const wait = flow ? waitSeconds() : 0;

  return (
    <SettingsShell title="Verrouillage">
      <p className="px-1 text-sm leading-snug text-muted-foreground">
        Protège Kalchat avec un code PIN{bioOk ? " et ton empreinte digitale" : ""}. Choisis ce que tu veux verrouiller.
      </p>

      <section className="space-y-2">
        {MODES.map((m) => {
          const selected = config.mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={selected}
              onClick={() => chooseMode(m.value)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border bg-card hover:bg-secondary/60"}`}
            >
              <m.icon className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{m.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{m.description}</span>
              </span>
              <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-muted-foreground/50"}`} />
            </button>
          );
        })}
      </section>

      {active && (
        <>
          {bioOk && (
            <section className="rounded-2xl border border-border bg-card p-2">
              <div className="flex items-center gap-4 px-2 py-3.5">
                <Fingerprint className="h-6 w-6 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Déverrouiller avec l'empreinte</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Le code PIN reste disponible en secours.</p>
                </div>
                <Switch checked={config.biometric} onCheckedChange={(v) => void toggleBiometric(v)} aria-label="Déverrouiller avec l'empreinte" />
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-bold text-foreground">Redemander le code</h2>
            <p className="mb-3 text-xs text-muted-foreground">Quand tu quittes Kalchat puis y reviens.</p>
            <div className="flex flex-wrap gap-2">
              {LOCK_DELAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={config.delay === d.value}
                  onClick={() => updateLock({ delay: d.value })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${config.delay === d.value ? "border-primary bg-primary/15 text-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-2">
            <button type="button" onClick={changePin} className="flex w-full items-center gap-4 rounded-2xl px-2 py-3.5 text-left transition-colors hover:bg-secondary/60">
              <KeyRound className="h-6 w-6 shrink-0 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Changer le code PIN</span>
            </button>
            <button type="button" onClick={disable} className="flex w-full items-center gap-4 rounded-2xl px-2 py-3.5 text-left transition-colors hover:bg-secondary/60">
              <Lock className="h-6 w-6 shrink-0 text-destructive" />
              <span className="text-sm font-semibold text-destructive">Désactiver le verrouillage</span>
            </button>
          </section>
        </>
      )}

      <Dialog open={!!flow} onOpenChange={(open) => { if (!open) closeFlow(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">{flow?.title}</DialogTitle>
            <DialogDescription className="text-center">
              {flow?.kind === "create" ? `Choisis un code de ${PIN_LENGTH} chiffres.` : "Saisis ton code."}
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            {flow && <PinPad key={`${flow.kind}-${flow.title}`} onComplete={onPad} disabled={wait > 0} error={wait > 0 ? `Réessaie dans ${wait} s` : error} />}
          </div>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
