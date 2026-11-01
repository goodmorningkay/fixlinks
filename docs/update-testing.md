# Update release checks

Run `npm run check`, then `npm run make`. Set `GITHUB_REF_NAME` to the tag that matches `package.json`, then run `npm run verify:release`. These checks also run in GitHub Actions.

`npm test` uses a simulated updater and clock. It covers scheduled checks, manual checks, duplicate requests, first-run delay, disabled automatic updates, failed checks, interrupted downloads, restart failures, shutdown, tray states, and invalid release files.

## Repeat the installed update test

On Windows, run:

```sh
npm run test:installed
```

This command builds and installs two test releases, versions 1.3.1 and 1.3.2. Each run uses a separate package name, executable, install folder, settings folder, and startup entry. The normal FixLinks installation and settings stay separate.

The test uses the real Electron and Squirrel updater. A bootstrap in the test builds redirects the production feed address to a local HTTP server that supplies the same Squirrel manifest and full-package format. It supplies test clipboard text and dialog responses, then calls the production tray handlers. The production app has no test endpoint or feed override.

The test checks the public GitHub feed separately. It then checks manual updates, network errors, interrupted downloads, retry, settings saved before restart, restart into the newer version, settings and startup entry retention, the single-instance lock, automatic checks, background downloads, and normal exit followed by launch.

The command uninstalls the test app when the test ends. It saves the result and request history in `out/fixlinks-update-test-{run}/report.json`, with native updater events in `events.jsonl`. No GitHub release is published. The full publication path still needs a suitable production release.

## Installed Windows checks

Use a Windows test account or VM. Use two increasing stable versions that include the updater. The first release with updater support needs a manual installation.

1. Install the older version through `FixLinksSetup.exe`. Confirm that only one app instance runs.
2. Save custom destination hosts, service choices, metadata removal, and the run-at-login setting. Restart and confirm that the settings remain saved.
3. Disable **Automatic updates**. Confirm that a manual check still runs and reports that the installed version is current.
4. Disconnect the network. Run a manual check and confirm that it reports a failure. Confirm that clipboard conversion still works. Reconnect and retry.
5. Publish the newer version through the release workflow. Check the public feed at `https://update.electronjs.org/goodmorningkay/fixlinks/win32-x64/{older-version}/RELEASES`. Confirm that it identifies the newer full package. Allow for service caching.
6. Select **Check for update** in the older app. Confirm the checking and downloading tray states. Repeated menu actions must not start a second download.
7. Interrupt the network during a download. Confirm that a failed download permits a retry after the network returns.
8. When the download completes, confirm that a tray notification appears and **Restart to update** becomes available. Confirm that the app keeps working until restart.
9. Open **Fix services...** and edit a field. Select **Restart to update**. Confirm that **Return to settings** allows you to save the change. Repeat with **Discard changes and restart**.
10. After restart, confirm that the tray shows the newer version. Confirm saved settings, clipboard conversion, run-at-login, and the single-instance lock.
11. Repeat the download, then exit normally and start FixLinks again. Confirm that the newer version starts.
12. Enable **Automatic updates**. Confirm that the startup check runs after 30 seconds and stays quiet when no update is available. Confirm that a background download produces the ready notification.
13. Run the unpacked app and the development app. Confirm that update controls are disabled and that neither makes update requests.

Confirm separately that a draft or prerelease is not offered through the stable feed. Do not publish a test release to the production repository unless it is ready for users. The local installed test verifies installation, download, and restart without publication. Use two suitable published releases to check the full GitHub publication path.
