import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_]{3,20})\b/g;

/** Affiche un texte en rendant les @mentions cliquables (lien vers le profil). */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = new RegExp(MENTION_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const at = m.index + m[1].length; // position du @
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={`${at}-${m[2]}`} to="/u/$username" params={{ username: m[2] }} className="font-semibold text-primary hover:underline">
        @{m[2]}
      </Link>,
    );
    last = at + 1 + m[2].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
