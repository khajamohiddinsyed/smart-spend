#!/bin/bash
# Builds the signed Android release from ../app. Output: dist/SmartSpend.apk
# The signing key stays outside the repo: ~/.android/smartspend-release.jks,
# password in the macOS Keychain (service "smartspend-release-keystore").
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export SS_KEYSTORE="$HOME/.android/smartspend-release.jks"
SS_KEYSTORE_PASS="$(security find-generic-password -s smartspend-release-keystore -a "$USER" -w)"
export SS_KEYSTORE_PASS
npx cap sync android
(cd android && ./gradlew --quiet assembleRelease)
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/SmartSpend.apk
shasum -a 256 dist/SmartSpend.apk
ls -l dist/SmartSpend.apk
