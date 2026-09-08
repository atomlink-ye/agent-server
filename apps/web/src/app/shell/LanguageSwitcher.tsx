import { useEffect, useRef, useState } from 'react';

import { LOCALES, setLocale, useLocale, useT } from '../../i18n';

/**
 * The language control, at the foot of the rail.
 *
 * It lives here because the rail is the only chrome on every screen: language
 * is not a Conversations setting, and there is no account settings page yet to
 * bury it in. The button shows the current language, not the one it switches
 * to — a control that displays a state it is not in is a coin flip to read.
 *
 * The menu lists each language written in itself, so someone who cannot read
 * the current UI can still find their way out of it.
 */
export function LanguageSwitcher() {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const current = LOCALES.find(({ code }) => code === locale) ?? LOCALES[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="rail-language" ref={container}>
      <button
        className="rail-language-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('shell.language.change')}
        title={t('shell.language.current', { language: current.label })}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{current.short}</span>
      </button>
      {open ? (
        <div
          className="rail-language-menu"
          role="menu"
          aria-label={t('shell.language.menu')}
        >
          {LOCALES.map((option) => (
            <button
              key={option.code}
              className="rail-language-option"
              type="button"
              role="menuitemradio"
              aria-checked={option.code === locale}
              lang={option.code}
              onClick={() => {
                setLocale(option.code);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default LanguageSwitcher;
