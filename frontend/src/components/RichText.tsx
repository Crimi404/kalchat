import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

// @mention  |  #hashtag (lettres accentuées, chiffres et _ ; au moins 2 caractères, ne commence pas par un chiffre seul)
const TOKEN_RE = /(^|[^\p{L}\p{N}_@#])(?:@([A-Za-z0-9_]{3,20})|#([\p{L}\p{N}_]{2,50}))(?![\p{L}\p{N}_])/gu;

/** Affiche un texte en rendant les @mentions (profil) et les #hashtags (page de recherche) cliquables. */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = new RegExp(TOKEN_RE.source, "gu");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length; // position du @ ou du #
    if (start > last) parts.push(text.slice(last, start));
    if (m[2]) {
      parts.push(
        <Link key={`${start}-m`} to="/u/$username" params={{ username: m[2] }} className="font-semibold text-primary hover:underline">
          @{m[2]}
        </Link>,
      );
      last = start + 1 + m[2].length;
    } else {
      const tag = m[3];
      parts.push(
        <Link key={`${start}-h`} to="/explorer" search={{ tag: tag.toLowerCase() }} className="font-semibold text-primary hover:underline">
          #{tag}
        </Link>,
      );
      last = start + 1 + tag.length;
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
