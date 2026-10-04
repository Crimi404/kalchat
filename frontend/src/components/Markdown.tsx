import { Fragment, type ReactNode } from "react";
import { RichText } from "@/components/RichText";

/** Identifiant du compte Kora IA (le même que BOT_ID dans backend/ai.js). */
export const KORA_ID = "kalchat-ai";

const URL_RE = /https?:\/\/[^\s<>]+/g;
// Ordre de priorité : code, gras, italique, lien [texte](url), adresse seule
const INLINE_RE = new RegExp(
  [
    "`([^`\\n]+)`", // 1 : code
    "\\*\\*(?!\\s)([^\\n]+?)(?<!\\s)\\*\\*", // 2 : gras **
    "__(?!\\s)([^\\n]+?)(?<!\\s)__", // 3 : gras __
    "\\*(?![\\s*])([^*\\n]+?)(?<![\\s*])\\*", // 4 : italique *
    "(?<![\\p{L}\\p{N}_])_(?![\\s_])([^_\\n]+?)(?<![\\s_])_(?![\\p{L}\\p{N}_])", // 5 : italique _
    "\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)", // 6 : texte, 7 : adresse
    "(https?:\\/\\/[^\\s<>]+)", // 8 : adresse seule
  ].join("|"),
  "gu",
);

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function ExternalLink({ href, children, own }: { href: string; children: ReactNode; own?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`break-all font-semibold underline underline-offset-2 ${own ? "" : "text-primary"}`}>
      {children}
    </a>
  );
}

/** Sépare une adresse de la ponctuation qui la suit (point, virgule, parenthèse…). */
function splitTrailing(url: string): [string, string] {
  const m = url.match(/[.,;:!?)'"»]+$/);
  return m ? [url.slice(0, -m[0].length), m[0]] : [url, ""];
}

function inline(text: string, own: boolean, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_RE.source, INLINE_RE.flags);
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  const push = (node: ReactNode) => out.push(<Fragment key={`${keyPrefix}-${i++}`}>{node}</Fragment>);
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) push(<RichText text={text.slice(last, m.index)} />);
    const [, code, boldA, boldB, italA, italB, linkText, linkUrl, bare] = m;
    if (code !== undefined) {
      push(<code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]">{code}</code>);
    } else if (boldA !== undefined || boldB !== undefined) {
      push(<strong className="font-bold">{inline(boldA ?? boldB, own, `${keyPrefix}-b${i}`)}</strong>);
    } else if (italA !== undefined || italB !== undefined) {
      push(<em>{inline(italA ?? italB, own, `${keyPrefix}-i${i}`)}</em>);
    } else if (linkText !== undefined) {
      const href = safeHref(linkUrl);
      push(href ? <ExternalLink href={href} own={own}>{linkText}</ExternalLink> : linkText);
    } else if (bare !== undefined) {
      const [url, trailing] = splitTrailing(bare);
      const href = safeHref(url);
      push(href ? <><ExternalLink href={href} own={own}>{url}</ExternalLink>{trailing}</> : bare);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) push(<RichText text={text.slice(last)} />);
  return out;
}

/** Texte brut dont les adresses web sont cliquables (messages des membres : pas de mise en forme Markdown). */
export function LinkifiedText({ text, own = false }: { text: string; own?: boolean }) {
  const out: ReactNode[] = [];
  const re = new RegExp(URL_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [url, trailing] = splitTrailing(m[0]);
    const href = safeHref(url);
    out.push(href ? <Fragment key={i++}><ExternalLink href={href} own={own}>{url}</ExternalLink>{trailing}</Fragment> : m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string; level: number }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) { flush(); blocks.push({ type: "h", text: h[2], level: h[1].length }); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.+)$/);
    if (ul) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.items.push(ul[1]); else blocks.push({ type: "ul", items: [ul[1]] });
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ol) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "ol") last.items.push(ol[1]); else blocks.push({ type: "ol", items: [ol[1]] });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

/**
 * Affiche le Markdown léger des réponses de Kora IA : titres, gras, italique, listes, code, liens.
 * Rien n'est injecté en HTML : tout est construit en éléments React, et seuls les liens http(s) sont acceptés.
 */
export function Markdown({ text, own = false }: { text: string; own?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-1.5 break-words">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.type) {
          case "h":
            return <p key={k} className={`font-bold ${b.level <= 2 ? "text-base" : "text-sm"}`}>{inline(b.text, own, k)}</p>;
          case "ul":
            return <ul key={k} className="list-disc space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it, own, `${k}-${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={k} className="list-decimal space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it, own, `${k}-${j}`)}</li>)}</ol>;
          case "code":
            return <pre key={k} className="overflow-x-auto rounded-lg bg-background/60 p-2 font-mono text-xs"><code>{b.text}</code></pre>;
          default:
            return <p key={k} className="whitespace-pre-wrap">{inline(b.text, own, k)}</p>;
        }
      })}
    </div>
  );
}

/** Retire la mise en forme Markdown pour les aperçus d'une ligne (liste des conversations). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,4}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]+?)[*_](?=[\s).,!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}
