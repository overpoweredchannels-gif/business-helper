# UI and interaction review — 16 September 2026

Fixed confirmed issues in the recently added help, sidebar, setup and import flows:

- Help badges no longer occupy small action buttons. Existing labels/tooltips remain available, and full guidance is accessible through Help.
- Collapsed sidebar has a compact Help control instead of a floating panel covering navigation. On phones, the fallback is one compact Help button; icon visibility can be changed inside the tutorial.
- Tutorial icon visibility is remembered per user in the browser.
- Light-theme secondary text and white primary-button text now have measured contrast ratios above 4.5:1 against their default backgrounds. Dark-theme secondary text is also brighter.
- Setup resumes at the first unreviewed step; duplicate stored review marks are ignored. Active/primary button classes are merged to prevent conflicting background colors.
- Failed template loading offers an explicit manual-mapping fallback, without deleting saved templates.
- Preview shows progress and disables mapping/file controls and dialog closing. Synchronous guards reject repeat preview/import clicks. Controls become usable again after a failed preview.
- Slow file reads cannot overwrite a newer selection, and resetting clears the selected file reference.

Validation: import, AI-guidance and barcode regression tests; TypeScript/production build; browser checks for collapsed help, saved icon preference, setup resume, manual mapping after template failure, and delayed preview errors. Used synthetic fixture data, not production business records. These checks cover the changed flows, not every screen or hardware device in the app.

No SQL changes.
