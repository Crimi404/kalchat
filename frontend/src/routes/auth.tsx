import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { takeDestination } from "@/lib/share";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { uploadFile } from "@/lib/api";
import { AuthShell, fieldClass, primaryButtonClass } from "@/components/AuthShell";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion & inscription — Kalchat" },
      { name: "description", content: "Rejoins Kalchat : crée ton compte ou connecte-toi pour retrouver ta communauté." },
      { property: "og:title", content: "Connexion & inscription — Kalchat" },
      { property: "og:description", content: "Crée ton compte Kalchat en quelques secondes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Le nom d'utilisateur doit faire au moins 3 caractères")
  .max(20, "20 caractères maximum")
  .regex(/^[a-z0-9_]+$/, "Lettres minuscules, chiffres et _ uniquement");

const signUpSchema = z
  .object({
    first_name: z.string().trim().min(1, "Prénom requis").max(30),
    last_name: z.string().trim().min(1, "Nom requis").max(30),
    username: usernameSchema,
    password: z.string().min(8, "Au moins 8 caractères").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Les mots de passe ne correspondent pas",
  });

const signInSchema = z.object({
  username: z.string().trim().min(1, "Nom d'utilisateur requis"),
  password: z.string().min(1, "Mot de passe requis"),
});

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  // Après connexion : retour vers la page d'un lien partagé, sinon accueil
  function goAfterAuth() {
    const dest = takeDestination();
    if (dest) router.history.replace(dest);
    else navigate({ to: "/", replace: true });
  }
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function collectErrors(issues: { path: PropertyKey[]; message: string }[]) {
    const map: Record<string, string> = {};
    for (const issue of issues) map[String(issue.path[0])] = issue.message;
    setErrors(map);
  }

  async function handleSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signUpSchema.safeParse({
      first_name: String(form.get("first_name") ?? ""),
      last_name: String(form.get("last_name") ?? ""),
      username: String(form.get("username") ?? "").toLowerCase(),
      password: String(form.get("password") ?? ""),
      confirm: String(form.get("confirm") ?? ""),
    });
    if (!parsed.success) {
      collectErrors(parsed.error.issues);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const photo = form.get("avatar");
      let avatar_url: string | null = null;
      if (photo instanceof File && photo.size > 0) avatar_url = (await uploadFile(photo)).url;
      const { first_name, last_name, username, password } = parsed.data;
      await signUp({ first_name, last_name, username, password, avatar_url });
      goAfterAuth();
    } catch (err) {
      const message = (err as Error).message;
      if (/déjà pris/i.test(message)) setErrors({ username: message });
      else toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (!parsed.success) {
      collectErrors(parsed.error.issues);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await signIn(parsed.data.username, parsed.data.password);
      goAfterAuth();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={mode === "signin" ? "Content de te revoir" : "Rejoins Kalchat"}
      subtitle={mode === "signin" ? "Connecte-toi à ta communauté" : "Ta vibe, ta communauté"}
      footer={
        mode === "signin" ? (
          <>
            Pas encore de compte ?{" "}
            <button onClick={() => { setMode("signup"); setErrors({}); }} className="font-semibold text-primary">
              Crée-le ici
            </button>
          </>
        ) : (
          <>
            Déjà inscrit ?{" "}
            <button onClick={() => { setMode("signin"); setErrors({}); }} className="font-semibold text-primary">
              Connexion
            </button>
          </>
        )
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-secondary/40 p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setErrors({}); }}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === m ? "brand-gradient text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {m === "signin" ? "Connexion" : "Inscription"}
          </button>
        ))}
      </div>

      <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-3" key={mode}>
        {mode === "signup" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="first_name">Prénom</label>
              <input id="first_name" name="first_name" autoComplete="given-name" className={fieldClass} />
              {errors["first_name"] && <p className="mt-1 text-xs text-destructive">{errors["first_name"]}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="last_name">Nom</label>
              <input id="last_name" name="last_name" autoComplete="family-name" className={fieldClass} />
              {errors["last_name"] && <p className="mt-1 text-xs text-destructive">{errors["last_name"]}</p>}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="username">
            Nom d'utilisateur
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
            <input id="username" name="username" autoComplete="username" autoCapitalize="none" placeholder="kalifa" className={`${fieldClass} pl-8`} />
          </div>
          {errors["username"] && <p className="mt-1 text-xs text-destructive">{errors["username"]}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="password">
            Mot de passe
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="••••••••"
              className={`${fieldClass} pr-11`}
            />
            <button
              type="button"
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors["password"] && <p className="mt-1 text-xs text-destructive">{errors["password"]}</p>}
        </div>

        {mode === "signup" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="confirm">
                Confirme le mot de passe
              </label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" placeholder="••••••••" className={fieldClass} />
              {errors["confirm"] && <p className="mt-1 text-xs text-destructive">{errors["confirm"]}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="avatar">
                Photo de profil (facultatif)
              </label>
              <input id="avatar" name="avatar" type="file" accept="image/*" className="block w-full text-xs text-muted-foreground" />
            </div>
          </>
        )}

        {mode === "signin" && (
          <p className="text-right text-xs text-muted-foreground">Mot de passe oublié ? Contacte un administrateur.</p>
        )}

        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Un instant…</span>
          ) : mode === "signin" ? (
            "Se connecter"
          ) : (
            "Créer mon compte"
          )}
        </button>
      </form>
    </AuthShell>
  );
}
