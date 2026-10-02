import { ChoiceSheet } from "@/components/ChoiceSheet";
import { EPHEMERAL_OPTIONS } from "@/lib/settings";

/** Choix de la durée des messages éphémères d'une conversation. */
export function EphemeralSheet({ current, pending, onSelect, onClose }: { current: number; pending?: boolean; onSelect: (seconds: number) => void; onClose: () => void }) {
  return (
    <ChoiceSheet
      title="Messages éphémères"
      description="Les nouveaux messages de cette conversation disparaissent automatiquement après la durée choisie. Les messages déjà envoyés ne changent pas."
      options={EPHEMERAL_OPTIONS}
      value={current}
      pending={pending}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
