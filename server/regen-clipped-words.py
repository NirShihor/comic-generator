#!/usr/bin/env python3
"""
Surgically find (and optionally delete) clipped short-word audio files.

Background: ElevenLabs clips the trailing consonant of ultra-short words
("en", "por", "al"...) when synthesised bare. The generator now appends a
period before TTS (audio.js) so the ending is articulated — but existing files
were made with the old code. This tool finds the *actually clipped* ones so you
can regenerate just those, not all ~7000 word files.

Workflow:
  1. python3 regen-clipped-words.py            # dry-run report, changes nothing
  2. python3 regen-clipped-words.py --delete    # delete the clipped files
  3. In the generator UI, for each listed comic, click "Generate Word Audio"
     (pick the comic's usual voice). forceRegenerate=false refills ONLY the
     deleted gaps, with the period fix. Then Export + sync those comics.

Criteria for "clipped": filename <= 3 chars, ends in a consonant, and the file
is suspiciously small (a full short word with the period fix is ~1.0-1.7s /
17-28 KB; clipped ones are well under that). Tune --max-bytes if needed.
"""
import argparse, glob, os, subprocess, sys

VOWELS = set("aeiouáéíóúüy")   # treat 'y' as vowel-ish: Spanish "y" = "ee", fine short

def is_clip_prone(name: str) -> bool:
    n = name.lower().strip(".,!?¡¿-")
    return bool(n) and len(n) <= 3 and n[-1] not in VOWELS

def duration(path: str):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=15).stdout.strip()
        return float(out) if out else None
    except Exception:
        return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects", default="projects", help="projects dir (default: ./projects)")
    ap.add_argument("--max-bytes", type=int, default=9000,
                    help="flag files smaller than this many bytes (default 9000 ~0.5s)")
    ap.add_argument("--delete", action="store_true", help="actually delete the flagged files")
    args = ap.parse_args()

    files = glob.glob(os.path.join(args.projects, "comic-*", "audio", "words", "*.mp3"))
    if not files:
        print(f"No word files under {args.projects}/comic-*/audio/words/", file=sys.stderr)
        sys.exit(1)

    flagged = {}  # comicId -> list of (word, bytes, dur)
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        if not is_clip_prone(name):
            continue
        size = os.path.getsize(f)
        if size >= args.max_bytes:
            continue
        comic_id = f.split(os.sep)[-4]  # projects/<comicId>/audio/words/<w>.mp3
        flagged.setdefault(comic_id, []).append((name, size, duration(f), f))

    total = sum(len(v) for v in flagged.values())
    print(f"Scanned {len(files)} word files. Flagged {total} clipped short words "
          f"across {len(flagged)} comic(s).\n")
    for comic_id in sorted(flagged):
        words = sorted(flagged[comic_id])
        print(f"  {comic_id}  ({len(words)} words)")
        for name, size, dur, _ in words:
            d = f"{dur:.2f}s" if dur is not None else "?"
            print(f"      {name:<6} {size:>6} bytes  {d}")
        print()

    if args.delete:
        for comic_id in sorted(flagged):
            for _, _, _, path in flagged[comic_id]:
                os.remove(path)
        print(f"DELETED {total} files.\n")
        print("Next: in the generator UI, click 'Generate Word Audio' for each comic")
        print("above (pick its usual voice) to refill the gaps, then Export + sync:")
        print("  " + "  ".join(sorted(flagged)))
    else:
        print("Dry run — nothing deleted. Re-run with --delete when ready.")

if __name__ == "__main__":
    main()
