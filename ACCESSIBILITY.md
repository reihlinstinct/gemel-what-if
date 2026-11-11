# Accessibility statement

Our target is SI 5568 level AA, with additional WCAG 2.2 A/AA automated coverage.
A full SI 5568/WCAG conformance audit has not been completed. The in-interface
statement is available through the Accessibility link in the calculator footer.

## Evidence and adjustments

Semantic headings, field labels, keyboard controls, focus styles and per-language
direction are used. The results chart legend contrast is corrected from #777 to
#666 on white. Every catalog language is tested, not a hardcoded language list.

The shared pinned repo-checks axe gate runs Chromium and WebKit at 1280x900 and
390x844 against synthetic local previews. Project-specific tests also scan
post-calculation results with the accessibility statement open. The synthetic
preview strips the analytics beacon; official verification responses are stubbed
in the interaction test. This does not test live data, analytics or AI services.
Existing smoke/browser tests remain in place during the pilot. This action is
for first-party synthetic/no-secret previews, not network isolation. Unsupported
encoded/dynamic speculative loads and other browser paths may bypass routing.

## Known limits

Automated tests are not compliance certification. Axe has an indeterminate
label-content-name-mismatch check on symbol-only add-event controls; accessible
names need manual review. A complete keyboard, screen-reader, zoom/reflow,
contrast-state and real-device evaluation remains to be done. WebKit on Linux
is not Safari on iOS, and two browser engines do not prove two-OS app coverage.
French UI and statement text remain a machine draft.

## Feedback

Report a barrier and reproducible steps in [the pilot tracking issue](https://github.com/reihlinstinct/gemel-what-if/issues/109).
For accessibility requests, email [reihlinstinct@gmail.com](mailto:reihlinstinct@gmail.com).
No phone contact is published. Do not include personal or financial data. Last updated: 2026-11-11.
