# Client

`packages/client`. Source: spec section 5. The client imports `sim` and `bots`
and owns all rendering, input, audio and UI. See [packages](packages.md).

## Loop

Fixed-step accumulator. The sim steps at 60 Hz, rendering runs at the display
rate and interpolates positions between the last two ticks. Rendering never
steps the sim.

## Input

Keyboard and mouse map to a `PlayerInput` each tick. Mouse aim is a ray from
the camera to the ground plane, quantized to centimeters. The record is
defined in [simulation](simulation.md).

## Camera

Fixed, tilted about 55 degrees from horizontal, positioned so the whole arena
fits the viewport with margin. No rotation, no zoom in v1.

## Scene

Arena model and champion models loaded from glTF under `assets/models/`.
Projectiles and areas are simple meshes. Effects start as meshes and
billboards. Animations come from glTF clips once rigs exist. See
[assets](assets.md).

## HUD

An HTML and CSS overlay. Health and energy bars, cooldown icons per slot,
round score, round timer, ring warning, kill feed. A debug overlay draws
collision circles, obstacles, projectiles and line of sight.

## Platform interface

Steam readiness: `Platform { identity(), loadSettings(), saveSettings(),
unlockAchievement(id), openUrl(url) }`. `BrowserPlatform` is the only
implementation until milestone 8. Game code only talks to the interface.

## Steam readiness rules

- Game code only talks to the `Platform` interface.
- Assets load relative to the app base path, never from absolute URLs.
- Rendering scales from a browser tab to a fullscreen 4K desktop window:
  resolution-independent camera framing, device-pixel-ratio aware canvas.
