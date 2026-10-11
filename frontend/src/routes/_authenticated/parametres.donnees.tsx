import { createFileRoute } from "@tanstack/react-router";
import { Check, Wifi } from "lucide-react";
import { SettingsShell } from "@/components/SettingsShell";
import { Switch } from "@/components/ui/switch";
import { setAutoplayMode, setShortsAutoScroll, useAutoplayMode, useShortsAutoScroll, type AutoplayMode } from "@/lib/mediaPrefs";

export const Route = createFileRoute("/_authenticated/parametres/donnees")({
  head: () => ({ meta: [{ title: "Données et lecture automatique — Kalchat" }] }),
  component: DataPage,
});

const MODES: { value: AutoplayMode; title: string; description: string }[] = [
  { value: "wifi", title: "Wi-Fi seulement", description: "Les vidéos du fil se lancent toutes seules uniquement en Wi-Fi. Avec tes données mobiles, tu lances la vidéo toi-même." },
  { value: "never", title: "Jamais", description: "Aucune vidéo ne se lance toute seule : tu gardes le contrôle de ta consommation." },
  { value: "always", title: "Toujours", description: "Les vidéos se lancent toutes seules, même avec tes données mobiles." },
];

function DataPage() {
  const mode = useAutoplayMode();
  const autoScroll = useShortsAutoScroll();

  return (
    <SettingsShell title="Données et lecture automatique">
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground">Lecture automatique des vidéos du fil</h2>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          Les vidéos se lancent sans le son quand elles sont bien visibles, et s'arrêtent dès que tu les dépasses. Utilise le bouton son de la vidéo pour l'activer.
        </p>
        <div className="mt-3 space-y-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setAutoplayMode(m.value)}
              aria-pressed={mode === m.value}
              className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${mode === m.value ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/60"}`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${mode === m.value ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                {mode === m.value && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{m.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{m.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold text-foreground">Défilement automatique dans K-Short</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">À la fin d'une vidéo K-Short, la suivante démarre toute seule. Sinon, la vidéo tourne en boucle.</span>
          </span>
          <Switch checked={autoScroll} onCheckedChange={setShortsAutoScroll} aria-label="Défilement automatique dans K-Short" />
        </label>
      </section>

      <p className="px-1 text-xs leading-snug text-muted-foreground">
        Si ton téléphone est en mode « Économiseur de données », les vidéos ne se lancent jamais toutes seules avec « Wi-Fi seulement ».
      </p>
    </SettingsShell>
  );
}
