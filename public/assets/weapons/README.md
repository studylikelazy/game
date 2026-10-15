# Original sword artwork

`longsword.png` is an original AI-generated sword image, chroma-keyed to transparent RGBA and tightly cropped to 216 × 748 pixels. No Path of Exile artwork was used. It depicts a beveled steel blade, weathered brass crossguard, leather wrap and faceted pommel.

`longsword-ui.webp` is a lossless, padded inventory version (256 × 768). Both are shipped as static assets; no image generation or processing is needed to build/play the game.

The renderer anchors the crossguard at 73.9% of image height. The heavy sword uses the same material illustration at a larger size. Other weapon types retain their existing art and do not silently become swords. Procedural sword geometry remains as a fallback while the image loads or if it fails to load.
