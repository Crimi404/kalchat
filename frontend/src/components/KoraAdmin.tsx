import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/social";

type KoraSettings = {
  replies_enabled: boolean;
  comments_enabled: boolean;
  images_enabled: boolean;
  vision_enabled: boolean;
  daily_post_enabled: boolean;
  personalize_enabled: boolean;
  msg_per_hour: number;
  comment_per_hour: number;
  vision_per_hour: number;
  image_per_day: number;
  image_global_per_day: number;
};

type KindStats = { ok_24h: number; ok_7d: number; ok_30d: number; errors_24h: number; limited_24h: number };

type KoraData = {
  settings: KoraSettings;
  limits: Record<string, [number, number]>;
  stats: {
    by_kind: Record<string, KindStats>;
    users_24h: number;
    images_used_24h: number;
    feedback: { up: number; down: number; up_7d: number; down_7d: number };
    recent_errors: { kind: string; detail: string | null; created_at: string }[];
  };
};

const TOGGLES: { key: keyof KoraSettings; label: string; hint: string }[] = [
  { key: "replies_enabled", label: "Réponses en messages privés", hint: "Kora répond dans sa discussion avec chaque membre." },
  { key: "comments_enabled", label: "Réponses en commentaires", hint: "Kora répond quand on la mentionne (@kora)." },
  { key: "images_enabled", label: "Génération d'images", hint: "Bouton 🎨 et commande /image." },
  { key: "vision_enabled", label: "Vision (lire les images)", hint: "Kora regarde les photos envoyées. Désactivée par défaut : dépend du quota gratuit." },
  { key: "daily_post_enabled", label: "Publication quotidienne", hint: "Un post par jour sur le compte de Kora." },
  { key: "personalize_enabled", label: "Personnalisation", hint: "Kora connaît le prénom, le pseudo et la bio (profil public) du membre en messages privés pour discuter plus naturellement." },
];

const QUOTAS: { key: keyof KoraSettings; label: string; unit: string }[] = [
  { key: "msg_per_hour", label: "Messages à Kora", unit: "par membre / heure" },
  { key: "comment_per_hour", label: "Demandes en commentaire", unit: "par membre / heure" },
  { key: "vision_per_hour", label: "Images analysées", unit: "par membre / heure" },
  { key: "image_per_day", label: "Images générées", unit: "par membre / jour" },
  { key: "image_global_per_day", label: "Images générées (total)", unit: "toute la plateforme / jour" },
];

const KIND_LABEL: Record<string, string> = {
  dm: "Messages privés",
  comment: "Commentaires",
  image: "Images générées",
  vision: "Images analysées",
  post: "Posts quotidiens",
};

