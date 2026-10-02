import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsShell } from "@/components/SettingsShell";
import { changePassword } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/parametres/mot-de-passe")({
  head: () => ({ meta: [{ title: "Changer de mot de passe — Kalchat" }] }),
  component: PasswordPage,
});

function PasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const save = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      toast.success("Mot de passe modifié");
      setCurrent(""); setNext(""); setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tooShort = next.length > 0 && next.length < 6;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSave = !!current && next.length >= 6 && next === confirm && !save.isPending;
  const field = "w-full rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";

  return (
    <SettingsShell title="Changer de mot de passe">
      <form onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }} className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Mot de passe actuel" className={field} />
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Nouveau mot de passe (6 caractères minimum)" className={field} />
        {tooShort && <p className="text-xs text-destructive">6 caractères minimum.</p>}
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmer le nouveau mot de passe" className={field} />
        {mismatch && <p className="text-xs text-destructive">Les deux mots de passe ne correspondent pas.</p>}
        <button disabled={!canSave} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
        </button>
      </form>
    </SettingsShell>
  );
}
