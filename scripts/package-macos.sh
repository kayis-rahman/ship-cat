#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:---dry-run}"
ARCHIVE="$ROOT/build/ShipcatPet.xcarchive"
APP="$ARCHIVE/Products/Applications/ShipcatPet.app"
DMG="$ROOT/build/ShipcatPet-DeveloperID.dmg"
PROFILE="${NOTARY_PROFILE:-<keychain-profile>}"
IDENTITY="${DEVELOPER_ID:-<Developer-ID-Application-identity>}"

run() {
  if [[ "$MODE" == "--dry-run" ]]; then
    printf 'DRY RUN:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

if [[ "$MODE" != "--dry-run" && "$MODE" != "--execute" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi
if [[ "$MODE" == "--execute" ]]; then
  : "${DEVELOPER_ID:?Set DEVELOPER_ID to the Developer ID Application identity}"
  : "${NOTARY_PROFILE:?Create and set NOTARY_PROFILE for notarytool keychain-profile}"
fi

if [[ "$MODE" == "--execute" ]]; then mkdir -p "$ROOT/build"; fi
run xcodebuild -project "$ROOT/Shipcat.xcodeproj" -scheme ShipcatPet -configuration Release -archivePath "$ARCHIVE" archive CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$IDENTITY" ENABLE_HARDENED_RUNTIME=YES CODE_SIGN_ENTITLEMENTS="$ROOT/App/Shipcat.entitlements"
run codesign --verify --deep --strict --verbose=2 "$APP"
run hdiutil create -volname Shipcat -srcfolder "$APP" -ov -format UDZO "$DMG"
run xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
run xcrun stapler staple "$DMG"
run xcrun stapler validate "$DMG"

if [[ "$MODE" == "--dry-run" ]]; then
  echo "No signing, packaging, notarization, or stapling command was executed."
fi
