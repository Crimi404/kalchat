import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Heart, Loader2, MessageCircle, UserPlus, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { disablePush, enablePush, pushAvailable, pushPermission, storedPushToken } from "@/lib/push";

export const Route = createFileRoute("/_authenticated/parametres/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Kalchat" }] }),
  component: NotificationsPage,
});

type Prefs = { messages: boolean; publications: boolean; abonnements: boolean };
type PrefKey = keyof Prefs;

const CATEGORIES: { key: PrefKey; title: string; description: string; icon: LucideIcon }[] = [
  { key: "messages", title: "Messages", description: "Nouveaux messages, demandes de message et ajouts à un groupe", icon: MessageCircle },
  { key: "publications", title: "Publications", description: "Likes, commentaires, réponses, mentions et repartages", icon: Heart },
  { key: "abonnements", title: "Abonnements", description: "Demandes d'abonnement et demandes acceptées", icon: UserPlus },
];

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-2 py-3.5">
      <Icon className="h-6 w-6 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function NotificationsPage() {
  const qc = useQueryClient();
  const inApp = pushAvailable();
  const server = useQuery({ queryKey: ["pushStatus"], queryFn: () => api<{ enabled: boolean; devices: number; config_error?: string | null }>("/push/status") });
  const prefsQ = useQuery({ queryKey: ["pushPrefs"], queryFn: () => api<Prefs>("/push/prefs"), enabled: inApp });
  const [permission, setPermission] = useState<string>("unavailable");
  const [active, setActive] = useState(!!storedPushToken());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPermission(await pushPermission());
    setActive(!!storedPushToken());
    void server.refetch();
  }, [server]);

  useEffect(() => {
    if (inApp) void pushPermission().then(setPermission);
  }, [inApp]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try { await task(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); void refresh(); }
  }

  const savePrefs = useMutation({
    mutationFn: (patch: Partial<Prefs>) => api<Prefs>("/push/prefs", { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["pushPrefs"] });
      const previous = qc.getQueryData<Prefs>(["pushPrefs"]);
      if (previous) qc.setQueryData<Prefs>(["pushPrefs"], { ...previous, ...patch });
      return { previous };
    },
    onError: (e: Error, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(["pushPrefs"], ctx.previous);
      toast.error(e.message);
    },
    onSuccess: (data) => qc.setQueryData(["pushPrefs"], data),
  });

  const on = active && permission === "granted";
  const prefs = prefsQ.data;
  const all = !!prefs && prefs.messages && prefs.publications && prefs.abonnements;
  const typesDisabled = !on || !prefs;

  function toggleDevice(next: boolean) {
    if (next) {
      void run(async () => {
        const r = await enablePush();
        if (r === "granted") toast.success("Notifications activées 🔔");
        else toast.error("Autorisation refusée");
      });
    } else {
      void run(async () => {
        await disablePush();
        toast.success("Notifications désactivées sur cet appareil");
      });
    }
  }

  return (
    <SettingsShell title="Notifications">
      {!inApp ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Les notifications push (messages, likes, abonnements…) fonctionnent dans l'application Android Kalchat. Ouvre Kalchat depuis l'appli pour les activer.
        </p>
      ) : server.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : !server.data?.enabled ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <p>Les notifications ne sont pas encore activées sur le serveur. Reviens bientôt !</p>
          {server.data?.config_error && <p className="text-xs text-destructive">{server.data.config_error}</p>}
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-card p-2">
            <div className="flex items-center gap-4 px-2 py-3.5">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "brand-gradient text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                <Bell className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">Activer les notifications</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {on ? "Activées sur cet appareil" : "Désactivées sur cet appareil"}
                </p>
              </div>
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Switch checked={on} disabled={permission === "denied" && !on} onCheckedChange={toggleDevice} aria-label="Activer les notifications" />
              )}
            </div>
            {permission === "denied" && (
              <p className="mx-2 mb-2 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
                Tu as refusé les notifications. Pour les réactiver : Paramètres Android › Applications › Kalchat › Notifications.
              </p>
            )}
          </section>

          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Types de notifications</p>
          <section className={`divide-y divide-border rounded-2xl border border-border bg-card p-2 transition-opacity ${typesDisabled ? "opacity-60" : ""}`}>
            <ToggleRow
              icon={BellRing}
              title="Tout"
              description="Active ou désactive tous les types ci-dessous"
              checked={all}
              disabled={typesDisabled}
              onChange={(v) => savePrefs.mutate({ messages: v, publications: v, abonnements: v })}
            />
            {CATEGORIES.map((c) => (
              <ToggleRow
                key={c.key}
                icon={c.icon}
                title={c.title}
                description={c.description}
                checked={prefs ? prefs[c.key] : true}
                disabled={typesDisabled}
                onChange={(v) => savePrefs.mutate({ [c.key]: v })}
              />
            ))}
          </section>

          <p className="px-1 text-xs leading-snug text-muted-foreground">
            Ces réglages concernent les notifications sur ton téléphone. Tu retrouves toujours toutes tes notifications dans l'onglet Notifications de l'appli. Les avertissements de la modération sont toujours envoyés.
          </p>

          {on && (
            <button
              disabled={busy}
              onClick={() => run(async () => {
                const r = await api<{ sent: number }>("/push/test", { method: "POST" });
                if (r.sent > 0) toast.success("Notification de test envoyée");
                else toast.error("Aucun appareil joignable, réactive les notifications");
              })}
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
            >
              Envoyer une notification de test
            </button>
          )}
        </>
      )}
    </SettingsShell>
  );
}
