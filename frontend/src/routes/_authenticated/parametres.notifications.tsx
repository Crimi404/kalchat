import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { api } from "@/lib/api";
import { disablePush, enablePush, pushAvailable, pushPermission, storedPushToken } from "@/lib/push";

export const Route = createFileRoute("/_authenticated/parametres/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Kalchat" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const inApp = pushAvailable();
  const server = useQuery({ queryKey: ["pushStatus"], queryFn: () => api<{ enabled: boolean; devices: number; config_error?: string | null }>("/push/status") });
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

  const on = active && permission === "granted";

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
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "brand-gradient text-primary-foreground" : "bg-secondary text-muted-foreground"}`}><BellRing className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">{on ? "Activées sur cet appareil" : "Désactivées sur cet appareil"}</p>
              <p className="text-xs text-muted-foreground">Messages, mentions, commentaires, likes et abonnements.</p>
            </div>
          </div>

          {permission === "denied" && (
            <p className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
              Tu as refusé les notifications. Pour les réactiver : Paramètres Android › Applications › Kalchat › Notifications.
            </p>
          )}

          {on ? (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={() => run(async () => { const r = await api<{ sent: number }>("/push/test", { method: "POST" }); if (r.sent > 0) toast.success("Notification de test envoyée"); else toast.error("Aucun appareil joignable, réactive les notifications"); })}
                className="brand-gradient rounded-full px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
              >
                Envoyer un test
              </button>
              <button disabled={busy} onClick={() => run(async () => { await disablePush(); toast.success("Notifications désactivées sur cet appareil"); })} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60">
                Désactiver
              </button>
            </div>
          ) : (
            permission !== "denied" && (
              <button
                disabled={busy}
                onClick={() => run(async () => { const r = await enablePush(); if (r === "granted") toast.success("Notifications activées 🔔"); else toast.error("Autorisation refusée"); })}
                className="brand-gradient flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Activer les notifications
              </button>
            )
          )}
        </section>
      )}
    </SettingsShell>
  );
}
