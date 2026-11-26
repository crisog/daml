#!/usr/bin/env bash
# Copies the Daml inputs of this project from a Splice source tree: six files
# of Splice's Daml Script test code for the token standard, and the eight
# released DAR files that they need. Splice's daml.yaml for that test code says
# that a developer must copy it as source.
# Usage: prepare.sh <splice-source-dir>    a checkout of release-line-0.10.3
set -euo pipefail

splice=${1:?splice source directory}
here=$(cd "$(dirname "$0")" && pwd)
readonly TEST_CODE=token-standard/splice-token-standard-v1-test/daml/Splice
readonly FILES=(
  Testing/Utils.daml
  Testing/Registries/AmuletRegistry.daml
  Testing/Registries/AmuletRegistry/Parameters.daml
  Testing/TokenStandard/RegistryApi.daml
  Testing/TokenStandard/WalletClient.daml
  Tests/TestAmuletTokenTransfer.daml
)

for file in "${FILES[@]}"; do
  mkdir -p "$here/daml/Splice/$(dirname "$file")"
  cp "$splice/$TEST_CODE/$file" "$here/daml/Splice/$file"
done
mkdir -p "$here/dars"
grep --only-matching 'dars/.*\.dar' "$here/daml.yaml" | while read -r dar; do
  cp "$splice/daml/$dar" "$here/$dar"
done
echo "copied ${#FILES[@]} Daml files and $(find "$here/dars" -name '*.dar' | wc -l | tr -d ' ') DAR files"
