import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { useEnterToSend } from "@/lib/inputPrefs";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  /** Appelé quand on envoie avec la touche Entrée (seulement si « Entrée pour envoyer » est activé). */
  onEnterSend?: () => void;
};

/**
 * Champ de saisie qui grandit avec le texte. Par défaut, Entrée = nouvelle ligne (on envoie avec le bouton).
 * Si l'option « Entrée pour envoyer » est activée dans les paramètres : Entrée envoie, Maj + Entrée passe à la ligne.
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea({ onEnterSend, onKeyDown, className = "", value, ...rest }, ref) {
  const [enterToSend] = useEnterToSend();
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

  // La hauteur suit le texte (limitée par la classe max-h du parent)
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={inner}
      rows={1}
      value={value}
      enterKeyHint={enterToSend ? "send" : "enter"}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (enterToSend && onEnterSend && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnterSend();
        }
      }}
      className={`resize-none overflow-y-auto ${className}`}
      {...rest}
    />
  );
});
