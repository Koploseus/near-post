# Notes for AI coding agents

- UI text is English. The look is "Floodlight Pixel": a night match under
  floodlights. Night surfaces #1A1240 / #120C30 / #251A57, outline #0B0820,
  text #F3EAD7, brand red #C8202F, yellow #F2B705, club blue #2F5DA8, green
  #45D483. Pixelify Sans for display and buttons, Press Start 2P for scores
  and counters only, Archivo for body text. Pixel borders, no rounded corners.
  Illustrations live in `apps/web/public/art/` (see its manifest). No licensed
  asset packs, no real club, player or sticker-album brand. The official logo
  (`public/logo.svg`) is unchanged.
- Build contract wasm only inside the pinned image
  (`sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf…`), mounted at
  `/__w/near-post/near-post` like the CI. A wasm built anywhere else embeds local
  paths and will not match the CI hash. Commit `contracts/res/*.wasm` from that build.
- No admin key, owner or upgrade method in any contract. Only the league mints.
- No bets, no wagering mechanics.
- Use the latest released versions of tools, but respect pnpm's
  minimum-release-age policy: do not bypass it.
- Do not merge to `main` without the owner's explicit go.
