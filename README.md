# Shipcat

Shipcat is a native macOS lifecycle pet: a floating desktop companion with menu-bar controls. The native app uses SwiftUI and AppKit, reads Firstmate's canonical v1 JSONL ledger read-only, and has no daemon, IPC, Clawd dependency, or network client. Minimum supported macOS is 14.

The pet displays lifecycle state only. It never displays ledger text. OS notifications are opt-in and do not repeat; login at launch is managed through `SMAppService`.

## Build and test

```sh
swift test
xcodebuild -project Shipcat.xcodeproj -scheme ShipcatPet -configuration Debug -sdk macosx CODE_SIGNING_ALLOWED=NO build
```

For a native window properties and in-app PNG render assertion, build the app and launch its executable with `--render-test`. This writes a synthetic pet snapshot to `/tmp/shipcat-pet-render.png`; it does not use screen capture.

## Distribution

Shipcat uses direct Developer ID distribution, not the Mac App Store. See [distribution steps and captain prerequisites](docs/distribution.md). `scripts/package-macos.sh --dry-run` prints the packaging, hardened-runtime signing, notarization, and staple commands without running them. Do not use `--execute` until the captain provides a Developer ID certificate and notarization credentials.

## Product and migration records

- [Native app contract](docs/native-app-contract.md)
- [Verification boundaries](docs/verification.md)
- [Developer ID packaging](docs/distribution.md)
- [Archived Path A charter](docs/archive/legacy-path-a-charter.md)
- [Legacy JS bridge archive and parity checklist](docs/archive/legacy-js-bridge.md)

The old JavaScript CLI, Clawd sink, LaunchAgent generator, and nudges remain in the repository as reference only. The parity checklist in the archive note is verified complete; the JS tree and its history remain until the captain approves the archive disposition. The historical Clawd M0 was not passed.
