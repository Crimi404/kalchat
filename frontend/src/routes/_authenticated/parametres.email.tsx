import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { fetchEmailStatus, requestEmailCode, verifyEmailCode } from "@/lib/email";

export const Route = createFileRoute("/_authenticated/parametres/email")({
  head: () => ({ meta: [{ title: "Adresse email — Kalchat" }] }),
  component: EmailPage,
});

function EmailPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["emailStatus"], queryFn: fetchEmailStatus });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null); // adresse à laquelle un code vient d'être envoyé
  const [changing, setChanging] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = useMutation({
    mutationFn: (addr: string) => requestEmailCode(addr),
    onSuccess: (_d, addr) => {
      setSentTo(addr.trim().toLowerCase());
      setCode("");
      setCooldown(60);
      toast.success("Code envoyé, regarde ta boîte mail (et les spams)");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: () => verifyEmailCode(code),
    onSuccess: () => {
      toast.success("Adresse email vérifiée ✅");
      setSentTo(null);
      setChanging(false);
      setEmail("");
      setCode("");
      void qc.invalidateQueries({ queryKey: ["emailStatus"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = status.data;

  return (
    <SettingsShell title="Adresse email">
      {status.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : status.isError ? (
        <p className="py-10 text-center text-sm text-destructive">{(status.error as Error).message}</p>
      ) : !s?.enabled ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          La vérification par email n'est pas encore disponible. Reviens bientôt !
        </p>
      ) : s.verified && !changing ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Adresse vérifiée</p>
              <p className="truncate text-sm text-muted-foreground">{s.email}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Ton adresse reste privée : elle n'apparaît jamais sur ton profil.</p>
          <button onClick={() => setChanging(true)} className="rounded-full border border-border px-4 py-2 text-xs font-semibold hover:bg-secondary">Changer d'adresse</button>
        </section>
      ) : sentTo ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-foreground">Un code à 6 chiffres a été envoyé à <b>{sentTo}</b>. Il est valable 15 minutes.</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            className="w-full rounded-xl border border-border bg-secondary/40 px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-foreground outline-none focus:border-primary"
          />
          <button
            disabled={code.length !== 6 || verify.isPending}
            onClick={() => verify.mutate()}
            className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {verify.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Vérifier
          </button>
          <div className="flex items-center justify-between text-xs">
            <button disabled={cooldown > 0 || sendCode.isPending} onClick={() => sendCode.mutate(sentTo)} className="font-semibold text-primary disabled:text-muted-foreground">
              {cooldown > 0 ? `Renvoyer le code (${cooldown} s)` : "Renvoyer le code"}
            </button>
            <button onClick={() => { setSentTo(null); setCode(""); }} className="font-semibold text-muted-foreground hover:text-foreground">Changer d'adresse</button>
          </div>
        </section>
      ) : (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground"><Mail className="h-5 w-5" /></span>
            <p className="text-sm text-muted-foreground">Ajoute ton adresse email pour sécuriser ton compte. Tu recevras un code à 6 chiffres à saisir ici.</p>
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="ton.adresse@exemple.com"
            className="w-full rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            disabled={!email.includes("@") || sendCode.isPending}
            onClick={() => sendCode.mutate(email)}
            className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {sendCode.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Envoyer le code
          </button>
          {changing && <button onClick={() => setChanging(false)} className="w-full text-xs font-semibold text-muted-foreground hover:text-foreground">Annuler</button>}
        </section>
      )}
    </SettingsShell>
  );
}
