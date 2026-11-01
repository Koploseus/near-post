# Notes for AI coding agents

- UI text is English. The look is the sticker album + tifo direction: paper
  #F3EAD7, ink #1B2340, red #C8202F, yellow #F2B705, club blue #2F5DA8,
  Archivo Black for titles, Archivo for text. No licensed asset packs, no real
  club, player or sticker-album brand.
- Build contract wasm only inside the pinned image
  (`sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf…`), mounted at
  `/__w/near-post/near-post` like the CI. A wasm built anywhere else embeds local
  paths and will not match the CI hash. Commit `contracts/res/*.wasm` from that build.
- No admin key, owner or upgrade method in any contract. Only the league mints.
- No bets, no wagering mechanics.
- Use the latest released versions of tools, but respect pnpm's
  minimum-release-age policy: do not bypass it.
- Do not merge to `main` without the owner's explicit go.
