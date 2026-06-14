# VFXMAGIC — Warp Gallery

A self-contained prototype of the **signature hero** for the VFXMAGIC website. Two layouts,
toggled top-right:

- **Gallery** — a horizontal film-frame strip that physically **bends with scroll velocity**.
- **Reel** — the frames unspool into a **vertical film strip that swirls up a coiled axis**
  as you scroll (the "let a film reel unravel, vertically" effect).

Both: black-and-white → colour on hover, custom cursor, velocity warp, 16:9 film frames, and
**click any frame to enlarge** (full-size lightbox; Esc / × / backdrop closes).

**Reel is the default opening view** — it spins into alignment, then **slowly auto-rotates
through all the frames on its own**. The auto-rotation pauses the moment the mouse is on a frame
(or you scroll/drag) so the viewer takes control, and resumes shortly after they stop. An
**Autoplay** button (top-right, under the mode switch) turns the automatic motion off entirely.
Tune in the module: `AUTO_SPEED` (rotation speed), `IDLE_MS` (resume delay).

**🟢 Live:** https://vfxmagic.github.io/warp-gallery/ — deployed as a standalone product (GitHub
Pages, repo `vfxmagic/warp-gallery`), separate from the main vfxmagic.com.au site. Linked as a
"Live product" card on the marketing Client Area. To redeploy after edits: copy this folder to a
clean dir and `git push` to `vfxmagic/warp-gallery` (main / root).

This is **Example 4** from Sergei Chyrkov's *"Fable 5 Is Insane…"* build
(`https://www.youtube.com/watch?v=BWQ542fvrXo`) — "the reel, made physical." It's the one
showpiece we chose to spend boldness on (Earned Wonder: one earned bold moment, the rest quiet).

## Run it

It's a single static page. Either open `index.html` over a local server:

```bash
python3 -m http.server 8853 --directory .
# → http://localhost:8853
```

…or use the `warp-gallery` config in `.claude/launch.json` (preview tools). Three.js + GSAP are
**vendored locally** in `vendor/` — no internet needed.

## The plates

`plates/vfxmagic-still-01..10.webp` are **real VFXMAGIC stills** pulled from the studio's
"Our Work" gallery (vfxmagic.com.au). Frame 01 is the **Testament** project banner; the rest
are the studio reel (Testament / The Chosen — the site doesn't expose a Testament-only set, so
these stand in). They're 16:9, so they fill the film frames with no cropping.

To change them, edit the **`PLATES`** array near the top of the `<script type="module">`:

```js
const PLATES = [
  { title:'TESTAMENT', src:'plates/vfxmagic-still-01.webp' },
  ...
];
```

- Drop new stills in `plates/` and point `src` at them (or any URL). 16:9 is ideal.
- `title` is the caption shown bottom-right on hover.
- If a `src` is empty or fails to load, a labelled **placeholder** is generated so the layout
  never breaks.

## Reel tuning knobs

Near the top of the module: `REEL_TWIST` (swirl rate), `REEL_R` (coil radius / how far frames
swing), `REEL_RISE` (vertical spacing), `REEL_FACE` (how much frames turn to follow the coil),
`REEL_SCROLL` (scroll → travel speed).

Gallery knobs: `PW`/`PH` (frame size), `SPACING` (strip gap), vertex-shader `uVelo * 2.6`
(warp strength), `uArc` (permanent 3D arc).

## Notes

- Real green-A logo embedded as a data URI (brand law) · links back to vfxmagic.com.au.
- Desktop: scroll/drag to warp, hover for colour. Mobile: drag to scroll, custom cursor off.
- Built 2026-06-14. Memory: `.claude/memory/vfxmagic-website-warp-gallery.md`.
