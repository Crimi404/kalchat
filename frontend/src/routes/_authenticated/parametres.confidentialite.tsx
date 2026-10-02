import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye, Timer, Wifi } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChoiceSheet } from "@/components/ChoiceSheet";
import { SettingRow, SettingsShell } from "@/components/SettingsShell";
import { useAuth } from "@/lib/auth";
import { EPHEMERAL_OPTIONS, PRESENCE_LABELS, ephemeralLabel, updateSettings, type PresenceMode, type SettingsPatch } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/parametres/confidentialite")({
  head: () => ({ meta: [{ title: "Confidentialité — Kalchat" }] }),
  component: PrivacyPage,
});

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </span>
  );
}

function PrivacyPage() {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<"presence" | "ephemeral" | null>(null);

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => updateSettings(patch),
    onSuccess: async () => {
      await refresh();
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      setSheet(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!profile) return null;

  return (
    <SettingsShell title="Confidentialité">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qui peut voir mes infos</p>
      <section className="rounded-2xl border border-border bg-card p-2">
        <SettingRow icon={Wifi} title="Présence en ligne" description={PRESENCE_LABELS[profile.privacy_online]} onClick={() => setSheet("presence")} />
      </section>

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Messagerie</p>
      <section className="rounded-2xl border border-border bg-card p-2">
        <SettingRow
          icon={Eye}
          title="Confirmations de lecture"
          description="Si tu les désactives, les autres ne verront plus quand tu as lu leurs messages (et inversement)."
          onClick={() => save.mutate({ read_receipts: !profile.read_receipts })}
          right={<Toggle on={profile.read_receipts} />}
        />
        <SettingRow
          icon={Timer}
          title="Messages éphémères"
          description={`Durée par défaut des nouvelles conversations : ${ephemeralLabel(profile.default_ephemeral)}. Tu peux aussi la régler dans chaque conversation.`}
          onClick={() => setSheet("ephemeral")}
        />
      </section>

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sécurité</p>
      <section className="rounded-2xl border border-border bg-card p-2">
        <SettingRow icon={Ban} title="Comptes bloqués" description="Gère les comptes que tu as bloqués" onClick={() => navigate({ to: "/parametres/bloques" })} />
      </section>

      {sheet === "presence" && (
        <ChoiceSheet<PresenceMode>
          title="Présence en ligne"
          description="Qui peut voir quand tu es en ligne. « Mes amis » = les membres avec qui tu as un abonnement accepté."
          options={(Object.keys(PRESENCE_LABELS) as PresenceMode[]).map((v) => ({ value: v, label: PRESENCE_LABELS[v] }))}
          value={profile.privacy_online}
          pending={save.isPending}
          onSelect={(v) => save.mutate({ privacy_online: v })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "ephemeral" && (
        <ChoiceSheet<number>
          title="Messages éphémères par défaut"
          description="S'applique aux nouvelles conversations que tu crées. Les conversations existantes ne changent pas."
          options={EPHEMERAL_OPTIONS}
          value={profile.default_ephemeral}
          pending={save.isPending}
          onSelect={(v) => save.mutate({ default_ephemeral: v })}
          onClose={() => setSheet(null)}
        />
      )}
    </SettingsShell>
  );
}
