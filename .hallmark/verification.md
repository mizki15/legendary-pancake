# Journal verification

The existing scrapbook design was updated to the user's countryside palette and layout reference, using Hallmark's app-screen checks.

## Current design

- Cream surfaces, muted blush and blue, and deep plum controls; a thin double frame around the anniversary.
- The M＆K wordmark uses the exact four paths of the supplied SVG's lower-left walking cat. The white background and the other cats are excluded.
- A generated, transparent botanical bouquet decorates the background. The original generation remains outside the repository; the web asset is a 209,674-byte WebP.
- The anniversary shows its label at upper-left, days/hours/minutes/seconds in one centered row, and the configured start date at lower-right. It updates every second and suspends its timer while the page is hidden. The actual start date remains a private configuration value.
- Requested intro copy and the footer are removed; the section headings are Anniversary, Memories and Pages.
- Each photo preview has a keyboard-accessible X button. Saved photos can be restored before submission; a newly selected file can also be cleared. The server API contract is unchanged.

## Completed verification

- Python: all 17 tests passed, including existing-site regressions and the journal's authentication, CSRF, archival, optimistic concurrency, photo compression, deletion, retention and anniversary privacy checks.
- New photo-cache checks verified authenticated ETag/304 responses, server download reuse, TTL expiry, logout denial, invalidation on removal and separation between storage namespaces.
- Apps Script: all 5 mocked-service tests passed; Google-side code is unchanged.
- Chromium: the existing add/edit/filter/random/archive/trash/restore/conflict/offline workflow passed. Additional checks covered the exact requested copy removal and cat asset, every-second ticks, the anniversary's midnight, three-digit day counts in a single row at 320, 375, 768, 1280 and 1920px, photo X/undo, saved photo removal and cancellation of a newly selected file.
- Chromium also confirmed that a warmed browser image cache returns 401 after logout.
- Hallmark static/render checks ran for Home, Date ideas and login, with 0 Floor FAIL, 0 open REFLEX and 0 WARN. The existing waiver permits long user-entered date titles in two lines. Existing Finish answers cover prose-only selectors and consistent app-control corners.
- A fresh-context finish reviewer returned `ship` with no concrete defects in the desktop, phone and photo-removal captures. A separate login check found and fixed a decorative container extending beyond the phone viewport; recapture passed.

## Cache behavior

Photos are authenticated before every response, including 304. Browser caching is private and must revalidate. The process-local server cache holds at most 48 entries and 16 MB for 60 seconds; edits invalidate the corresponding idea, list refreshes reconcile current versions, and storage configuration changes use separate namespaces. The cache does not persist photos to Render's ephemeral disk.

All screenshots and interaction fixtures use local sample data. These checks did not modify live Google data, and no Apps Script redeployment or new environment variables are required for this update.
