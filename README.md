# EasyHangar

A simple viewer for your own Star Citizen hangar: ships, pledges and buy-backs, with search,
filters and totals. RSI's website has no export and makes the hangar hard to browse; this fills
that gap.

**Unofficial, fan-made.** Not affiliated with or endorsed by Cloud Imperium Games or Roberts
Space Industries.

## Using it

Open **https://seeknd.github.io/EasyHangar/** and follow the three steps shown there:

1. Drag the **EasyHangar** button to your bookmarks bar (once).
2. Open your hangar on robertsspaceindustries.com, sign in, and click that bookmark. Press
   **Start** in the panel that appears.
3. When it says Done, your hangar shows up on the EasyHangar page.

## Your data stays with you

- The exporter runs in your own browser, on the RSI website, with the account you are signed
  in to. It never sees your password.
- It only reads your hangar and buy-back pages. It changes nothing in your account.
- Nothing is uploaded. The result goes from the RSI tab to the EasyHangar tab inside your
  browser, and a copy is saved as `EasyHangar-<date>.json` in your Downloads folder.
- The page remembers your hangar in that browser only.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: guide and viewer. |
| `export.js` | The exporter the bookmark runs on the RSI website. |

There is no build step and no server code. The two files work from any static host, or opened
straight from a folder (then the whole exporter is packed into the bookmark, and you load the
saved file by hand).

## If RSI changes its website

The exporter reads RSI's page layout. If RSI redesigns the hangar or buy-back pages, `export.js`
needs updating. Bookmarks made from the hosted page load `export.js` each time, so they pick up
the fix by themselves.
