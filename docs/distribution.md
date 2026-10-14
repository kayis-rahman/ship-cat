# Developer ID distribution

Shipcat targets macOS 14 and distributes directly, not through the Mac App Store. The application is not sandboxed and must be signed with Developer ID using the hardened runtime. The packaging script creates a Developer ID archive, verifies its signature, builds a compressed DMG, submits it using `notarytool`, staples the notarization ticket, and validates the staple.

## Dry run

Run `scripts/package-macos.sh --dry-run` (the default) to print the exact commands with placeholders. Dry-run does not build, sign, create a DMG, contact Apple, or modify the checkout. The flow was dry-run only for this task. No signing or notarization commands were executed.

## Release prerequisites and execution

The captain must provide:

- A valid **Developer ID Application** certificate installed in the login keychain and its exact identity string (`DEVELOPER_ID`).
- Apple notarization credentials saved as a `notarytool` keychain profile (`NOTARY_PROFILE`). Set these environment variables and explicitly run `scripts/package-macos.sh --execute` on the release Mac. Keep credentials out of the repository and shell history.

The script writes a `.xcarchive` and a stapled `build/ShipcatPet-DeveloperID.dmg`. This task does not validate certificate availability, Apple account access, notarization, staple validation, installation on a clean Mac, or actual signing. Do not run `--execute` until the captain supplies the prerequisites and approves the release operation.
