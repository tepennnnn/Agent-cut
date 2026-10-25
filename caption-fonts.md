# Caption font selection

Story Studio now separates **Caption style** (animation/layout) from **Caption font** (typeface). Choose a font to see it in the live sample. For an existing story, choose **Save story changes**, then **Compose preview** and review before exporting. Narration, caption text, image assignments and timing do not change when only the font changes. **Preset default** preserves the existing style's font. Existing saved stories keep their prior appearance until explicitly edited.

The main editor also has **Titles & captions → Caption font**. This changes the sequence font while retaining its animated preset. Main-editor font changes support the existing undo flow. Default title/caption style dialogs also expose the expanded font list. Animated captions use a sequence font; per-cue typography applies to static captions.

## Included choices

| Typeface | Suggested use |
|---|---|
| Montserrat ExtraBold | Versatile bold captions; business and education |
| Inter Bold | Interviews, technology and clear explanations |
| Poppins Bold | Friendly lifestyle, wellness and general storytelling |
| Roboto Condensed Bold | Longer captions, news and explainers |
| Oswald Bold | Documentary, sports and compact headlines |
| Anton | Heavy, punchy hooks |
| Bebas Neue | Tall uppercase hooks and short captions |
| Archivo Black | Bold statements and headlines |
| Bangers | Playful gaming, comics and entertainment |
| Lora SemiBold | Serif storytelling and cinematic/editorial presentation |

The three existing system choices remain available: regular/bold sans and serif. These use Arial/Arial Bold/Times New Roman on Windows and the existing approved fallbacks on other platforms.

These usage suggestions are design recommendations, not rankings of current viral clips or guarantees of performance. For general spoken captions start with Montserrat, Inter or Poppins; use condensed/display styles for short emphasis. Font coverage varies by language; existing missing-glyph warnings and wrapping/overflow checks remain in place.

## Offline assets and provenance

Ten font families are bundled under fonts/, downloaded from the official [Google Fonts repository](https://github.com/google/fonts). Its pinned source commit, original and bundled SHA-256 hashes, byte sizes and chosen weights are recorded in fonts/inventory.json. Every family retains its OFL.txt. Runtime font loading uses only authenticated local files and never downloads a font.

For variable upstream fonts, build-only fontTools 4.60.1 produced static weight instances. Their internal family, full and PostScript names were changed to AgentCut-specific names; original copyright and license records remain. Each derived instance includes MODIFICATIONS.txt. The application does not need Python/fontTools to render the bundled fonts.

## Agent tools

`story_sync action=caption_fonts` returns the local catalog. `generate` and `update` accept `captionFont` as `preset` or an enumerated font ID. Read project/story identity and revisions before updating. `caption_styles` continues to return the animation catalog.

For sequences, `sequence_caption_style` accepts the selected font in `values.font`; preserve an animated style with `motion` and `motionFont`. Use `timeline_operations` for its closed contract. Selected animated fonts are stored in `captionMotion.font`. Frozen rendering requests fingerprint the selected font, so changed font files reject retries instead of silently substituting different typography.

## Evidence

See caption-fonts-verification.json and the companion outputs/agent-cut-caption-fonts-demo directory. Tests exercise all 260 bundled-font/animation combinations, distinct font pixels, font licenses/hashes, save/reload, review invalidation, real preview/export, mobile overflow, and main-editor font changes/undo without disabling the animation.
