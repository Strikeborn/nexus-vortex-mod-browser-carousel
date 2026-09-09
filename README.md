# Nexus Vortex Mod Browser Carousel w/ 1 click install

A Vortex extension that replaces the default Browse tab with a carousel-style Nexus mod grid: configurable rows/columns, batch paging, Vortex-side filters, one-click install, and optional hide-title-and-address-bar mode.

## Requirements

- [Vortex Mod Manager](https://www.nexusmods.com/about/vortex/)
- Only enable **one** Browse-tab extension at a time (this one replaces older Browse carousel forks)

## Install (local build)

```powershell
npm install
./deploy.ps1
```

Fully restart Vortex after deploy.

## Install (release bundle)

1. Download `mod-browser-carousel.7z` from [GitHub Releases](https://github.com/Strikeborn/nexus-vortex-mod-browser-carousel/releases)
2. In Vortex: **Settings → Extensions**
3. Drag the `.7z` onto the extensions page (or use **Install from file**)

## Build release bundle

```powershell
npm run package
```

Produces `mod-browser-carousel.7z` containing `index.js` and `info.json`.

## License

GPL-3.0 — free to use, modify, and share; see [LICENSE](LICENSE) and [ATTRIBUTION.md](ATTRIBUTION.md). Upstream: [MaverickMartyn/builtin-mod-browser](https://github.com/MaverickMartyn/builtin-mod-browser).

## Publishing

See [PUBLISHING.md](PUBLISHING.md).