export function KoraAdmin() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<Record<keyof KoraSettings, string>>>({});
  const [saving, setSaving] = useState(false);
  const [postBusy, setPostBusy] = useState(false);

  const kora = useQuery({
    queryKey: ["adminKora"],
    refetchInterval: 60000,
    queryFn: () => api<KoraData>("/admin/kora"),
  });

  // Les champs de quotas reprennent les valeurs du serveur à chaque rechargement
  useEffect(() => {
    if (!kora.data) return;
    setDraft(Object.fromEntries(QUOTAS.map((q) => [q.key, String(kora.data.settings[q.key])])));
  }, [kora.data]);

  async function save(patch: Partial<KoraSettings>, ok?: string) {
    try {
      await api("/admin/kora/settings", { method: "PATCH", body: patch });
      if (ok) toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["adminKora"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveQuotas() {
    if (!kora.data) return;
    const patch: Partial<KoraSettings> = {};
    for (const q of QUOTAS) {
      const n = Number(draft[q.key]);
      const [min, max] = kora.data.limits[q.key] ?? [0, 9999];
      if (!Number.isFinite(n) || n < min || n > max) {
        toast.error(`« ${q.label} » : entre ${min} et ${max}`);
        return;
      }
      patch[q.key] = n as never;
    }
    setSaving(true);
    await save(patch, "Quotas enregistrés");
    setSaving(false);
  }

  const btn = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-40";
  const s = kora.data?.settings;
  const st = kora.data?.stats;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-3">
      <div>
        <p className="text-sm font-semibold">Kora IA</p>
        <p className="mt-1 text-xs text-muted-foreground">Réglages en direct : aucun redéploiement nécessaire.</p>
      </div>

      {kora.isError && <p className="text-xs text-destructive">{(kora.error as Error).message}</p>}
      {kora.isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}

      {s && (
        <>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interrupteurs</p>
            {TOGGLES.map((t) => (
              <div key={t.key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.hint}</p>
                </div>
                <Switch
                  checked={!!s[t.key]}
                  onCheckedChange={(v) => void save({ [t.key]: v } as unknown as Partial<KoraSettings>, v ? `${t.label} : activé` : `${t.label} : coupé`)}
                  aria-label={t.label}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quotas</p>
            {QUOTAS.map((q) => (
              <div key={q.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{q.label}</p>
                  <p className="text-xs text-muted-foreground">{q.unit}</p>
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={kora.data?.limits[q.key]?.[0]}
                  max={kora.data?.limits[q.key]?.[1]}
                  value={draft[q.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [q.key]: e.target.value }))}
                  className="w-20 rounded-xl border border-border bg-secondary/60 px-2 py-1.5 text-right text-sm outline-none focus:border-primary"
                />
              </div>
            ))}
            <button className={btn} disabled={saving} onClick={() => void saveQuotas()}>
              Enregistrer les quotas
            </button>
          </div>
        </>
      )}

      {st && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Statistiques</p>
          <p className="text-xs text-muted-foreground">
            {st.users_24h} membre{st.users_24h > 1 ? "s" : ""} actif{st.users_24h > 1 ? "s" : ""} avec Kora en 24 h · {st.images_used_24h} image{st.images_used_24h > 1 ? "s" : ""} générée{st.images_used_24h > 1 ? "s" : ""} en 24 h
          </p>
          <div className="rounded-xl border border-border bg-secondary/40 p-2.5">
            <p className="text-xs text-muted-foreground">Retours des membres sur les réponses</p>
            <p className="text-sm font-semibold">
              👍 {st.feedback.up_7d} · 👎 {st.feedback.down_7d} <span className="text-[11px] font-normal text-muted-foreground">sur 7 j</span>
            </p>
            <p className="text-[11px] text-muted-foreground">Total : 👍 {st.feedback.up} · 👎 {st.feedback.down}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(KIND_LABEL).map(([kind, label]) => {
              const k = st.by_kind[kind];
              if (!k) return null;
              return (
                <div key={kind} className="rounded-xl border border-border bg-secondary/40 p-2.5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{k.ok_24h}</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    24 h · {k.ok_7d} sur 7 j · {k.ok_30d} sur 30 j
                    {k.errors_24h > 0 && <span className="text-destructive"> · {k.errors_24h} erreur{k.errors_24h > 1 ? "s" : ""}</span>}
                    {k.limited_24h > 0 && <span> · {k.limited_24h} limité{k.limited_24h > 1 ? "s" : ""}</span>}
                  </p>
                </div>
              );
            })}
          </div>
          {st.recent_errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Dernières erreurs</p>
              {st.recent_errors.map((e, i) => (
                <p key={i} className="break-words text-[11px] text-muted-foreground">
                  <span className="font-semibold">{KIND_LABEL[e.kind] ?? e.kind}</span> · {timeAgo(e.created_at)} · {e.detail ?? "erreur inconnue"}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        disabled={postBusy}
        className={btn}
        onClick={async () => {
          setPostBusy(true);
          try {
            await api("/admin/kora/post-now", { method: "POST" });
            toast.success("Kora a publié un post");
            void qc.invalidateQueries();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setPostBusy(false);
          }
        }}
      >
        Publier un post de Kora maintenant
      </button>
    </div>
  );
}
