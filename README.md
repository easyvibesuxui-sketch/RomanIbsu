# Study at IBSU — scroll-driven admission landing page

A single-page landing site for the International Black Sea University
International Relations Office admission content, built around the two mosaic
background clips supplied for the project.

**Aesthetic:** Byzantine codex — lapis ground, gold tesserae, ivory vellum
glass. Display type is Cormorant Garamond, UI type is Jost, Georgian is Noto
Serif Georgian. All three are self-hosted, so the page makes no third-party
request at runtime.

```
index.html
assets/
  css/main.css      layout, glass system, motion
  css/fonts.css     self-hosted @font-face (generated, see below)
  js/main.js        scroll scrub engine, reveals, nav
  video/            5 scene segments — .mp4 (H.264) + .webm (VP9)
  poster/           first frame of each segment, shown before video decodes
  fonts/            woff2 variable fonts (SIL OFL 1.1)
```

## The background: playback is owned by scroll

The two source clips were cut into **five contiguous segments**, each bound to
one page section:

| # | Segment | Master timecode | Section |
|---|---------|-----------------|---------|
| I | `scene-1-garden` | 0.00 – 3.17s | Hero — the tree of scrolls |
| II | `scene-2-academy` | 3.17 – 6.68s | Why IBSU — arriving at the academy |
| III | `scene-3-scroll` | 6.68 – 11.29s | Programmes — the lecture hall, and the gold veil |
| IV | `scene-4-codex` | 11.29 – 15.51s | Requirements — the scroll unrolls |
| V | `scene-5-path` | 15.51 – 18.58s | Apply — the golden road |

Because all five are slices of one master edit, consecutive segments line up
frame-to-frame and the hand-off between sections is invisible.

### Why these boundaries

The cut points are not chosen by the narrative alone — they are chosen so the
mosaic advances at the **same speed everywhere on the page**.

Each scene is scrubbed across its own scroll band (its chapter's top to the
next chapter's top), so a scene's pace is `band height ÷ duration`. The first
cut ignored this and the result lurched: the hero burned a second of video
every 196px of scroll while Requirements took 541px for the same second — the
opening of the page ran 2.7× faster than the middle.

The fix is two-part, and both halves are needed:

1. **Scroll runway.** Each `.chapter` carries a `margin-bottom` of one
   viewport (`--runway`), which buys scroll distance without touching the
   composition — the mosaic simply gets a screen to breathe between sections.
2. **Durations cut to match the bands.** Section heights were measured in the
   browser at several viewports, and each segment was cut to its section's
   measured share of total scroll.

The result is ~520px of scroll per second of video across all five scenes on
desktop (~620 on mobile), against 196–541 before. If you change a section's
content height significantly, re-measure and re-cut, or that section will
drift out of step with the rest.

### No autoplay — this is a hard contract

`assets/js/main.js` **never calls `video.play()`**, and no `<video>` carries an
`autoplay` or `loop` attribute. Frames advance only because scroll position is
written to `video.currentTime`. Stop scrolling and the mosaic stops with you.

The scrub loop eases toward the scroll target rather than snapping to it, skips
a write while a seek is still in flight, and only touches the active scene and
its two neighbours. Segments load lazily — the hero is ~850 KB, the rest arrive
as you approach them.

### The transition between the two source videos

The raw cut from video 1 to video 2 was abrupt. The two are now joined with a
1.4s cross-dissolve overlaid by a **gold veil at 46% opacity** (`#EBCB86`),
faded in over 0.6s and out over 0.85s so the whole frame blooms warm through
the hand-off and settles into the next scene. It reads as a designed moment
rather than a cut. After the re-cut it sits inside scene III rather than on
a section boundary, so it plays through uninterrupted by the cross-fade.

Rebuild command (needs `ffmpeg`), from the two source mp4s:

```sh
ffmpeg -i 1.mp4 -i 2.mp4 -f lavfi -i "color=c=0xEBCB86:s=1280x720:d=20:r=24" \
  -filter_complex "\
   [0:v]scale=1280:720,setsar=1,fps=24,format=yuv420p[a];\
   [1:v]scale=1280:720,setsar=1,fps=24,format=yuv420p[b];\
   [a][b]xfade=transition=fade:duration=1.4:offset=8.6[x];\
   [2:v]format=yuva420p,fade=t=in:st=8.15:d=0.6:alpha=1,\
        fade=t=out:st=9.4:d=0.85:alpha=1,colorchannelmixer=aa=0.46[veil];\
   [x][veil]overlay=0:0:format=auto,format=yuv420p[out]" \
  -map "[out]" -an -t 18.6 -c:v libx264 -crf 17 -preset slow master.mp4
```

Each segment is then cut from `master.mp4` (at the boundaries in the table
above) at 15 fps, 1152×648, with a
keyframe every 5 frames (`-g 5 -keyint_min 5 -sc_threshold 0`) so seeking stays
cheap, plus `gblur=sigma=0.9`. The blur is deliberate: it costs nothing visually
behind the scrim and glass, and roughly halves the bitrate on this
high-entropy mosaic texture. Total video payload is ~3.9 MB (mp4) / ~4.3 MB (webm).

## Serving requirement

**The host must support HTTP Range requests.** Scroll scrubbing seeks inside the
video files; a server that answers `200` instead of `206` makes them report
`seekable.length === 0` and the background freezes on the poster frame. Netlify,
Vercel, GitHub Pages, nginx and Apache all do this by default —
Python's `http.server` does **not**, so don't test with it.

For local preview, any range-capable static server works, e.g.:

```sh
npx serve .
```

## Codecs

H.264 `.mp4` is preferred at runtime (hardware decode almost everywhere, which
is what makes seeking smooth) with VP9 `.webm` as fallback; `main.js` picks per
browser via `canPlayType`. Every scene also has a poster JPEG, so a browser that
refuses to decode either still shows a still frame rather than a black box.

## Accessibility & behaviour

- `prefers-reduced-motion: reduce` freezes the stage, disables the scrub loop
  and parallax, and shows all content without reveal animation.
- The background layer is `aria-hidden`; nothing in it carries meaning.
- The hero states "Scroll — the mosaic moves with you", since the page is
  deliberately still until the visitor scrolls.
- Keyboard focus is visible throughout; the mobile menu is a real
  `aria-expanded` toggle.

## Regenerating the fonts

`assets/css/fonts.css` and `assets/fonts/*.woff2` were generated by fetching the
Google Fonts CSS with a modern-browser UA and rewriting the URLs to local paths.
The files are variable fonts — one per style and subset — with each `@font-face`
block pinning a single weight along the axis, exactly as Google's own CSS does.

## Content provenance — please verify before publishing

`https://ibsu.edu.ge/en/iro/admission/` was **not reachable from this build
environment** (blocked by the network egress policy), so the page copy was
reconstructed from search results describing that page and related IBSU/IRO
sources rather than read from the page itself.

The structure — required documents, notarisation and Georgian translation, the
B2 English rule and its waiver, the personal interview, the
`admissions@ibsu.edu.ge` submission route — is consistent across sources. These
specifics should be checked against the live page before the site goes public:

- **Tuition.** Sources disagree (≈$2,500/yr, ≈$4,800/yr, ≈10,000 GEL/yr for
  bachelor's). The page deliberately says "from approx. $2,500 / year, varies by
  programme" and tells applicants to confirm with the IRO.
- **Programme lists per school**, and the "26 English-taught programmes" figure.
- **Postal address** in the footer.
- **Application deadlines**, which are not stated anywhere on the page and
  should be added once known.
