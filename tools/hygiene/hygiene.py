# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Refuse a commit whose staged text would publish host, employer or key information.

Checks every staged text blob for:
  - the local machine name (read from the environment at run time, never stored in the repository)
  - extra denied terms, one per line, from `hygiene-deny.txt` inside the git directory (untracked)
  - 12-digit AWS account IDs other than 000000000000
  - private key blocks

A finding prints the file, line and category only, never the matched text.
"""

import os
import re
import socket
import subprocess
import sys
from pathlib import Path

ACCOUNT_ID = re.compile(r"(?<![\w.-])\d{12}(?![\w.-])")
PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY")
PLACEHOLDER_ACCOUNT = "000000000000"
GITLINK_MODE = "160000"


def git(*args, raw=False):
    done = subprocess.run(["git", *args], capture_output=True, check=True)
    return done.stdout if raw else done.stdout.decode("utf-8", "replace")


def denied_terms():
    names = {os.environ.get("COMPUTERNAME", ""), socket.gethostname()}
    terms = {("machine name", n.lower()) for n in names if len(n) >= 3}
    extra = Path(git("rev-parse", "--git-path", "hygiene-deny.txt").strip())
    if extra.exists():
        for line in extra.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                terms.add(("denied term", line.lower()))
    return terms


def staged_files():
    """Paths of added, copied, modified or renamed entries that are not submodule pointers."""
    out = git("diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=ACMR", raw=True).decode("utf-8", "replace")
    fields = out.split("\0")
    paths = []
    for meta, path in zip(fields[0::2], fields[1::2]):
        if meta and meta.split()[1] != GITLINK_MODE:
            paths.append(path)
    return paths


def scan(path, terms):
    data = git("show", f":{path}", raw=True)
    if b"\0" in data[:8000]:
        return []
    findings = []
    for number, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
        lowered = line.lower()
        for category, term in terms:
            if term in lowered:
                findings.append((number, category))
        for found in ACCOUNT_ID.findall(line):
            if found != PLACEHOLDER_ACCOUNT:
                findings.append((number, "account id"))
        if PRIVATE_KEY.search(line):
            findings.append((number, "private key block"))
    return findings


def main():
    terms = denied_terms()
    blocked = 0
    for path in staged_files():
        for number, category in scan(path, terms):
            print(f"hygiene: {path}:{number}: {category}")
            blocked += 1
    if blocked:
        print(f"hygiene: {blocked} finding(s); commit refused")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
