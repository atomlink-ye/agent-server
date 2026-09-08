import { Fragment, type ReactNode } from 'react';

import {
  messageTemplate,
  useLocale,
  type MessageKey,
  type MessageVars,
} from './index';

export type NodeVars = Record<string, ReactNode>;

/**
 * A sentence whose placeholders are React nodes rather than text — a name in
 * `<strong>`, a task title that is a `<Link>`.
 *
 * This exists because the alternative is concatenating fragments in JSX, and
 * concatenation hard-codes English word order. "Ana assigned Bo to Ship the
 * docs" and 「Ana 把 Ship the docs 指派给了 Bo」 put the same three nodes in
 * different places; only a whole-sentence template lets the translation move
 * them.
 */
export function renderRich(
  template: string,
  vars: NodeVars,
  textVars?: MessageVars,
): ReactNode {
  const parts = template.split(/(\{\w+\})/gu);
  return (
    <>
      {parts.map((part, index) => {
        const name = /^\{(\w+)\}$/u.exec(part)?.[1];
        if (name === undefined) return <Fragment key={index}>{part}</Fragment>;
        if (name in vars) return <Fragment key={index}>{vars[name]}</Fragment>;
        const text = textVars?.[name];
        // An unmatched placeholder stays visible, for the same reason it does
        // in plain interpolation: a typo should be findable, not invisible.
        return (
          <Fragment key={index}>
            {text === undefined ? part : String(text)}
          </Fragment>
        );
      })}
    </>
  );
}

/** Component-side form of {@link renderRich}: resolves the key in the current
 *  locale and re-renders the caller when the locale changes. */
export function useRichT(): (
  key: MessageKey,
  vars: NodeVars,
  textVars?: MessageVars,
) => ReactNode {
  const locale = useLocale();
  return (key, vars, textVars) =>
    renderRich(messageTemplate(locale, key), vars, textVars);
}
