import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/lib/i18n";
import { getCachedTranslation, isProbablyChinese, translateOne } from "@/lib/translate";

/**
 * Returns `text` translated to the user's OS locale when that locale is Chinese,
 * otherwise the original. English users and already-Chinese strings incur no
 * network call. While a translation is in flight the original text is shown, then
 * swapped in when it resolves. Used for listing descriptions/headlines on the
 * generic screening cards and the property detail screen.
 */
export function useMaybeTranslated(text: string | null | undefined, pendingFallback?: string): string {
  const { locale } = useT();
  const { getApiHeaders } = useAuth();
  const source = text ?? "";
  const fallback = pendingFallback ?? source;

  const [value, setValue] = useState<string>(() => {
    if (locale !== "zh" || !source.trim() || isProbablyChinese(source)) return source;
    return getCachedTranslation(source) ?? fallback;
  });

  useEffect(() => {
    if (locale !== "zh" || !source.trim() || isProbablyChinese(source)) {
      setValue(source);
      return;
    }
    const cached = getCachedTranslation(source);
    if (cached != null) {
      setValue(cached === source && !isProbablyChinese(source) ? fallback : cached);
      return;
    }
    let mounted = true;
    setValue(fallback);
    translateOne(getApiHeaders(), source)
      .then((translated) => {
        if (!mounted) return;
        setValue(translated === source && !isProbablyChinese(source) ? fallback : translated);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [source, fallback, locale, getApiHeaders]);

  return value;
}
