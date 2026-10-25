import { createFileRoute } from "@tanstack/react-router";
import { CornerDownLeft, Palette } from "lucide-react";
import { SettingRow, SettingsShell } from "@/components/SettingsShell";
import { ChatThemeEditor } from "@/components/ChatThemeEditor";
import { chatThemeSupported } from "@/lib/chatTheme";
import { useEnterToSend } from "@/lib/inputPrefs";

export const Route = createFileRoute("/_authenticated/parametres/discussions")({
  head: () => ({ meta: [{ title: "Discussions — Kalchat" }] }),
  component: DiscussionsPage,
});

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </span>
  );
}

function DiscussionsPage() {
  const [enterToSend, setEnterToSend] = useEnterToSend();
  return (
    <SettingsShell title="Discussions">
      <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saisie</p>
      <section className="rounded-2xl border border-border bg-card p-2">
        <SettingRow
          icon={CornerDownLeft}
          title="Entrée pour envoyer"
          description={enterToSend ? "La touche Entrée envoie ton message. Maj + Entrée passe à la ligne." : "Désactivé : la touche Entrée passe à la ligne. Tu envoies avec le bouton."}
          onClick={() => setEnterToSend(!enterToSend)}
          right={<Toggle on={enterToSend} />}
        />
      </section>

      <p className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fond des discussions</p>
      {chatThemeSupported() ? (
        <>
          <p className="px-1 text-sm leading-snug text-muted-foreground">Ce thème s'applique à toutes tes discussions. Tu peux aussi en choisir un différent pour une discussion précise, depuis son menu « ⋯ ».</p>
          <ChatThemeEditor scope={null} />
        </>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <Palette className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">Disponible dans l'application Android</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">Le fond personnalisé et la couleur des messages sont réservés à l'APK Kalchat.</p>
        </div>
      )}
    </SettingsShell>
  );
}
