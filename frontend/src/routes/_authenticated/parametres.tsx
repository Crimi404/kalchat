import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { api, setToken } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";

export const Route = createFileRoute("/_authenticated/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres — Kalchat" },
      { name: "description", content: "Apparence et compte Kalchat." },
    ],
  }),
  component: ParametresPage,
});

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ThemeChoice({ value, label, icon: Icon, swatch }: { value: Theme; label: string; icon: typeof Sun; swatch: { bg: string; fg: string; bar: string } }) {
  const { theme, setTheme } = useTheme();
  const selected = theme === value;
  return (
    <button
      type="button"
      onClick={() => void setTheme(value)}
      aria-pressed={selected}
      className={`relative rounded-2xl border p-3 text-left transition-colors ${selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:bg-secondary"}`}
    >
      <span className="mb-2 block h-14 rounded-xl border border-border p-2" style={{ background: swatch.bg }}>
        <span className="block h-2 w-10 rounded-full" style={{ background: swatch.fg }} />
        <span className="mt-1.5 block h-2 w-16 rounded-full" style={{ background: swatch.bar }} />
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      {selected && (
        <span className="brand-gradient absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

function UsernameForm() {
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

function ParametresPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function handleSignOut() {
    await qc.cancelQueries();
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="app-shell">
      <TopBar title="Paramètres" subtitle={profile ? `@${profile.username}` : ""} />
      <main className="space-y-4 px-4 pb-28 pt-4">
        <Section title="Apparence">
          <div className="grid grid-cols-2 gap-3">
            <ThemeChoice value="dark" label="Sombre" icon={Moon} swatch={{ bg: "#17112a", fg: "#f3f0fb", bar: "#6d4fe0" }} />
            <ThemeChoice value="light" label="Clair" icon={Sun} swatch={{ bg: "#fbfaff", fg: "#241c3d", bar: "#8b6cf0" }} />
          </div>
        </Section>

        <Section title="Compte">
          <UsernameForm />
        </Section>

        <button
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-sm font-semibold text-destructive transition-colors hover:bg-secondary"
        >
          <LogOut className="h-4 w-4" /> Se déconnecter
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
