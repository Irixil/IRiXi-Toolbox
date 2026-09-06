#!/bin/bash
set -euo pipefail

helper_binary="${1:?usage: test-native-helper-protocol.sh /path/to/debug/helper-binary}"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

printf '%s\n' \
  '{"v":1,"id":"11111111-1111-1111-1111-111111111111","action":"health","args":{}}' \
  '{"v":1,"id":"11111111-1111-1111-1111-111111111111","action":"health","args":{}}' \
  '{"v":1,"id":"22222222-2222-2222-2222-222222222222","action":"shell.run","args":{}}' \
  '{"v":1,"id":"33333333-3333-3333-3333-333333333333","action":"health","args":{"path":"/tmp/not-allowed"}}' \
  '{"v":1,"id":"55555555-5555-4555-8555-555555555555","action":"translation.selection","args":{"partner":"en","path":"/tmp/not-allowed"}}' \
  '{"v":1,"id":"66666666-6666-4666-8666-666666666666","action":"capture.area","args":{"path":"/tmp/not-allowed"}}' \
  '{"v":1,"id":"77777777-7777-4777-8777-777777777777","action":"capture.translate","args":{"target":"not-a-language"}}' \
  | env IRIXI_HELPER_ALLOW_TEST_PARENT=1 "$helper_binary" > "$test_dir/protocol.jsonl"

test "$(wc -l < "$test_dir/protocol.jsonl" | tr -d ' ')" = "7"
grep -q '"status":"completed"' "$test_dir/protocol.jsonl"
grep -q '"code":"duplicate"' "$test_dir/protocol.jsonl"
grep -q '"code":"invalid_action"' "$test_dir/protocol.jsonl"
test "$(grep -c '"code":"invalid_args"' "$test_dir/protocol.jsonl")" = "4"

perl -e 'print "x" x 65537, "\n"' \
  | env IRIXI_HELPER_ALLOW_TEST_PARENT=1 "$helper_binary" > "$test_dir/oversized.jsonl"
grep -q '"code":"protocol_error"' "$test_dir/oversized.jsonl"

(
  printf '%s\n' \
    '{"v":1,"id":"44444444-4444-4444-4444-444444444444","action":"translation.input.open","args":{"partner":"en"}}'
  sleep 1
) | env IRIXI_HELPER_ALLOW_TEST_PARENT=1 "$helper_binary" > "$test_dir/translation.jsonl"

test "$(wc -l < "$test_dir/translation.jsonl" | tr -d ' ')" = "2"
grep -q '"status":"started"' "$test_dir/translation.jsonl"
grep -q '"status":"completed"' "$test_dir/translation.jsonl"

echo "native helper protocol checks passed"
