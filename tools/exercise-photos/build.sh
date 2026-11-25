#!/bin/sh
# Fetches free-exercise-db's photos at the commit the exercise library is pinned to
# (ExerciseCatalog.FreeExerciseDbCommit, checked by ExercisePhotoTests) and writes the
# small WebP copies the app serves:
#
#   <out>/<first 7 of the commit>/<exercise id>/<n>.webp
#
# The ids are the library's: the source folder name in lower case, with each run of
# other characters turned into one dash. Needs git and cwebp. The Docker build runs it;
# for photos in development, run it with backend/GymBro.Api/wwwroot/exercise-photos.
set -eu

commit=f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5
out=${1:?usage: build.sh <out dir>}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Fetching by commit hash: git checks every object against it, so nothing else can arrive.
git -C "$work" init -q
git -C "$work" fetch -q --depth 1 https://github.com/yuhonas/free-exercise-db.git "$commit"
git -C "$work" -c advice.detachedHead=false checkout -q "$commit"

dest="$out/$(printf '%.7s' "$commit")"
rm -rf "$dest"
mkdir -p "$dest"
count=0
for dir in "$work"/exercises/*/; do
  id=$(basename "$dir" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
  # Fails if two folders give the same id.
  mkdir "$dest/$id"
  for photo in "$dir"*.jpg; do
    # 600 px wide (the source is 850 × 567), about 14 KB each.
    cwebp -quiet -q 70 -m 6 -resize 600 0 -metadata none "$photo" -o "$dest/$id/$(basename "$photo" .jpg).webp"
    count=$((count + 1))
  done
done
echo "$count photos in $dest"
