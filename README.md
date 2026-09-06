# FixLinks

FixLinks watches the system clipboard. It changes supported social-post links to hosts that produce Discord-friendly embeds.

## Features

- Runs from the system tray. It does not open a main window.
- Rewrites direct Instagram, X/Twitter, and TikTok post links.
- Lets you choose the destination hostname for each service in the **Fix services...** window.
- Preserves the URL scheme, path, query string, fragment, and outer whitespace unless metadata removal is enabled.
- Reads and writes the clipboard locally. It does not make network requests.
- Pauses from the tray menu without changing the saved run-at-login setting.
- Prevents duplicate application instances.
- Supports Windows startup through the packaged Squirrel application.

## Supported links

| Service | Direct post paths | Default embed host |
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
5. Right-click the tray icon to pause monitoring, remove URL metadata, enable or disable individual services, open **Fix services...**, change **Run at login**, or exit.

- **Remove metadata** removes the query string and fragment from converted links. It is disabled by default. The setting is saved between launches.
- **Services** controls Instagram, X/Twitter, and TikTok independently. All services are enabled by default.
- **Fix services...** opens the destination-hostname window. Enter the full hostname that your chosen provider publishes, for example `example.com`. **Save** applies all three hosts after the current clipboard poll and keeps them for later launches. **Restore defaults** changes the fields only. Select **Save** to apply the defaults. **Cancel** and closing the window discard unsaved edits.
- **Enabled** pauses clipboard monitoring for the current session.
- Service choices, destination hosts, and **Run at login** are saved between launches.

Hostname rules:

- Use a full DNS hostname with at least two labels, for example `embed.example.com`. Use the hostname published by the provider, not its service name.
- Use ASCII letters, digits, and internal hyphens. Subdomains and valid ASCII punycode labels are allowed. Each label must have 1 to 63 characters. The full hostname must have no more than 253 characters.
- FixLinks removes outer whitespace and changes ASCII letters to lowercase. It rejects schemes, paths, queries, fragments, ports, credentials, IP addresses, source platform hosts, internal whitespace, backslashes, and a final dot.
- A hostname check cannot prove that the provider supports the platform paths or shows working embeds. Opening or sharing a rewritten link sends it to your chosen third-party provider.
- Changing a destination host does not enable a disabled service and does not change links already converted earlier. Your provider must accept the platform's existing URL paths.
- FixLinks never makes network requests to check a provider.
- Missing saved hosts use their platform defaults. If a saved host is invalid, FixLinks opens the settings window with a warning and uses that platform's default. It keeps valid hosts and unrelated settings. The invalid saved value remains unchanged until you select **Save**.

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

The project records its runtime and build dependencies in `package.json` and `package-lock.json`.

## Project layout

- `src/main.ts`: Electron lifecycle, tray menu, settings window, login settings, and clipboard polling.
- `src/link-transformer.ts`: safe direct-link transformation rules and destination-host validation.
- `src/clipboard-monitor.ts`: clipboard read/write coordination and race protection.
- `src/renderer/`: settings window assets used by **Fix services...**.
- `test/`: Node.js built-in test coverage.
- `forge.config.cjs`: Electron Forge and Squirrel configuration.
- `assets/fixlinks.ico`: application and installer icon.

## License

This project is licensed under the BSD Zero Clause License (0BSD). See `LICENSE`.

## GitHub Actions

- `.github/workflows/ci.yml` runs tests and a TypeScript build on pushes and pull requests targeting `main`.
- `.github/workflows/release.yml` builds and publishes a Windows GitHub Release when a matching `v*` tag is pushed. The tag must match the version in `package.json`.
