#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive_dir="$project_root/dist"
archive_path="$archive_dir/Picklester-production-source.zip"
next_archive="$archive_dir/Picklester-production-source.next.zip"

mkdir -p "$archive_dir"
cd "$project_root"
rm -f "$next_archive"
git ls-files | zip -q "$next_archive" -@
mv "$next_archive" "$archive_path"
echo "$archive_path"
