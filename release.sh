#!/bin/sh
# Builds PR Tour as a universal, signed and notarized app in a .dmg to hand to
# someone else. They need neither Rust, Node nor a checkout.
#
# Needs, once:
#   - a "Developer ID Application" certificate in the keychain
#   - notarization credentials in the keychain, stored under a profile name:
#       xcrun notarytool store-credentials pr-tour --apple-id <you@example.com> --team-id <team id>
#     (it asks for an app-specific password from account.apple.com)
#
# PR_TOUR_SIGNING_IDENTITY picks a certificate, PR_TOUR_NOTARY_PROFILE a profile
# (default: pr-tour). --no-notarize builds and signs only, to try it locally.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
notarize=yes
for arg in "$@"; do
  case $arg in
    --no-notarize) notarize=no ;;
    *) echo "usage: release.sh [--no-notarize]" >&2; exit 2 ;;
  esac
done

identity=${PR_TOUR_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)}
[ -n "$identity" ] || { echo "release.sh: no Developer ID Application certificate in the keychain" >&2; exit 1; }
profile=${PR_TOUR_NOTARY_PROFILE:-pr-tour}
if [ "$notarize" = yes ] && ! xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1; then
  echo "release.sh: no notarization credentials under the profile \"$profile\"; see the top of this script" >&2
  exit 1
fi

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target list --installed | grep -qx "$target" || rustup target add "$target"
done

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$repo/app/src-tauri/tauri.conf.json")
bundle="$repo/app/src-tauri/target/universal-apple-darwin/release/bundle"
app="$bundle/macos/PR Tour.app"
out="$repo/release"
dmg="$out/PR-Tour-$version.dmg"

echo "Building PR Tour $version, signed by $identity"
(cd "$repo/app" && npm ci --silent && APPLE_SIGNING_IDENTITY="$identity" npx tauri build --target universal-apple-darwin --bundles app)
codesign --verify --strict --deep "$app"

submit() {
  result=$(xcrun notarytool submit "$1" --keychain-profile "$profile" --wait --timeout 30m)
  echo "$result"
  case $result in
    *"status: Accepted"*) ;;
    *) echo "release.sh: notarization failed; xcrun notarytool log <id> --keychain-profile $profile shows why" >&2; exit 1 ;;
  esac
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ "$notarize" = yes ]; then
  echo "Notarizing the app"
  ditto -c -k --keepParent "$app" "$work/app.zip"
  submit "$work/app.zip"
  xcrun stapler staple "$app"
fi

echo "Packing $dmg"
mkdir -p "$work/image" "$out"
ditto "$app" "$work/image/PR Tour.app"
ln -s /Applications "$work/image/Applications"
hdiutil create -quiet -volname "PR Tour" -srcfolder "$work/image" -fs HFS+ -format UDZO -ov "$dmg"
codesign --sign "$identity" --timestamp "$dmg"

if [ "$notarize" = yes ]; then
  echo "Notarizing the disk image"
  submit "$dmg"
  xcrun stapler staple "$dmg"
  spctl --assess --type open --context context:primary-signature "$dmg"
fi

echo "Done: $dmg"
