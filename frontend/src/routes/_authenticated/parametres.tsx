import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Check, EyeOff, Lock, Mail, LogOut, Moon, ShieldCheck, Sun, UserRound } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/lib/auth";
import { SettingRow } from "@/components/SettingsShell";
import { useTheme, type Theme } from "@/lib/theme";

export const Route = createFileRoute("/_authenticated/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres — Kalchat" },
      { name: "description", content: "Apparence, compte et confidentialité Kalchat." },
    ],
  }),
  component: ParametresLayout,
});

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

function ParametresLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path.replace(/\/$/, "") !== "/parametres") return <Outlet />;
  return <ParametresPage />;
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

        <section className="rounded-2xl border border-border bg-card p-2">
          <SettingRow icon={UserRound} title="Informations du compte" description="Nom d'utilisateur, nom, date d'inscription et suppression du compte" onClick={() => navigate({ to: "/parametres/compte" })} />
          <SettingRow icon={Mail} title="Adresse email" description="Vérifie ton adresse pour récupérer ton mot de passe et te connecter" onClick={() => navigate({ to: "/parametres/email" })} />
          <SettingRow icon={Bell} title="Notifications" description="Active les notifications push sur ton téléphone" onClick={() => navigate({ to: "/parametres/notifications" })} />
          <SettingRow icon={EyeOff} title="Sujets masqués" description="Catégories de publications que tu ne veux plus voir dans ton fil" onClick={() => navigate({ to: "/parametres/sujets" })} />
          <SettingRow icon={Lock} title="Changer de mot de passe" description="Change de mot de passe à tout moment" onClick={() => navigate({ to: "/parametres/mot-de-passe" })} />
          <SettingRow icon={ShieldCheck} title="Confidentialité" description="Présence en ligne, accusés de lecture, messages éphémères et comptes bloqués" onClick={() => navigate({ to: "/parametres/confidentialite" })} />
        </section>

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
