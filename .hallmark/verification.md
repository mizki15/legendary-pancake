# Journal verification

Hallmark v2.0.0 from Nutlope/hallmark was downloaded to the development environment. Its app-screen workflow, theme deal, scaffold, tokens, state guidance, render checker and independent finish review were used.

## Design decisions

- Screen: a private shared date-card journal, with loading, empty, error and full states.
- Theme: Sticker, dealt 1/3. The user's beige scrapbook palette and roman serif headings override the catalog's bright palette and heavy display face. The signal color is restrained olive.
- Signature: actual date ideas becoming dated memories. No stock photos, generated decorative images or invented user records ship in the app.
- Material: user-provided names and configured anniversary; the user's own optional photos. Preview screenshots contain local sample records only. The actual anniversary is not committed to the public repository.
- Shell: two top-level destinations, inline title-only addition, compact filters and a native edit dialog. No marketing hero, page-load reveal or animation library.

## Completed checks

- Python: `python -m unittest discover -s tests` passed 15 tests, including existing-site regressions, authentication, CSRF, optional fields, optimistic concurrency, two private compressed photos, archival, trash/restore, expiry, login rate limiting, passphrase rotation and anniversary privacy.
- Apps Script: `node --test tests/google_journal.test.cjs` passed 5 tests using mocked Google services: HMAC protection, Unicode/version conflict, independent photo replacement, permanent expiry cleanup and retry after partial deletion.
- Actual Chromium interaction: login/logout, title-only addition, optional fields, two photo slots, filters, reference links, filtered random choice, completion, trash/restore, unsaved edits, conflicting edits, offline/retry and empty states passed. Photo selection followed by removal was verified to save no image. Invalid budget ranges disable random selection.
- Asia/Tokyo anniversary behavior was verified at the anniversary's midnight and on the following day.
- Browser layouts were checked down to 320px, including reduced motion. Gunicorn with 4 threads and a 90-second timeout served the existing home and failed closed on an unconfigured journal.
- Hallmark `sloplint --scope app --genre playful --render` ran for the date list, home and login across 320–1920px. Final result: **0 Floor FAIL, 0 open REFLEX, 0 WARN**. One Reflex gate (49b) is waived for real user-written titles that can occupy two clamped lines. F6's prose-selector false positive and F7's consistent app-control corners are answered in the CSS stamp.
- Independent finish review found two usability issues: the first mobile card was too far below the toolbar, and Home's loading state lacked a row skeleton. Both were fixed. Recapture showed the first card move from about y794 to y632 at 375px; memory loading now preserves row structure.

## Pending external setup

No sheet, folder or deployment was created in the account connected to this chat. The user chose a different Google account. That account's owner must run the provided Apps Script setup and authorize/deploy it, then configure Render. Google service tests use mocks; live cross-device persistence, account permissions and scheduled execution remain unverified until that setup is complete. Nothing has been merged or deployed to Render.
