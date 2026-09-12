/** Enumerate source declarations with Chromium's CSS parser, not a substring grep. */
const styles = import.meta.glob<string>('/src/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx,html}', '!/src/**/*.test.*', '!/src/test-support/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

export interface OverflowDeclaration {
  file: string;
  selector: string;
  context: string[];
  property: string;
  value: string;
  active: boolean;
}

export function parseOverflow(
  file: string,
  source: string,
): OverflowDeclaration[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(source);
  const declarations: OverflowDeclaration[] = [];
  function visit(rules: CSSRuleList, context: string[], active: boolean) {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        for (const match of rule.style.cssText.matchAll(
          /(?:^|;)\s*(overflow(?:-[xy]|-block|-inline)?)\s*:\s*([^;]+)/g,
        )) {
          const property = match[1]!;
          declarations.push({
            file,
            selector: rule.selectorText,
            context,
            property,
            value: rule.style.getPropertyValue(property),
            active,
          });
        }
      }
      if (rule instanceof CSSGroupingRule) {
        const condition =
          rule instanceof CSSConditionRule
            ? rule.conditionText
            : rule.cssText.split('{')[0]!;
        visit(
          rule.cssRules,
          [...context, condition],
          active &&
            (!(rule instanceof CSSMediaRule) || matchMedia(condition).matches),
        );
      }
    }
  }
  visit(sheet.cssRules, [], true);
  return declarations;
}

export function sourceScrollInventory() {
  return {
    files: Object.keys(styles).sort(),
    declarations: Object.entries(styles).flatMap(([file, source]) =>
      parseOverflow(file, source),
    ),
    // Retain every candidate, including native textareas/selects and source
    // reads. The report distinguishes writers, readers and markup uses.
    sourceSites: Object.entries(sources).flatMap(([file, source]) =>
      source
        .split('\n')
        .flatMap((text, index) =>
          /(?:\b(?:overflow\w*|scroll\w*|contentEditable)\b|<(?:textarea|select)\b)/.test(
            text,
          )
            ? [{ file, line: index + 1, text: text.trim() }]
            : [],
        ),
    ),
  };
}
