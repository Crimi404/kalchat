import { RichText } from "@/components/RichText";
import { resolveFont, resolveTheme, themedTextSize } from "@/lib/themes";

/** Publication texte avec fond coloré (affichage dans le fil et sur la page d'un post). */
export function ThemedText({ text, theme, font }: { text: string; theme: string; font: string | null }) {
  const t = resolveTheme(theme);
  if (!t) return <p className="whitespace-pre-wrap break-words text-sm text-foreground"><RichText text={text} /></p>;
  return (
    <div
      className="flex min-h-[13rem] items-center justify-center rounded-2xl p-6 text-center"
      style={{ background: t.background, color: t.color, fontFamily: resolveFont(font) }}
    >
      <p className={`whitespace-pre-wrap break-words font-bold leading-snug [&_a]:text-inherit [&_a]:underline ${themedTextSize(text.length)}`}>
        <RichText text={text} />
      </p>
    </div>
  );
}
