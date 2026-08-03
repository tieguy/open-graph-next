#!/usr/bin/env bash
# Merge wikidata-llm-experiment into open-graph-next as wikidata-SIFT/
# Run from the open-graph-next directory when wikidata-llm-experiment
# is at a good stopping point.

set -euo pipefail

cd "$(dirname "$0")/.."

git remote add wikidata ../wikidata-llm-experiment
git fetch wikidata
git merge -s ours --no-commit --allow-unrelated-histories wikidata/main
git read-tree --prefix=wikidata-SIFT/ -u wikidata/main
git commit -m "Import wikidata-llm-experiment as wikidata-SIFT with full history"
git remote remove wikidata

echo "Done. wikidata-llm-experiment merged into wikidata-SIFT/"
