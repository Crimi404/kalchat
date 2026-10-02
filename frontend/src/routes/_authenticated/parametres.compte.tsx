import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { UsernameForm } from "@/components/UsernameForm";
import { useAuth } from "@/lib/auth";
import { deleteMyAccount } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/parametres/compte")({
  head: () => ({ meta: [{ title: "Informations du compte — Kalchat" }] }),
  component: AccountPage,
});

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function AccountPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");

  const del = useMutation({
    mutationFn: () => deleteMyAccount(password),
    onSuccess: async () => {
      await qc.cancelQueries();
      await signOut();
      toast.success("Ton compte a été supprimé");
      navigate({ to: "/auth", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!profile) return null;
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Non renseigné";
  const since = new Date(profile.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <SettingsShell title="Informations du compte">
      <section className="rounded-2xl border border-border bg-card px-4 py-1">
        <Info label="Nom d'utilisateur" value={`@${profile.username}`} />
        <Info label="Nom" value={fullName} />
        <Info label="Membre depuis" value={since} />
        {profile.location && <Info label="Localisation" value={profile.location} />}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold text-foreground">Changer mon nom d'utilisateur</h2>
        <UsernameForm />
      </section>

      <section className="rounded-2xl border border-destructive/40 bg-card p-4">
        <h2 className="text-sm font-bold text-destructive">Supprimer mon compte</h2>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          Action définitive : ton profil, tes publications, tes commentaires et tes messages sont effacés. Tes conversations privées sont supprimées pour les deux personnes.
        </p>
        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" /> Supprimer mon compte
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Entre ton mot de passe pour confirmer"
              autoComplete="current-password"
              className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm text-foreground outline-none focus:border-destructive"
            />
            <div className="flex gap-2">
              <button onClick={() => { setConfirming(false); setPassword(""); }} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">Annuler</button>
              <button
                disabled={!password || del.isPending}
                onClick={() => { if (window.confirm("Supprimer définitivement ton compte ? Cette action est irréversible.")) del.mutate(); }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground disabled:opacity-50"
              >
                {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Supprimer
              </button>
            </div>
          </div>
        )}
      </section>
    </SettingsShell>
  );
}
