import { AppProviders } from './app/providers';
import AppRouter from './app/router';
import { useLocale } from './i18n';

export default function App() {
  // Subscribing at the root is what makes a language switch reach the whole
  // tree in one render. Components that call `useT()` would re-render on their
  // own, but shared label helpers (`format.ts`, `work-presentation.ts`) call
  // the non-reactive `t()` from module scope and cannot subscribe. Re-rendering
  // from here covers both, and a locale switch is rare enough that the cost is
  // not worth a finer-grained scheme.
  useLocale();

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
