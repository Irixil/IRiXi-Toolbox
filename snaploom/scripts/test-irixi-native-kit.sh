#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
framework="$project_root/build/irixi-native-kit/IRiXiNativeKit.framework"
binary="$framework/IRiXiNativeKit"
smoke_binary="$project_root/build/irixi-native-kit/irixi-native-kit-smoke"

"$project_root/scripts/build-irixi-native-kit.sh"

xcrun clang \
  -std=c11 \
  "$project_root/tests/IRiXiNativeKitSmoke.c" \
  -o "$smoke_binary"

"$smoke_binary" "$binary"

nm -gU "$binary" | grep '_irixi_native_abi_version' >/dev/null
nm -gU "$binary" | grep '_irixi_native_copy_bundle_identifier' >/dev/null
nm -gU "$binary" | grep '_irixi_native_has_screen_capture_access' >/dev/null
nm -gU "$binary" | grep '_irixi_native_request_screen_capture_access' >/dev/null
nm -gU "$binary" | grep '_irixi_native_show_test_window' >/dev/null
nm -gU "$binary" | grep '_irixi_native_hide_test_window' >/dev/null
nm -gU "$binary" | grep '_irixi_native_start_area_capture' >/dev/null
nm -gU "$binary" | grep '_irixi_native_start_window_capture' >/dev/null
nm -gU "$binary" | grep '_irixi_native_start_fullscreen_capture' >/dev/null
nm -gU "$binary" | grep '_irixi_native_start_ocr_capture' >/dev/null
nm -gU "$binary" | grep '_irixi_native_start_image_translation_capture' >/dev/null
nm -gU "$binary" | grep '_irixi_native_cancel_area_capture' >/dev/null
nm -gU "$binary" | grep '_irixi_native_is_area_capture_active' >/dev/null
nm -gU "$binary" | grep '_irixi_native_initialize_translation' >/dev/null
nm -gU "$binary" | grep '_irixi_native_open_input_translation' >/dev/null
nm -gU "$binary" | grep '_irixi_native_translate_current_selection' >/dev/null
nm "$binary" | grep 'IRiXiImageEditorController' >/dev/null
nm "$binary" | grep 'IRiXiPinManager' >/dev/null
nm "$binary" | grep 'IRiXiTranslationCoordinator' >/dev/null
nm "$binary" | grep 'OverlayWindowController' >/dev/null
nm "$binary" | grep 'OverlayView' >/dev/null
nm "$binary" | grep 'AnnotationToolHandler' >/dev/null
nm "$binary" | grep 'ToolbarStripView' >/dev/null

# The host must open Snaploom's original overlay directly.  A simplified
# look-alike selector/editor is not an acceptable regression.
grep 'OverlayWindowController(capture: capture)' "$project_root/SnaploomApp/IRiXiNative/IRiXiRegionCapture.swift" >/dev/null
grep 'overlay.setAutoOCRMode()' "$project_root/SnaploomApp/IRiXiNative/IRiXiRegionCapture.swift" >/dev/null
grep 'overlay.setAutoTranslateOverlayMode' "$project_root/SnaploomApp/IRiXiNative/IRiXiRegionCapture.swift" >/dev/null
grep 'return \[.pin, .ocr, .translate\]' "$project_root/SnaploomApp/UI/Toolbar/ToolbarDefinitions.swift" >/dev/null
grep 'SnaploomApp/UI/Overlay/' "$project_root/scripts/build-irixi-native-kit.sh" >/dev/null

# Screenshot translation must reuse the full translation/speech window. A
# second OCR result window or translation bridge would split the feature again.
region_capture="$project_root/SnaploomApp/IRiXiNative/IRiXiRegionCapture.swift"
translation_coordinator="$project_root/SnaploomApp/IRiXiNative/IRiXiTranslationCoordinator.swift"
grep 'beginImageTranslation()' "$region_capture" >/dev/null
grep 'finishImageTranslation(requestID: requestID, text: text)' "$region_capture" >/dev/null
grep 'failImageTranslation(' "$region_capture" >/dev/null
grep 'showImageRecognitionPending' "$translation_coordinator" >/dev/null
if sed -n '/private final class IRiXiImageTranslationController/,/^}/p' "$region_capture" | grep 'IRiXiOCRResultController' >/dev/null; then
  echo 'screenshot translation must not use the standalone OCR result window' >&2
  exit 1
fi
if grep 'IRiXiAppleTranslationBridge' "$region_capture" >/dev/null; then
  echo 'unexpected duplicate screenshot translation bridge' >&2
  exit 1
fi

if nm -gU "$binary" | grep 'NativeHelperServer' >/dev/null; then
  echo 'unexpected helper server symbol' >&2
  exit 1
fi

codesign --verify --strict "$framework"
plutil -lint "$framework/Info.plist"
plutil -lint "$framework/Resources/Info.plist"
echo 'IRiXiNativeKit smoke checks passed'
