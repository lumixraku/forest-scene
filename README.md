# Cozy Forest · Three.js

A walkable forest-stream scene built with Three.js.

The look is inspired by [this post from Protopop Games](https://x.com/protopop/status/2065613107729145977) showing their game *Cozy Country* — a bright grassy valley with a foamy stream running through it. This project recreates that mood entirely procedurally: every texture (leaf clusters, bark, flowers, rocks, ground) is drawn on canvas at runtime, with no external art assets.

## Preview

![Preview](preview.png)

## Highlights

- 60k instanced grass tufts with a baked root-to-tip color gradient and wind sway
- Card-foliage tree crowns (deciduous, birch, spruce) with alpha-tested depth materials for dappled sunlight shadows
- A meandering stream valley with an animated foam ribbon, reflective water, and rounded textured boulders
- Lupine-like flower spikes and meadow flowers along the banks
- Blazing summer-afternoon light: high golden sun, saturated blue sky, ACES tone mapping, a faint heat haze in the far distance

## Controls

| Action | Input |
|--------|-------|
| Look around | Mouse drag |
| Zoom | Scroll wheel |
| Move | WASD / arrow keys |
| Sprint | Shift |

## Setup

```bash
npm install
npm run dev
```
