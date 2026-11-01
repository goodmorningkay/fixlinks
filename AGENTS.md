# Repository Guidelines

FixLinks is a Windows x64 Electron tray app for clipboard links. Use Node.js 24.x and npm.

## Project Structure & Module Organization

- `src/main.ts`: app lifecycle, tray menu, settings, and Electron integration.
- `src/link-transformer.ts`, `src/clipboard-monitor.ts`, and `src/update-manager.ts`: link rules, clipboard coordination, and update control.
- `src/renderer/`: settings HTML, CSS, JavaScript, and preload bridge.
- `test/`: unit tests and installed-app fixtures. `assets/` contains the app icon.
- `scripts/`: build helpers, release validation, and the installed update test.
- `.github/workflows/`: CI and release workflows. `forge.config.cjs` defines packaging.

Treat `dist/`, `dist-test/`, and `out/` as generated output. Do not edit or commit these folders.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependencies.
- `npm start`: build and start the development app.
- `npm run build`: compile TypeScript and copy renderer assets.
- `npm test`: compile and run unit tests.
- `npm run check`: check formatting, lint rules, tests, and compilation.
- `npm run make`: build the Windows installer under `out/make/squirrel.windows/x64/`.
- `npm run test:installed`: build and install two isolated test versions, test updates, then uninstall the test app.

## Coding Style & Naming Conventions

Use two spaces, UTF-8, LF line endings, single quotes, and no trailing commas. Run `npm run format` for Prettier and `npm run lint` for Biome. Use braces for control statements.

Keep TypeScript strict. Use `.js` suffixes in relative TypeScript imports. Use `camelCase` for functions and variables, `PascalCase` for types and classes, and `UPPER_SNAKE_CASE` for constants. Use lowercase file names with hyphens.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name files `test/*.test.ts` or `test/*.test.mjs`. Use descriptive behaviour names. Add tests for changed link rules, clipboard races, and update states. No numeric coverage target is configured.

For updater or packaging changes, run the Windows installed test. Follow `docs/update-testing.md` and inspect its saved report.

## Commit & Pull Request Guidelines

Prefer the existing `feat:`, `fix:`, and `docs:` prefixes, followed by a short action, such as `fix: prevent duplicate update checks`.

Describe the problem, resulting behaviour, and validation in each pull request. Link related issues. Include screenshots for visible UI changes. Run `npm run check` before submission.

## Security, Releases, and Agent Instructions

Keep clipboard text local. Preserve IPC sender checks, renderer isolation, and sandboxing. Keep release tags (`vX.Y.Z`) equal to the version in `package.json` and `package-lock.json`.

Use ASD-STE100 Simplified Technical English in agent replies and contributor documentation.
