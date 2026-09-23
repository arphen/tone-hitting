# Tone Hitting

Tone Hitting is a tiny browser ear-training game for practicing the C-major solfege scale. Sing the highlighted note and your live pitch moves the ball vertically. Clear each gate by holding the right pitch as it slides across the screen.

The game runs pitch analysis locally in the browser. It does not record or upload audio. The first microphone start performs a short quiet-room check, then filters voiced pitch before it moves the ball. Use the range selector to choose Lower (C3–C4) or Higher (C4–C5), and use Hear Target when you want a reference tone.

## Run locally

Because microphone access is restricted on insecure origins, serve the folder over localhost:

```bash
npm install
npm run dev
```

Then open [http://localhost:4173](http://localhost:4173).

Use **Try demo mode** if you want to see the game without granting microphone access. For a production-style check, run `npm run build` and `npm run preview`.

## Checks

```bash
npm test
npm run build
```

For the final MacBook check, allow microphone access, stay quiet through calibration, then hold each highlighted note until the gate passes. Stop or reset the game to release the microphone.
