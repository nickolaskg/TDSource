# TD SYNNEX UI design system

This document is the implementation reference for new TDS screens and components. It keeps the application consistent with the TD SYNNEX design-system pilot while the shared package is not yet installed in the repository.

## Foundations

- Use the light theme as the default. Dark theme remains available through the existing theme control.
- Use Arial, Helvetica, sans-serif for all product copy, form controls, headings, and buttons. Use monospace only for code or identifiers.
- Use the existing TD SYNNEX tokens in `src/styles/global.css` for color, surface, border, and focus states. Do not add one-off brand colors to feature styles.
- Use the action teal for primary actions and links. Reserve aqua and chartreuse for emphasis, status, or navigation accents.
- Keep body text at a readable size with line-height of at least 1.5. Use uppercase eyebrow labels only for short category labels.
- Preserve visible `:focus-visible` outlines and support reduced motion.

The approved digital type scale is:

| Role | Size / line-height | Use |
| --- | --- | --- |
| Display | `3.5rem / 1.05` | Landing or product statement |
| Heading 1 | `3rem / 1.1` | Page title |
| Heading 2 | `2rem / 1.2` | Primary section title |
| Heading 3 | `1.25rem / 1.3` | Card, form, and subsection title |
| Body | `1rem / 1.6` | Instructions and reading content |
| Label | `0.875rem / 1.4` | Form, navigation, and control labels |
| Metadata | `0.75rem / 1.5` | Dates, counts, and secondary context |

Use `rem` values, sentence case, left alignment, and natural wrapping. Keep prose
between 45 and 80 characters per line. Use uppercase only for short eyebrow labels.

Spacing and semantic tokens:

```css
--tds-space-1: 4px;   --tds-space-2: 8px;   --tds-space-3: 12px;
--tds-space-4: 16px;  --tds-space-5: 24px;  --tds-space-6: 32px;
--tds-space-7: 48px;  --tds-space-8: 64px;  --tds-space-9: 96px;
--tds-radius: 2px;
--tds-duration-fast: 120ms; --tds-duration-moderate: 200ms;
```

Use the semantic color roles already defined in the stylesheet: `--tds-text`,
`--tds-action`, `--tds-action-hover`, `--tds-surface`, `--tds-recessed`,
`--tds-border`, `--tds-border-strong`, `--tds-success`, `--tds-warning`,
`--tds-danger`, and `--tds-info`. New raw values require a documented token.

## Layout and components

- Use `.page`, `.page-heading`, `.panel`, `.panel-heading`, `.primary-button`, and `.secondary-button` before creating feature-specific equivalents.
- Keep panels square or lightly rounded with a 2px radius for new branded surfaces. Avoid adding shadows, gradients, or decorative cards unless the design system requires them.
- Use a responsive single-column layout below 820px. Side panels must stretch to the height of their paired content on wider screens and stack below it on narrow screens.
- Align panel headings, content padding, labels, and controls to the same inset. Do not use a different font or control height inside a new feature.
- Every async action needs a disabled state, a visible progress indicator, and an accessible status message.
- Every error needs a visible `role="alert"` message that does not expose provider or database diagnostics.
- Buttons use primary, secondary, ghost, and danger variants. Use short verb-led labels, one primary action per working area, and disable repeat activation while loading.
- Forms use persistent labels, 44px controls, helper text attached with `aria-describedby`, and `aria-invalid` for invalid values.
- Selection uses a checkbox for independent choices, a switch for immediate boolean settings, and a select for one constrained choice.
- Tables keep headers and statuses visible, expose sorting with `aria-sort`, and scroll inside the table region on narrow screens.
- Dialogs and drawers have an accessible name, visible close control, Escape handling, focus containment, and focus return. Use drawers for supporting detail and dialogs for focused decisions.

## Responsive grid

- Below 672px: four columns, 16px page margins and gutters.
- 672–1055px: eight columns, 24px page margins and gutters.
- 1056px and above: twelve columns, 40px page margins, and 24px gutters.
- Use a 64px global header, a 232px sidebar below it, a 1392px content maximum,
  and a 76ch reading measure. Collapse navigation into a drawer below 768px.

## Knowledge Chat example

Knowledge Chat follows these rules directly:

- The question textarea and all actions use the shared Arial stack and TD SYNNEX control tokens.
- The answer and sources panels share a grid row and stretch together. They stack on small screens.
- Source references use the same heading inset as the answer panel and remain visible with the answer.
- Answers state when no approved source was found. Citations identify the approved document used for the response.

When a component needs a new pattern, update this document and the feature stylesheet in the same change.
