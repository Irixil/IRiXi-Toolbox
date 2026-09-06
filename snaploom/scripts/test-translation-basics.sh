#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
check_dir="$(mktemp -d "${TMPDIR:-/tmp}/irixi-translation-checks.XXXXXX")"
trap 'rm -rf "$check_dir"' EXIT

xcrun swiftc \
  -parse-as-library \
  "$project_dir/SnaploomApp/Translation/AbbreviationGlossary.swift" \
  "$project_dir/SnaploomApp/Translation/SpeechPlaybackController.swift" \
  "$project_dir/SnaploomApp/Translation/TranslationDirectionResolver.swift" \
  "$project_dir/SnaploomApp/Translation/TranslationSelectionService.swift" \
  "$project_dir/SnaploomApp/Translation/TranslationShortcutManager.swift" \
  "$script_dir/TranslationBasicsChecks.swift" \
  -o "$check_dir/translation-basics-checks"

"$check_dir/translation-basics-checks"
