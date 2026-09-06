# Public source preflight — 2026-09-06

Target: the empty public repository `Irixil/siyv`, to be renamed to `Irixil/IRiXi-Toolbox` before the first push.

## Passed

- `IRiXiNativeKit` built successfully and passed its smoke checks.
- Translation direction, clipboard handoff, and speech prerequisites passed the translation basics checks.
- The Electron host passed all 137 automated tests, its Electron UI check, and JavaScript syntax checks.
- An unpacked macOS application was produced successfully; its in-process native framework, bundle identity, and ad-hoc signature passed verification.
- The packaged application contains no standalone screen-permission application. Screenshot, OCR, image translation, input translation, selection translation, and speech are loaded into the main application process.
- Production and development dependency audits reported zero known vulnerabilities at test time.
- The staged source contains no environment files, local DZ history, dependency directories, build output, private signing material, common secret patterns, or files over 50 MB.
- GPLv3, MIT attribution, upstream references, and third-party notices are included.
- The earlier shader and images whose redistribution rights were not sufficiently documented were removed and replaced with original, dependency-free fallbacks.

## Resolved during preflight

- The first clean-source native check exposed a packaging rule that had omitted `build-irixi-native-kit.sh`; the original source script was restored and the check then passed.
- Four local-service tests were initially blocked by the restricted test environment. They passed when rerun with access limited to the local loopback interface.
- The first translation basics run could not access the test clipboard. It passed when rerun with the required local permission.
- The first Electron UI run showed that the neutral visual fallback did not report its idle/hover lifecycle. A small dependency-free state controller was added; the full test suite then passed.

## Not yet verified

- A person has not completed every real-screen path in this clean source copy: full annotation, window capture, full-screen capture, OCR output, image translation output, input translation, and cross-application selection translation.
- GitHub-hosted CI has not run because this is the repository's first push.
- No public Developer ID-signed and Apple-notarized installer is included in this source release.
- The Swift compiler reports non-fatal deprecation, unused-value, and future Swift 6 concurrency warnings in inherited native code.

This is therefore a tested public **source preview**, not a claim that every end-user path or public binary release is fully verified.
