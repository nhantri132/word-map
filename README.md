# Word Map

A matching puzzle for phones and tablets. Drag each answer onto its prompt. Every correct match paints one pixel; each finished puzzle grid is one tile of a larger hidden picture. Finish every grid and the map zooms out, the gaps close, and the picture fades in.

No build step, no dependencies: plain HTML, CSS and JavaScript.

## Put it on GitHub Pages

1. Create a repo (e.g. `word-map`) and upload everything in this folder, keeping the folder structure.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. After a minute it's live at `https://<your-username>.github.io/word-map/`.
4. On each phone, open it and use **Add to Home Screen**. It then opens full-screen like an app.

To test on your computer first, run `python3 -m http.server` in this folder and open `http://localhost:8000`. Double-clicking `index.html` will **not** work; browsers block a file page from loading the puzzle files.

## Folder layout

```
index.html  style.css  app.js
maps/index.json      ← list of maps shown on the home screen
maps/heart.json      ← one file per Word Map
images/heart.png     ← the picture a map reveals
```

## Making a Word Map

1. Drop an image in `images/`.
2. Create `maps/your-map.json`:

```json
{
  "title": "Kyoto Trip",
  "subtitle": "for our anniversary",
  "image": "images/kyoto.jpg",
  "puzzleSize": [4, 4],
  "mapSize": [4, 3],
  "palette": 10,
  "puzzles": [
    { "theme": "Japanese food", "pairs": [
        ["Fermented soybean paste", "Miso"],
        ["Thin buckwheat noodles", "Soba"]
    ] }
  ]
}
```

3. Add `"your-map.json"` to the list in `maps/index.json`.

| Field | Meaning |
|---|---|
| `puzzleSize` | `[columns, rows]` of prompt squares in each puzzle grid. Every pair is one pixel. It also sets the shape of each puzzle's block on the map. |
| `mapSize` | `[columns, rows]` of puzzle grids in the Word Map. |
| `puzzles` | Exactly `columns × rows` of the map, listed left→right, top→bottom. Each needs exactly `columns × rows` pairs of its puzzle. |
| `size` *(per puzzle, optional)* | Give one puzzle its own grid, e.g. `"size": [2, 2]` or `[3, 3]`. It still covers the same block of the map; its pixels are just bigger or smaller. Leave it out to use `puzzleSize`. |
| `pairs` | `["prompt", "answer"]`, or `{ "prompt": "...", "answer": "..." }`. |
| `palette` | Number of colours to reduce the picture to (pixel-art look). `0` keeps exact average colours. Default 8. |
| `background` | Colour behind transparent PNGs. Default cream. |
| `revealOriginal` | `false` to skip fading in the original picture at the end. |
| `strikes` | Wrong guesses allowed per grid before it resets. Default `3`; `0` turns strikes off. |

The image is pixelated automatically in the browser: it's centre-cropped to the map's shape and averaged down to one colour per square. You don't need to prepare it.

If something doesn't add up (wrong number of pairs, missing answer), the map screen lists exactly what to fix.

**Preview before writing content:** open `#/peek/your-map` (e.g. `…/word-map/#/peek/heart`) to see the finished pixel picture without touching your progress. Use it to choose sizes and palette before writing 200 prompts.

Answers are matched case-insensitively. If two prompts share the same answer, either tile fits either square.

## Strikes and shuffle

- **Strikes:** each wrong guess (a tile dropped or tapped onto the wrong square) is a strike. On the third, that grid's progress is wiped and you're sent back to the map; other grids are untouched. Strikes are saved, so leaving and coming back doesn't clear them. Dropping a tile between squares or back in the tray is free.
- **Shuffle:** rearranges the prompts that are still unsolved. Solved squares stay where they are, because each position is a fixed pixel of the picture. The new arrangement is saved.

## Mixing grid sizes

Puzzles in one map can be different sizes:

```json
{ "theme": "Quick warm-up", "size": [2, 2], "pairs": [["…","…"], ["…","…"], ["…","…"], ["…","…"]] }
```

Every puzzle covers an equal block of the map. A 2×2 paints its block with 4 big pixels, a 4×4 with 16 small ones, so the finished pixel picture is chunkier where the small puzzles were. Use it for topics that can't fill 16 squares, or to mix quick and long rounds.

## Choosing sizes — the honest trade-off

Picture detail and the amount of content are the same number. One pixel = one prompt.

| Puzzle grid | Map | Picture | Prompts to write |
|---|---|---|---|
| 4×4 | 2×2 | 8×8 | 64 |
| 4×4 | 3×3 | 12×12 | 144 |
| 4×4 | 4×4 | 16×16 | 256 |
| 4×4 | 5×5 | 20×20 | 400 |
| 3×3 | 5×5 | 15×15 | 225 |

- Below ~16×16 most pictures won't be recognisable as pixels; the fade-in of the original at the end is what pays off small maps.
- Images that pixelate well: bold shapes, a clear silhouette, few colours, high contrast, subject filling the frame. Faces, busy photos and fine text don't.
- On a phone, 4×4 is the comfortable maximum for a puzzle grid; 3×3 if your prompts run longer than ~8 words. Long prompts shrink to fit and can be tapped to read in full, but short ones play better.
- Make `mapSize` match your image's shape (a 3:2 landscape photo → e.g. `[6, 4]` maps of 4×4 → 24×16 pixels).

## Getting Claude to write puzzles

Paste something like this into Claude, filling in the brackets:

> Write puzzles for my Word Map game as JSON. I need **[N] puzzles**, each with exactly **[16] pairs**. Themes: **[list them, or "pick varied themes around X"]**. Each pair is `["prompt", "answer"]`.
> Rules: answers are one word (two at most) and unique within a puzzle; prompts under 10 words; every prompt has exactly one answer that fits among the others in its puzzle; mix difficulty; no answer appears in its own prompt.
> Output only the `"puzzles": [...]` array, in this shape: `{ "theme": "...", "pairs": [["prompt","answer"], ...] }`.

Then paste the result into your map file. Check facts on trivia sets; mistakes happen.

## Haptics

- **Android (Chrome, Firefox, Samsung Internet):** full vibration. A short tap per match, a longer pattern per finished grid, and a big one when the whole map is revealed.
- **iPhone/iPad:** Apple doesn't let websites use the vibration motor. On iOS 18+ the game uses a workaround (the system "switch" tick) to give a light tap on matches and a few taps on completion. It's subtler than Android and Apple could change it. On older iOS there's no haptic at all.
- Toggle haptics from the home screen.

## Progress

Progress saves on each device in the browser. If you and your wife play on separate phones, each phone has its own progress; sharing one map between phones would need a small online database (e.g. Firebase), which is a reasonable next step if you want it. Clearing browser data erases progress. **Reset** on a map's screen starts it over.
