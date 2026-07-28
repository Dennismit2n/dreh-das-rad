# Dreh das Rad

![Dreh das Rad](assets/promo.webp)

**➡️ Try it: [dennismit2n.github.io/dreh-das-rad](https://dennismit2n.github.io/dreh-das-rad/)** &nbsp;·&nbsp; 🇩🇪 [Deutsche Version dieser Seite](README.de.md)

A decision wheel for when nobody can decide. Type your options, spin the wheel, and let fate settle it — fairground lights, a ratcheting pointer and confetti included. Everything runs in your browser: no server, no account, nothing uploaded.

The name is German for "spin the wheel", and it stays that way in all twelve languages — the tagline underneath does the translating.

## Features

- 🎡 **A wheel that behaves like a wheel** — 3-second spin with a long, slow tail, a pointer that gets flicked aside by every peg it passes, and a ratchet that drops in pitch as the wheel slows down
- 💡 **Fairground lights** — the bulbs on the rim sit dark until the wheel stops, then blast on and chase around the rim
- ⚖️ **Weighting** — write `Papa cooks x3` and that option takes three slots instead of one
- ➖ **Draw and remove** — take the winner off the wheel and keep spinning; drawn options are listed in order, so you can draw a whole running order in one go
- 🎨 **4 colour worlds** — Fairground, Neon, Pastel and Ink, each checked for label contrast in both light and dark mode
- 🚀 **6 quick-start lists** — Yes/No, coin flip, numbers 1–10 plus food, what to watch and what to do, curated separately for each language
- 🔗 **Share as a link, QR code or via your phone's share sheet** — the recipient gets the same wheel and spins it themselves
- 🌍 **12 languages** — Deutsch, English, Español, Français, Italiano, Português, Türkçe, Русский, हिन्दी, 中文, 日本語, 한국어 (auto-detected)
- 📱 **Installable PWA** — put the wheel on your home screen; works fully offline
- 🔒 **Radically private** — your options live in the URL *fragment* (`#…`), which browsers never send to any server

## Is it actually fair?

Yes, and deliberately so. The winner is drawn **before** the wheel moves, using `crypto.getRandomValues` with rejection sampling — so there is no modulo bias and every slot has exactly the same chance. Only then is the target rotation calculated so the wheel comes to rest on that slot. **The animation displays the result; it does not produce it.**

Simulating a physical wheel instead would be worse, not better: the landing spot would depend on frame rate and floating-point drift. This way the odds are provable, and the same draw works when animations are switched off.

## Accessibility

- `prefers-reduced-motion` is respected: no spin, no confetti, no flashing lights — the result simply fades in. Since the spin is rather the point of this app, there is also a visible **"Let the wheel spin"** switch to override that, and it is remembered.
- Every segment label is drawn in whichever of ink or white contrasts better with its background, and `tools/check-contrast.js` fails the build if any pairing drops below WCAG AA (4.5:1). Neighbouring segments are checked with CIE ΔE, because two colours can be equally bright and still perfectly easy to tell apart.
- Sound only ever plays as a direct result of pressing "spin", and the speaker button in the header mutes it for good.

## Privacy

The whole app is a handful of static files. Your question and options are encoded into the part of the URL after `#` — the fragment — which your browser never transmits, so a shared wheel stays between you and the people you send it to. There is no server-side anything: turn on airplane mode and it still works.

The page title is deliberately kept static and never includes your question, so nothing personal can leak into the visit counter.

*Analytics:* the app uses [GoatCounter](https://www.goatcounter.com) for anonymous, cookieless visit counting (disclosed in the footer). The script is vendored locally in `js/vendor/count.js`; the only external request is the count pixel.

## Development

No build step, no dependencies.

```bash
node tools/dev-server.js
```

Then open http://localhost:8617. Edit, reload, done.

Two checks worth running after touching colours or translations:

```bash
node tools/check-contrast.js && node tools/check-i18n.js
```

⚠️ The service worker caches aggressively. While developing, unregister it and clear the caches before testing, and **bump `CACHE` in `sw.js` on every deploy**.

### The README animation

`tools/gif-recorder.html` records a spin using the very same renderer the app uses (`js/wheel.js`), so what you see in the recording is exactly what visitors get. Open it via the dev server, press **Aufnehmen**, and it writes both `promo.gif` and `promo.webp` (animated) to your downloads folder — move them into `assets/`.

The spin is arranged to end at the same wheel position it started from, so the loop has no visible jump. Defaults produce roughly 620 KB of GIF and 440 KB of WebP; the README embeds the WebP.

## Ideas for later

Result history · fullscreen mode · shuffling the segment order.

## License

MIT — see [LICENSE](LICENSE).
