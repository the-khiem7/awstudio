# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Compare two commits of the aws-emulator submodule for the 11 services with dedicated pages.

    uv run tools/vendor-drift/vendor_drift.py <old> <new> [--all]

<old> and <new> are tags or commits. An older commit missing from the shallow submodule is
fetched at depth 1. The scores of each side come from the `scores.json.gz` asset of its release
tag (downloaded with `gh`, cached under tools/vendor-drift/.cache); pass tags to skip the lookup
of a tag from a commit.
"""

import argparse
import gzip
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SUBMODULE = REPO / "vendor" / "aws-emulator"
CACHE = Path(__file__).resolve().parent / ".cache"
UPSTREAM = "aws/aws-emulator"
PACK_ENTRIES = REPO / "docs" / "baseline" / "awstudio" / "awstudio.hallucination.md"

SERVICES = {
    "S3": ["service-com-amazonaws-s3-amazons3"],
    "DynamoDB": ["service-com-amazonaws-dynamodb-dynamodb-20120810"],
    "SQS": ["service-com-amazonaws-sqs-amazonsqs"],
    "SNS": ["service-com-amazonaws-sns-amazonsimplenotificationservice"],
    "IAM": ["service-com-amazonaws-iam-awsidentitymanagementv20100508"],
    "Lambda": ["service-com-amazonaws-lambda-awsgirapiservice"],
    "Secrets Manager": ["service-com-amazonaws-secretsmanager-secretsmanager"],
    "SSM": ["service-com-amazonaws-ssm-amazonssm"],
    "KMS": ["service-com-amazonaws-kms-trentservice"],
    "CloudWatch Logs": ["service-com-amazonaws-cloudwatchlogs-logs-20140328"],
    "EventBridge": [
        "service-com-amazonaws-eventbridge-awsevents",
        "service-com-amazonaws-cloudwatchevents-awsevents",
    ],
}
ISSUES_OPEN = "issues/things-that-do-not-work"
ISSUES_FIXED = "issues/things-that-now-work"
NOT_IMPLEMENTED = re.compile(r'not_implemented\(\s*(?:&format!\(\s*)?"((?:[^"\\]|\\.)*)"', re.S)
LIMIT = 12


def git(*args, check=True):
    done = subprocess.run(["git", "-C", str(SUBMODULE), *args], capture_output=True, text=True, encoding="utf-8")
    if check and done.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done


def gh(*args):
    done = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
    if done.returncode != 0:
        sys.exit(f"gh {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout.strip()


def resolve(ref):
    """Return (full commit, tag or None), fetching the commit when the shallow clone lacks it."""
    known = git("rev-parse", "--verify", f"{ref}^{{commit}}", check=False)
    if known.returncode != 0:
        fetched = git("fetch", "--depth", "1", "origin", ref, check=False)
        if fetched.returncode != 0 and re.fullmatch(r"[0-9a-f]{7,40}", ref):
            ref = gh("api", f"repos/{UPSTREAM}/commits/{ref}", "--jq", ".sha")
            git("fetch", "--depth", "1", "origin", ref)
        git("rev-parse", "--verify", "FETCH_HEAD^{commit}")
        known = git("rev-parse", "--verify", "FETCH_HEAD^{commit}")
    commit = known.stdout.strip()
    tag = ref if re.match(r"v\d", ref) else None
    if tag is None:
        tag = git("tag", "--points-at", commit).stdout.split()[:1]
        tag = tag[0] if tag else None
    if tag is None:
        short = commit[:12]
        found = gh("api", f"repos/{UPSTREAM}/tags?per_page=100", "--paginate", "--jq", f'.[] | select(.commit.sha|startswith("{short}")) | .name')
        tag = found.split()[0] if found else None
    return commit, tag


def blobs(commit, paths):
    """Read many files of one commit through a single git process."""
    if not paths:
        return {}
    stdin = "".join(f"{commit}:{p}\n" for p in paths)
    done = subprocess.run(["git", "-C", str(SUBMODULE), "cat-file", "--batch"], input=stdin.encode(), capture_output=True)
    out, data, pos = {}, done.stdout, 0
    for path in paths:
        end = data.index(b"\n", pos)
        header = data[pos:end].decode().split()
        if header[-1] == "missing":
            pos = end + 1
            continue
        size = int(header[2])
        out[path] = data[end + 1:end + 1 + size].decode("utf-8", "replace")
        pos = end + 1 + size + 1
    return out


def ls(commit, path):
    done = git("ls-tree", "-r", "--name-only", commit, "--", path, check=False)
    return done.stdout.split()


def scores_for(tag):
    target = CACHE / tag / "scores.json.gz"
    if not target.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        gh("release", "download", tag, "-R", UPSTREAM, "-p", "scores.json.gz", "-D", str(target.parent), "--clobber")
    return json.loads(gzip.open(target).read())


def norm(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def model_ops(commit):
    """Operation names per service label from the Smithy models of one commit."""
    result = {}
    for label, folders in SERVICES.items():
        ops = set()
        files = [p for f in folders for p in ls(commit, f"services/{f}/smithy-model") if p.endswith(".json")]
        for text in blobs(commit, files).values():
            for shape_id, shape in json.loads(text).get("shapes", {}).items():
                if shape.get("type") == "operation":
                    ops.add(shape_id.split("#", 1)[1])
        result[label] = ops
    return result


def variants(commit):
    """Unsupported variants: (service label, operation file, message) from not_implemented calls."""
    found = set()
    for label, folders in SERVICES.items():
        files = [p for f in folders for p in ls(commit, f"services/{f}/src/ops") if p.endswith(".rs")]
        for path, text in blobs(commit, files).items():
            for message in NOT_IMPLEMENTED.findall(text):
                found.add((label, Path(path).stem, message))
    return found


def tiers(scores, ops):
    by_service = {norm(f): label for label, folders in SERVICES.items() for f in folders}
    stats = defaultdict(lambda: [0, 0])
    for unit in scores["units"]:
        labels = {by_service[norm("service-" + s.replace("#", "-").replace(".", "-"))]
                  for s in unit.get("services", [])
                  if norm("service-" + s.replace("#", "-").replace(".", "-")) in by_service}
        for step in unit.get("detail", {}).get("steps", []):
            if step.get("outcome") == "skipped":
                continue
            for label in labels:
                if step.get("operation") in ops[label]:
                    entry = stats[(label, step["operation"])]
                    entry[1] += 1
                    entry[0] += step["outcome"] == "pass"
    result = {}
    for key, (passed, total) in stats.items():
        ratio = passed / total
        result[key] = ("green" if ratio >= 0.8 else "yellow" if ratio > 0 else "red", f"{passed}/{total}")
    return result


def pack_entries(changed):
    """Entries with a vendor line whose text names a changed service or operation."""
    if not PACK_ENTRIES.exists():
        print(f"warning: pack file not found: {PACK_ENTRIES}", file=sys.stderr)
        return []
    entries = re.split(r"(?m)^#{2,3} (?=ASD-)", PACK_ENTRIES.read_text(encoding="utf-8"))[1:]
    hits = []
    for entry in entries:
        vendor = re.search(r"\*\*Vendor:\*\*\s*\S*@([0-9a-f]{12})", entry)
        if not vendor:
            continue
        ident = entry.split(":", 1)[0]
        named = sorted(term for term in changed if re.search(rf"\b{re.escape(term)}\b", entry, re.I))
        hits.append((ident, vendor.group(1), named))
    return hits


def clip(items, show_all):
    items = sorted(items)
    return items if show_all or len(items) <= LIMIT else items[:LIMIT] + [f"... {len(items) - LIMIT} more (use --all)"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("old")
    parser.add_argument("new")
    parser.add_argument("--all", action="store_true", help="list every item instead of the first few")
    args = parser.parse_args()

    old, old_tag = resolve(args.old)
    new, new_tag = resolve(args.new)
    if not old_tag or not new_tag:
        sys.exit("no release tag found for a commit; pass tags instead")
    print(f"vendor drift: {old_tag} ({old[:12]}) -> {new_tag} ({new[:12]})\n")

    old_ops, new_ops = model_ops(old), model_ops(new)
    all_ops = {label: old_ops[label] | new_ops[label] for label in SERVICES}
    old_tiers, new_tiers = tiers(scores_for(old_tag), all_ops), tiers(scores_for(new_tag), all_ops)
    old_var, new_var = variants(old), variants(new)

    tier_delta = defaultdict(list)
    for key in sorted(set(old_tiers) | set(new_tiers)):
        before, after = old_tiers.get(key), new_tiers.get(key)
        if (before or ("none", ""))[0] != (after or ("none", ""))[0]:
            label, op = key
            tier_delta[label].append(f"{op}: {(before or ('none', ''))[0]} {(before or ('', ''))[1]} -> {(after or ('none', ''))[0]} {(after or ('', ''))[1]}")
    variant_added = defaultdict(list)
    variant_removed = defaultdict(list)
    for label, op, message in new_var - old_var:
        variant_added[label].append(f"{op}: {message}")
    for label, op, message in old_var - new_var:
        variant_removed[label].append(f"{op}: {message}")

    model_files, source_files = {}, {}
    for label, folders in SERVICES.items():
        for counts, sub in ((model_files, "smithy-model"), (source_files, "src")):
            paths = [f"services/{f}/{sub}" for f in folders]
            counts[label] = len(git("diff", "--name-only", old, new, "--", *paths, check=False).stdout.split())

    print(f"{'service':<16}{'tiers':>7}{'var +':>7}{'var -':>7}{'ops +':>7}{'ops -':>7}{'model files':>13}{'src files':>11}")
    changed = set()
    for label in SERVICES:
        added, removed = new_ops[label] - old_ops[label], old_ops[label] - new_ops[label]
        row = (len(tier_delta[label]), len(variant_added[label]), len(variant_removed[label]), len(added), len(removed), model_files[label])
        print(f"{label:<16}{row[0]:>7}{row[1]:>7}{row[2]:>7}{row[3]:>7}{row[4]:>7}{row[5]:>13}{source_files[label]:>11}")
        if any(row):
            changed.add(label)
        changed |= {op for op in added | removed}
    print()

    for label in SERVICES:
        sections = [("tier changes", tier_delta[label]), ("unsupported variants added", variant_added[label]),
                    ("unsupported variants removed", variant_removed[label]),
                    ("operations added", sorted(new_ops[label] - old_ops[label])),
                    ("operations removed", sorted(old_ops[label] - new_ops[label]))]
        if not any(items for _, items in sections):
            continue
        print(f"[{label}]")
        for title, items in sections:
            if items:
                print(f"  {title}:")
                for item in clip(items, args.all):
                    print(f"    - {item}")
    print()

    issue_files = lambda commit, folder: {Path(p) for p in ls(commit, folder) if p.endswith(".md")}
    open_old, fixed_new, open_new = issue_files(old, ISSUES_OPEN), issue_files(new, ISSUES_FIXED), issue_files(new, ISSUES_OPEN)
    moved = sorted(p.name for p in open_old if (Path(ISSUES_FIXED) / p.name) in fixed_new)
    print(f"issues: {len(open_old)} open at old, {len(open_new)} open at new, {len(moved)} moved to now-work")
    for name in clip(moved, args.all):
        print(f"  - {name}")
    print()

    print("pack entries with a vendor line:")
    for ident, sha, named in pack_entries(changed):
        stale = "pin differs from new" if not new.startswith(sha) else "pin is new"
        mention = f"names changed: {', '.join(named)}" if named else "names no changed service"
        print(f"  - {ident} (judged at {sha}; {stale}; {mention})")


if __name__ == "__main__":
    main()
