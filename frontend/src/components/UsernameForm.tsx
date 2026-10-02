import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { api, setToken } from "@/lib/api";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function UsernameForm() {
  const { profile, refresh } = useAuth();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-60";

  if (!profile) return null;
  // Le serveur reste juge ; on utilise la même règle ici pour désactiver le formulaire.
  const lockedUntil = profile.username_next_change_at && new Date(profile.username_next_change_at) > new Date() ? profile.username_next_change_at : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const wanted = username.trim().replace(/^@/, "").toLowerCase();
    if (!USERNAME_RE.test(wanted)) {
      setError("3 à 20 caractères : minuscules, chiffres et _ uniquement");
      return;
    }
    if (wanted === profile!.username) {
      setError("C'est déjà ton nom d'utilisateur");
      return;
    }
    if (!password) {
      setError("Entre ton mot de passe pour confirmer");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ token: string; username: string }>("/users/me/username", {
        method: "POST",
        body: { username: wanted, password },
      });
      setToken(res.token); // nouveau jeton avec le nouveau pseudo
      await refresh();
      void qc.invalidateQueries();
      setUsername("");
      setPassword("");
      toast.success(`Ton nom d'utilisateur est maintenant @${res.username}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">Nom d'utilisateur actuel</p>
        <p className="text-sm font-semibold text-foreground">@{profile.username}</p>
      </div>

      {lockedUntil ? (
        <p className="rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          Tu as changé ton nom d'utilisateur récemment. Tu pourras le modifier de nouveau à partir du{" "}
          <span className="font-semibold text-foreground">{formatDate(lockedUntil)}</span>.
        </p>
      ) : (
        <>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
            <input
              className={`${field} pl-7`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nouveau_nom"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={21}
              disabled={saving}
            />
          </div>
          <input
            className={field}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe (pour confirmer)"
            autoComplete="current-password"
            disabled={saving}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={saving || !username.trim()}
            className="brand-gradient w-full rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Changer mon nom d'utilisateur"}
          </button>
          <p className="text-[11px] leading-snug text-muted-foreground">
            3 à 20 caractères : minuscules, chiffres et _. Tu ne pourras le changer qu'une fois tous les 60 jours.
          </p>
        </>
      )}
    </form>
  );
}
