# Tradelock demo video

Remotion project for the demo video. Composition `Demo` (1920×1080, 30 fps, ~94 s) is the submission video; `Tradelock` is the earlier square cut.

- Script and shot list: [SCRIPT.md](SCRIPT.md). All on-chain values come from `docs/DEPLOYMENTS.md` (deal 4 was run for this video).
- Voiceover: `public/vo/01–10.mp3`, Samuel's own voice cloned on Fish Audio (private voice, with his consent). Word timings: `src/demo/captions.json`.
- Screens: `public/shots/`, screenshots of the live `/deals/4` page after each step, plus deals 1 and 3.

```
npm i
node tools/music.mjs 93 public/music.wav     # synthesized music bed (not in git)
npx remotion studio                           # preview
npx remotion render Demo out/tradelock-demo-16x9.mp4
```
