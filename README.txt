fira: open index.html in a browser, or in VS Code use the Live Server extension.
Files:
  index.html   page structure
  style.css    colours (the tokens at the top), fonts and layout
  script.js    globe, map, charts, filters and the risk model
  data/i18n.js all text in English and Arabic
  data/oman.js Oman fire detections (built from the NASA FIRMS files)
  data/world.js country borders (Natural Earth, public domain)
Fonts load from Google Fonts when online. Offline, the browser uses its default fonts.

--- Cinematic version ---
The home page is a scroll journey: the globe flies from space down to Oman while short scenes fade in.
The globe is drawn with WebGL 2 from NASA Blue Marble images stored in data/earth.js
(day, night lights, clouds). Borders, Oman and the fire glow are drawn on a second canvas on top.
If a browser has no WebGL 2, a simpler flat-coloured globe is drawn instead.
Camera path and scene timing: PATH and SCENES near the top of the globe section in script.js.
Fonts: Jost (English), Noto Kufi Arabic and IBM Plex Sans Arabic (Arabic), loaded from Google Fonts.
