#!/usr/bin/env python3
"""Write paste-size test strings for the probe's /ip paste command.

Usage: tools/make-paste-tests.py [output-dir]      (default: paste-tests/)

Each file is ONE line, no trailing newline: IPASTE:<n>:<n characters>:END
The characters repeat a fixed 64-character pattern; the probe regenerates it and reports the first damaged position.
Pattern rule (must match IntrepidProbe/IntrepidProbe.lua): for position p (1-based) let i = ((p-1) % 64) + 1,
character = ALPHABET[(i*7 + 3) % 64].
"""
import os
import sys

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
SIZES = [1000, 5000, 20000, 50000, 100000, 250000, 500000, 1000000]
BLOCK = "".join(ALPHABET[(i * 7 + 3) % 64] for i in range(1, 65))


def make(n):
    payload = (BLOCK * (n // 64 + 1))[:n]
    return "IPASTE:%d:%s:END" % (n, payload)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "paste-tests"
    os.makedirs(out, exist_ok=True)
    for n in SIZES:
        with open(os.path.join(out, "paste-%d.txt" % n), "w", newline="") as f:
            f.write(make(n))
    print("Wrote %d files to %s" % (len(SIZES), out))


if __name__ == "__main__":
    main()
