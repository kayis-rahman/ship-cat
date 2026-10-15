# Ember — pet sprite asset and provenance

Ember is a realistic red fox and replaces the `cat.fill` SF Symbol as the pet's
sprite. It carries the captain's redirect of 2026-10-14 ("spry, Irish-accented
fox") plus this round's verbatim direction: **"Ember we can go with but make
pupils make green."**

## Files

| File | What it is |
|---|---|
| `ember.png` | **The asset.** 512x512 RGBA PNG, transparent background. Loaded by `PetView` in `App/ShipcatPetApp.swift` as the pet sprite. |

SHA-256 `ember.png`: `1eb1c514c7b925246902dadb249872fa0ecc8dc29ccd3f012dde1305f3ec9810`

## Provenance

### Source prototype (unchanged reference render)

Path:
`/Users/kayisrahman/Documents/workspace/firstmate/data/shipcat-realistic-character-prototypes-v1/artifacts/ember.png`

SHA-256: `88549b3e531784335ecaf5a37c39b15abaaf2e26a36a7af7510852b3c8be9ff4`

From that task's scout report (`report.md` §6 and the review board card):

- **Model:** `mlx-community/flux2-klein-9b-4bit` (FLUX.2 Klein, 4-bit), served by
  `mlx-serve 26.10.2 (MLX 0.32.3)`, loopback-only instance.
- **Seed:** `101`
- **Resolution:** 1024x1024
- **Steps:** 8
- **Route:** `POST /v1/images/generations`, `response_format: "b64_json"`.
- **Alpha:** none — FLUX cannot emit alpha, so the prototype bakes in a plain
  soft light-grey background (sampled corner RGB `(193,193,194)`).

### The green-pupil change

The captain's change is the pupil colour only. The local MLX module exposes
**`/v1/images/edits`**, an image-conditioned route, so the established Ember
render was used as the reference instead of regenerating from text alone:

- **Reference image:** `source-ember.png` (the prototype above, byte-identical).
- **Prompt:** the prototype's exact prompt, with the eye-clause term swapped from
  `bright amber eyes` to `bright vivid green eyes with large round green pupils`
  and nothing else altered:

  > A high-quality 3D CGI character render of a red fox (Vulpes vulpes), warm
  > rust-orange coat, cream-white chest and tail tip, black legs and ear backs,
  > bright vivid green eyes with large round green pupils, spry confident alert
  > expression, spry lively fox in a confident alert pose, expressive charming
  > face, anatomically natural fox proportions with a pointed muzzle, large alert
  > ears and a bushy tail, high-quality 3D CGI character render in the style of a
  > modern animated feature film (Pets United / Illumination-class polish),
  > polished convincing fur shading, full body, centered three-quarter view,
  > fixed camera and scale, soft even studio lighting, plain soft light-grey
  > neutral background, clean readable silhouette, natural fur detail, no props,
  > no collar, no clothing, no text, no UI, no symbols, distilled realistic
  > character-design concept sheet for a tiny floating desktop companion icon

- **Negative prompt:** `amber eyes, yellow eyes, orange eyes, brown eyes, red
  eyes, blue eyes, text, watermark, logo, UI, caption, props, collar, clothing,
  hat, glasses, extra fox, second fox, cropped, zoomed, different pose, different
  camera angle, distorted anatomy, blurry`
- **Settings:** `seed 101`, `steps 8`, `size 1024x1024`, `b64_json` — identical to
  the prototype, so only the reference image and the eye clause differ.
- **Output:** `/tmp/ember-asset/out/ember-c1-green-minimal.png`, SHA-256
  `da113306db427ea2585dc7e44ebe7170dd9566957bbeb72789b6c85ef58e33b0`.

### Control experiment (drift measurement)

To prove the residual difference against the prototype is the route's own noise
floor and not the pupil change, a control render was produced with the
**prototype's prompt verbatim** (amber eyes) and otherwise identical settings.
Measured with the same silhouette/coat/eye pixel analysis on both:

| Metric | control vs prototype | green vs prototype |
|---|---|---|
| subject coverage | 24.91% vs 24.52% (Δ 0.38 pp) | 24.93% vs 24.52% (Δ 0.40 pp) |
| silhouette bbox width | Δ 22 px of 1024 (2.1%) | Δ 25 px of 1024 (2.4%) |
| silhouette bbox height | Δ 10 px | Δ 0 px |
| centroid | Δ 8 px x, 5 px y | Δ 9 px x, 0 px y |
| subject mean RGB | (155,104,77) vs (157,109,83) | (155,105,77) vs (157,109,83) |
| green eye pixels | 0 (amber retained) | 828, mean `(111,183,8)` |
| background mean | (187,187,186) vs (193,192,193) | (188,187,186) vs (193,192,193) |

The control's residual drift is the same magnitude as the approved asset's, so
the pose, framing, coat and proportions are anchored to the established render
and the only intentional difference is the eye hue. Markings, proportions and
framing stay consistent with the prototype.

### Background cutout

FLUX has no alpha channel, so the transparent sprite was produced by a **local
background removal pass** (no external service): a median background colour is
sampled from the render's border ring, then a border-seeded flood fill credits
every reachable neutral light-grey pixel as backdrop. The cream-white chest and
tail tip, the black socks, and the pale ground shadow are not reachable from the
border and stay opaque. The mask is then feathered (two 3x3 box blurs plus a
contrast curve) to 27.77% fully opaque / 3.26% partially transparent at 512x512,
and downscaled with high-quality filtering.

This is a matte, not a generated alpha channel; the colour information is the
same pixels the module emitted.

### 96px legibility

Downscaled to the contract's 96px glance size, the silhouette (big ears, bushy
tail, white chest and tail tip, black socks) still reads, and the green pupils
are still visible. No lifecycle behaviour is expressed by the artwork — see
below.

## Privacy contract

The app's lifecycle-only contract is unchanged and the asset preserves it:

- Lifecycle is expressed through **shape, accent or tint only**. The sprite is
  drawn in `PetView` and tinted by the current lifecycle via `foregroundStyle`.
- **No task text, no props, no collar, no clothing, and no text or UI** appear in
  the artwork; the negative prompt above enforces that.
- Accessibility labels are separate from the artwork and stay in
  `ShipcatPetApp.swift` (`"Shipcat pet, <state>"`), never derived from the
  artwork.
