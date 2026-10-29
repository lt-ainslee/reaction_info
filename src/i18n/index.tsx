// Language switch (zh / en) and the texts of the current language.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { en } from './en';
import { zh, type Dict } from './zh';

export type { Dict };

export type Lang = 'zh' | 'en';

const DICTS: Record<Lang, Dict> = { zh, en };

interface Ctx { t: Dict; lang: Lang; setLang: (l: Lang) => void }
const I18nContext = createContext<Ctx | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = DICTS[lang].appTitle;
    try {
      localStorage.setItem('lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang]);
  return <I18nContext.Provider value={{ t: DICTS[lang], lang, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
