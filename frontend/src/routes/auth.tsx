import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { takeDestination } from "@/lib/share";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { uploadFile } from "@/lib/api";
import { fetchAuthConfig, forgotPassword, registerResend, registerStart, registerVerify, resetPassword } from "@/lib/email";
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

const emailSchema = z.string().trim().toLowerCase().email("Adresse email invalide").max(254);

const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Au moins 8 caractères").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas" });

const signInSchema = z.object({
  username: z.string().trim().min(1, "Nom d'utilisateur ou email requis"),
  password: z.string().min(1, "Mot de passe requis"),
});

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const { signIn, signUp, signInWithToken } = useAuth();
  const cfg = useQuery({ queryKey: ["authConfig"], queryFn: fetchAuthConfig, staleTime: 5 * 60 * 1000, retry: false });
  const emailSignup = cfg.data?.email_signup === true;

  // Après connexion : retour vers la page d'un lien partagé, sinon accueil
  function goAfterAuth() {
    const dest = takeDestination();
    if (dest) router.history.replace(dest);
    else navigate({ to: "/", replace: true });
  }
  const [mode, setMode] = useState<"signin" | "signup" | "otp" | "forgot" | "reset">("signin");
  const [draft, setDraft] = useState({ first_name: "", last_name: "", username: "", email: "" }); // champs gardés si on revient en arrière
  const [otpEmail, setOtpEmail] = useState("");
  const [code, setCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
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
    let email = "";
    if (emailSignup) {
      const em = emailSchema.safeParse(String(form.get("email") ?? ""));
      if (!em.success) {
        setErrors({ email: em.error.issues[0].message });
        return;
      }
      email = em.data;
    }
    setErrors({});
    setLoading(true);
    try {
      const photo = form.get("avatar");
      let avatar_url: string | null = null;
      if (photo instanceof File && photo.size > 0) avatar_url = (await uploadFile(photo)).url;
      const { first_name, last_name, username, password } = parsed.data;
      if (emailSignup) {
        // Étape 1 : on envoie un code par email ; le compte n'est créé qu'une fois le code saisi
        await registerStart({ first_name, last_name, username, password, email, avatar_url });
        setDraft({ first_name, last_name, username, email });
        setOtpEmail(email);
        setCode("");
        setCooldown(60);
        setMode("otp");
        toast.success("Code envoyé, regarde ta boîte mail (et les spams)");
      } else {
        await signUp({ first_name, last_name, username, password, avatar_url });
        goAfterAuth();
      }
    } catch (err) {
      const message = (err as Error).message;
      if (/déjà pris|nom d'utilisateur/i.test(message)) setErrors({ username: message });
      else if (/email/i.test(message)) setErrors({ email: message });
      else toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    try {
      const res = await registerVerify(otpEmail, code);
      await signInWithToken(res.token);
      toast.success("Bienvenue sur Kalchat 🎉");
      goAfterAuth();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    setLoading(true);
    try {
      await registerResend(otpEmail);
      setCooldown(60);
      toast.success("Nouveau code envoyé");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ----- Mot de passe oublié -----
  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("identifier") ?? "").trim();
    if (!value) {
      setErrors({ identifier: "Entre ton pseudo ou ton email" });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await forgotPassword(value);
      setIdentifier(value);
      setCode("");
      setCooldown(60);
      setMode("reset");
      toast.success("Si un compte correspond, un code vient d'être envoyé par email");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function resendReset() {
    setLoading(true);
    try {
      await forgotPassword(identifier);
      setCooldown(60);
      toast.success("Si un compte correspond, un nouveau code vient d'être envoyé");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = newPasswordSchema.safeParse({ password: String(form.get("password") ?? ""), confirm: String(form.get("confirm") ?? "") });
    if (!parsed.success) {
      collectErrors(parsed.error.issues);
      return;
    }
    if (code.length !== 6) {
      setErrors({ code: "Le code contient 6 chiffres" });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await resetPassword(identifier, code, parsed.data.password);
      await signInWithToken(res.token);
      toast.success("Mot de passe modifié, te voilà connecté ✅");
      goAfterAuth();
    } catch (err) {
      toast.error((err as Error).message);
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

  const isMain = mode === "signin" || mode === "signup";
  const titles: Record<typeof mode, [string, string]> = {
    signin: ["Content de te revoir", "Connecte-toi à ta communauté"],
    signup: ["Rejoins Kalchat", "Ta vibe, ta communauté"],
    otp: ["Vérifie ton email", "Un dernier pas pour créer ton compte"],
    forgot: ["Mot de passe oublié", "On t'envoie un code par email"],
    reset: ["Nouveau mot de passe", "Entre le code reçu et choisis-en un nouveau"],
  };

  return (
    <AuthShell
      title={titles[mode][0]}
      subtitle={titles[mode][1]}
      footer={
        mode === "signin" ? (
          <>
            Pas encore de compte ?{" "}
            <button onClick={() => { setMode("signup"); setErrors({}); }} className="font-semibold text-primary">
              Crée-le ici
            </button>
          </>
        ) : mode === "signup" ? (
          <>
            Déjà inscrit ?{" "}
            <button onClick={() => { setMode("signin"); setErrors({}); }} className="font-semibold text-primary">
              Connexion
            </button>
          </>
        ) : (
          <button onClick={() => { setMode("signin"); setErrors({}); setCode(""); }} className="font-semibold text-primary">
            ← Retour à la connexion
          </button>
        )
      }
    >
      {isMain && (
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
      )}

      {mode === "otp" && (
        <form onSubmit={handleOtp} className="space-y-3">
          <p className="text-sm text-foreground">Un code à 6 chiffres a été envoyé à <b>{otpEmail}</b>. Il est valable 15 minutes.</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            className={`${fieldClass} text-center text-2xl font-bold tracking-[0.5em]`}
          />
          <button type="submit" disabled={loading || code.length !== 6} className={primaryButtonClass}>
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Un instant…</span> : "Valider et créer mon compte"}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" disabled={cooldown > 0 || loading} onClick={resendOtp} className="font-semibold text-primary disabled:text-muted-foreground">
              {cooldown > 0 ? `Renvoyer le code (${cooldown} s)` : "Renvoyer le code"}
            </button>
            <button type="button" onClick={() => { setMode("signup"); setCode(""); }} className="font-semibold text-muted-foreground hover:text-foreground">Modifier mes infos</button>
          </div>
        </form>
      )}

      {mode === "forgot" && (
        <form onSubmit={handleForgot} className="space-y-3">
          <p className="text-xs text-muted-foreground">Entre ton pseudo ou ton adresse email. Si ton compte a une adresse vérifiée, tu reçois un code pour choisir un nouveau mot de passe.</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="identifier">Pseudo ou email</label>
            <input id="identifier" name="identifier" autoCapitalize="none" autoComplete="username" className={fieldClass} />
            {errors["identifier"] && <p className="mt-1 text-xs text-destructive">{errors["identifier"]}</p>}
          </div>
          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Un instant…</span> : "Envoyer le code"}
          </button>
        </form>
      )}

      {mode === "reset" && (
        <form onSubmit={handleReset} className="space-y-3">
          <p className="text-xs text-muted-foreground">Si un compte correspond à <b>{identifier}</b>, un code à 6 chiffres vient d'être envoyé à son adresse email.</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="code">Code reçu par email</label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className={`${fieldClass} text-center text-xl font-bold tracking-[0.4em]`}
            />
            {errors["code"] && <p className="mt-1 text-xs text-destructive">{errors["code"]}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="password">Nouveau mot de passe</label>
            <input id="password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" className={fieldClass} />
            {errors["password"] && <p className="mt-1 text-xs text-destructive">{errors["password"]}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="confirm">Confirme le mot de passe</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" placeholder="••••••••" className={fieldClass} />
            {errors["confirm"] && <p className="mt-1 text-xs text-destructive">{errors["confirm"]}</p>}
          </div>
          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Un instant…</span> : "Changer mon mot de passe"}
          </button>
          <button type="button" disabled={cooldown > 0 || loading} onClick={resendReset} className="w-full text-xs font-semibold text-primary disabled:text-muted-foreground">
            {cooldown > 0 ? `Renvoyer le code (${cooldown} s)` : "Renvoyer le code"}
          </button>
        </form>
      )}

      {isMain && (
      <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-3" key={mode}>
        {mode === "signup" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="first_name">Prénom</label>
              <input id="first_name" name="first_name" autoComplete="given-name" defaultValue={draft.first_name} className={fieldClass} />
              {errors["first_name"] && <p className="mt-1 text-xs text-destructive">{errors["first_name"]}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="last_name">Nom</label>
              <input id="last_name" name="last_name" autoComplete="family-name" defaultValue={draft.last_name} className={fieldClass} />
              {errors["last_name"] && <p className="mt-1 text-xs text-destructive">{errors["last_name"]}</p>}
            </div>
          </div>
        )}

        {mode === "signup" && emailSignup && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="email">Adresse email</label>
            <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" placeholder="ton.adresse@exemple.com" defaultValue={draft.email} className={fieldClass} />
            <p className="mt-1 text-[11px] text-muted-foreground">Tu recevras un code pour confirmer ton adresse. Elle reste privée.</p>
            {errors["email"] && <p className="mt-1 text-xs text-destructive">{errors["email"]}</p>}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="username">
            {mode === "signin" ? "Nom d'utilisateur ou email" : "Nom d'utilisateur"}
          </label>
          <div className="relative">
            {mode === "signup" && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>}
            <input id="username" name="username" autoComplete="username" autoCapitalize="none" placeholder={mode === "signin" ? "pseudo ou email" : "kalifa"} defaultValue={mode === "signup" ? draft.username : undefined} className={mode === "signup" ? `${fieldClass} pl-8` : fieldClass} />
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
          emailSignup ? (
            <p className="text-right text-xs">
              <button type="button" onClick={() => { setMode("forgot"); setErrors({}); }} className="font-semibold text-primary">Mot de passe oublié ?</button>
            </p>
          ) : (
            <p className="text-right text-xs text-muted-foreground">Mot de passe oublié ? Contacte un administrateur.</p>
          )
        )}

        <button type="submit" disabled={loading || (mode === "signup" && cfg.isLoading)} className={primaryButtonClass}>
          {loading ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Un instant…</span>
          ) : mode === "signin" ? (
            "Se connecter"
          ) : emailSignup ? (
            "Recevoir mon code"
          ) : (
            "Créer mon compte"
          )}
        </button>
      </form>
      )}
    </AuthShell>
  );
}
