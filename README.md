# FixLinks

FixLinks watches the system clipboard and changes supported social-post links to hosts that produce Discord-friendly embeds.

## Features

- Runs from the system tray. It does not open a main window.
- Rewrites direct Instagram, X/Twitter, and TikTok post links.
- Preserves the URL scheme, path, query string, fragment, and outer whitespace.
- Reads and writes the clipboard locally. It does not make network requests.
- Pauses from the tray menu without changing the saved run-at-login setting.
- Prevents duplicate application instances.
- Supports Windows startup through the packaged Squirrel application.

## Supported links

| Service | Direct post paths | Embed host |
| --- | --- | --- |
| Instagram | `/p/{code}`, `/reel/{code}`, `/tv/{code}` | `kkinstagram.com` |
| X/Twitter | `/{handle}/status/{id}`, `/i/status/{id}`, `/i/web/status/{id}`; optional `/photo/{number}` or `/video/{number}` | `fixupx.com` |
| TikTok | `/@{account}/video/{id}`, `/@{account}/photo/{id}` | `tnktok.com` |

Example:

```text
https://www.instagram.com/reel/ABC123/?igsh=example
→ https://kkinstagram.com/reel/ABC123/?igsh=example
```

FixLinks only changes one direct `https://` URL. It leaves profiles, short links, redirect links, unsupported paths, multiple URLs, credentials, explicit ports, and malformed input unchanged. Already converted hosts are not converted again.

## Use the Windows app

1. Run `FixLinksSetup.exe`.
2. Start FixLinks. The app appears in the system tray.
3. Copy a supported post link.
4. Paste the changed link into Discord.
5. Right-click the tray icon to pause monitoring, enable it again, change **Run at login**, or exit.

The installer is created at:

```text
out/make/squirrel.windows/x64/FixLinksSetup.exe
```

## Build from source

### Requirements

- Node.js 24.x
- npm

Install dependencies:

```sh
npm install
```

Run the tests:

```sh
npm test
```

Start the development application:

```sh
npm start
```

Create a packaged application:

```sh
npm run package
```

Create the Windows installer:

```sh
npm run make
```

The project pins its runtime and build dependencies in `package.json` and `package-lock.json`.

## Project layout

- `src/main.ts` — Electron lifecycle, tray menu, login settings, and clipboard polling.
- `src/link-transformer.ts` — safe direct-link transformation rules.
- `src/clipboard-monitor.ts` — clipboard read/write coordination and race protection.
- `test/` — Node.js built-in test coverage.
- `forge.config.cjs` — Electron Forge and Squirrel configuration.
- `assets/fixlinks.ico` — application and installer icon.
