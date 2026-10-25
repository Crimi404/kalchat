import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChoiceSheet } from "@/components/ChoiceSheet";
import { useAuth } from "@/lib/auth";
import { updateSettings } from "@/lib/settings";
import { PREVIEW_CHOICE_EVENT, type PreviewChoiceDetail } from "@/lib/previewChoice";

/** Feuille « Afficher un aperçu avec ma photo ? », montée une seule fois pour toute l'appli. */
export function PreviewChoiceHost() {
  const { refresh } = useAuth();
  const [pending, setPending] = useState<PreviewChoiceDetail | null>(null);

  useEffect(() => {
    const onAsk = (e: Event) => setPending((e as CustomEvent<PreviewChoiceDetail>).detail);
    window.addEventListener(PREVIEW_CHOICE_EVENT, onAsk);
    return () => window.removeEventListener(PREVIEW_CHOICE_EVENT, onAsk);
  }, []);

  const enable = useMutation({
    mutationFn: () => updateSettings({ public_preview: true }),
    onSuccess: async () => { await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!pending) return null;
  const finish = () => { const { run } = pending; setPending(null); run(); };

  return (
    <ChoiceSheet<"yes" | "no">
      title="Aperçu du lien"
      description="Quand ce lien est partagé (WhatsApp, etc.), veux-tu afficher ta couverture, ta photo, ton nom et ta bio ? Tu pourras changer ce choix à tout moment dans Confidentialité."
      options={[
        { value: "yes", label: "Oui, afficher un aperçu", hint: "Couverture, photo, nom et bio visibles pour toute personne qui reçoit le lien" },
        { value: "no", label: "Non, carte neutre Kalchat", hint: "Aucune information personnelle dans l'aperçu" },
      ]}
      value="no"
      pending={enable.isPending}
      onSelect={(v) => {
        if (v === "yes") enable.mutate(undefined, { onSuccess: finish });
        else finish();
      }}
      onClose={() => setPending(null)}
    />
  );
}
