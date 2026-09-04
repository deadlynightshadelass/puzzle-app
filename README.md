# Jigsaw

A jigsaw puzzle you play in the browser. Pick a picture, pick how many pieces,
click two pieces to swap them until the picture comes back together.

**Play it:** https://deadlynightshadelass.github.io/puzzle-app/

## What it does

- Real jigsaw shapes: every piece has knobs and sockets that match its neighbours
- Five difficulties, from 6 pieces up to about 100
- Any picture shape works: the grid adjusts so the pieces stay square
- Timer, move counter, and how many pieces are already home
- Peek button to see the finished picture
- Best time saved per picture and difficulty
- Light and dark mode
- Two player mode on one device: take turns, you score a point for every piece
  you put in its right place

## Running it

No build step, no install. Open `index.html` in a browser.

## Adding your own pictures

1. Put the image files in the `images/` folder.
2. Open `app.js` and add a line to the `IMAGES` list at the top:

   ```js
   { file: 'images/my-picture.jpg', title: 'My picture' },
   ```

Pictures work best when they are busy and colourful. A big empty sky makes
pieces that all look identical and the puzzle becomes guesswork. Keep each file
under about 500 KB so the page loads quickly.

The pictures currently in `images/` are film posters, included for a personal
learning project. Swap in your own photos any time by editing that same list.

## How the pieces are made

Each piece is a `<div>` showing the same photo, shifted so the right part of the
picture lands in that piece, then cut to shape with a CSS `clip-path`.

The shape comes from `edgeSegments()` in `app.js`. Every cut between two pieces
is drawn **once**, always left to right or top to bottom. The two pieces sharing
that cut both use the same curve, one forwards and one backwards, which is why a
knob always fits its neighbour's socket exactly.

## Built with

Plain HTML, CSS and JavaScript. No frameworks, no dependencies.
