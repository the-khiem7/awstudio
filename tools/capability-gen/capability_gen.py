# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build the capability matrix of the pinned aws-emulator submodule.

    uv run tools/capability-gen/capability_gen.py [--out PATH] [--scores PATH] [--summary]

Reads, from the commit the submodule is checked out at:
- the Smithy model of every service (operations, SDK id, endpoint prefix, title);
- the `//! @op <Name>` header of every `src/ops/*.rs` file (which operations are wired);
- the `//! SCAFFOLDED, NOT IMPLEMENTED:` marker (operations that always answer HTTP 501);
- every `not_implemented("...")` message (unsupported variants of a working operation);
- the `scores.json.gz` asset of the release tag (downloaded with `gh`, cached under
  tools/capability-gen/.cache).

Tier rules: an unwired or scaffolded operation is red (HTTP 501). A scored operation is green at a
pass rate of at least 80%, yellow above 0%, red at 0%. An operation with no score is green unless it
has a named unsupported variant, then yellow. A message that names only the operation is the
handler's guard for missing service state, not a feature gap, and is not a variant.

The output is committed so a build does not need the submodule.
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
OUT = REPO / "src" / "capability" / "capability.json"
UPSTREAM = "aws/aws-emulator"
GREEN_AT = 0.8

SCAFFOLDED = "//! SCAFFOLDED, NOT IMPLEMENTED:"
OP_HEADER = re.compile(r"^//! @op (\w+)\s*$")
MESSAGE = re.compile(r'not_implemented\(\s*(?:&format!\(\s*)?"((?:[^"\\]|\\.)*)"', re.S)
PLACEHOLDER = re.compile(r"=?\{[^}]*\}")
GREP_LINE = re.compile(r"^[0-9a-f]{40}:(services/([^/]+)/src/ops/[^:]+\.rs)([:-])(\d+)[:-](.*)$")


def git(*args, stdin=None):
    done = subprocess.run(["git", "-C", str(SUBMODULE), *args], input=stdin, capture_output=True)
    if done.returncode not in (0, 1):
        sys.exit(f"git {' '.join(args)} failed: {done.stderr.decode(errors='replace').strip()}")
    return done.stdout


def pinned():
    commit = git("rev-parse", "HEAD").decode().strip()
    tags = git("tag", "--points-at", commit).decode().split()
    if not tags:
        sys.exit(f"submodule commit {commit[:12]} has no release tag; pin a tagged commit")
    return commit, tags[0]


def blobs(commit, paths):
    """Read many files of one commit through a single git process."""
    data = git("cat-file", "--batch", stdin="".join(f"{commit}:{p}\n" for p in paths).encode())
    out, pos = {}, 0
    for path in paths:
        end = data.index(b"\n", pos)
        header = data[pos:end].decode().split()
        if header[-1] == "missing":
            pos = end + 1
            continue
        size = int(header[2])
        out[path] = data[end + 1:end + 1 + size]
        pos = end + 1 + size + 1
    return out


def scores_for(tag, explicit):
    target = Path(explicit) if explicit else CACHE / tag / "scores.json.gz"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        done = subprocess.run(["gh", "release", "download", tag, "-R", UPSTREAM, "-p", "scores.json.gz",
                               "-D", str(target.parent), "--clobber"], capture_output=True, text=True)
        if done.returncode != 0:
            sys.exit(f"gh release download {tag} failed: {done.stderr.strip()}")
    return json.loads(gzip.open(target).read())


def services(commit):
    """Per service folder: shape id, metadata and operation names from its Smithy model."""
    paths = [p for p in git("ls-tree", "-r", "--name-only", commit, "--", "services").decode().split()
             if "/smithy-model/" in p and p.endswith(".json")]
    found = {}
    for path, raw in blobs(commit, paths).items():
        shapes = json.loads(raw).get("shapes", {})
        folder = path.split("/")[1]
        ops = sorted(sid.split("#", 1)[1] for sid, s in shapes.items() if s.get("type") == "operation")
        for sid, shape in shapes.items():
            if shape.get("type") != "service":
                continue
            traits = shape.get("traits", {})
            meta = traits.get("aws.api#service", {})
            found[folder] = {
                "shape": sid,
                "sdkId": meta.get("sdkId") or sid.split("#", 1)[1],
                "prefix": meta.get("endpointPrefix") or meta.get("arnNamespace") or sid.split("#", 1)[0].split(".")[-1],
                "title": traits.get("smithy.api#title") or meta.get("sdkId") or sid,
                "ops": ops,
            }
    return found


def source_facts(commit):
    """Wired, scaffolded and variant facts per service folder, from one git grep of the ops files."""
    raw = git("grep", "-n", "-A3", "-E", r"^//! @op |^//! SCAFFOLDED, NOT IMPLEMENTED:|not_implemented\(",
              commit, "--", "services/*/src/ops/*.rs").decode("utf-8", "replace")
    files = defaultdict(lambda: {"ops": [], "scaffolded": False, "text": []})
    for line in raw.splitlines():
        match = GREP_LINE.match(line)
        if not match:
            continue
        path, folder, kind, _, text = match.groups()
        entry = files[(folder, path)]
        if kind == ":":
            header = OP_HEADER.match(text)
            if header:
                entry["ops"].append(header.group(1))
            if text.startswith(SCAFFOLDED):
                entry["scaffolded"] = True
        entry["text"].append(text)
    wired, scaffolded, variants = defaultdict(set), defaultdict(set), defaultdict(lambda: defaultdict(set))
    for (folder, _), entry in files.items():
        wired[folder].update(entry["ops"])
        if entry["scaffolded"]:
            scaffolded[folder].update(entry["ops"])
            continue
        for message in MESSAGE.findall("\n".join(entry["text"])):
            variants[folder][message].update(entry["ops"])
    return wired, scaffolded, variants


def variant_of(op, message):
    """`UpdateFunctionCode with PublishTo={x}` -> `PublishTo`; a bare operation name -> None."""
    rest = message.strip()
    rest = rest[len(op):].strip() if rest.startswith(op) else rest
    rest = rest[len("with "):] if rest.startswith("with ") else rest
    rest = PLACEHOLDER.sub(lambda m: "" if m.group(0).startswith("=") else m.group(0), rest).strip()
    return rest or None


def attribute(folder_ops, header_ops, message):
    """Operation a message belongs to: the one it starts with, else the file's own @op."""
    words = message.split()
    if words and words[0] in folder_ops:
        return words[0]
    return next(iter(sorted(header_ops)), None)


def score_stats(scores, by_shape):
    stats = defaultdict(lambda: [0, 0])
    for unit in scores["units"]:
        keys = [by_shape[s] for s in unit.get("services", []) if s in by_shape]
        for step in unit.get("detail", {}).get("steps", []):
            if step.get("outcome") == "skipped":
                continue
            for folder, ops in keys:
                if step.get("operation") in ops:
                    entry = stats[(folder, step["operation"])]
                    entry[1] += 1
                    entry[0] += step["outcome"] == "pass"
    return stats


def tier(ratio):
    return "green" if ratio >= GREEN_AT else "yellow" if ratio > 0 else "red"


def slug(sdk_id):
    """Service key from the SDK id, which is unique per service: `CloudWatch Logs` -> `cloudwatch-logs`."""
    return re.sub(r"[^a-z0-9]+", "-", sdk_id.lower()).strip("-")


def build(commit, tag, scores):
    models = services(commit)
    wired, scaffolded, variants = source_facts(commit)
    stats = score_stats(scores, {m["shape"]: (folder, set(m["ops"])) for folder, m in models.items()})

    by_key = defaultdict(list)
    for folder, model in models.items():
        by_key[slug(model["sdkId"])].append(folder)
    for key, folders in by_key.items():
        if len(folders) > 1:
            print(f"warning: SDK id {key} has {len(folders)} models, merged: {', '.join(sorted(folders))}", file=sys.stderr)

    result = {}
    for key, folders in sorted(by_key.items()):
        folders.sort()
        first = models[folders[0]]
        # Should two models ever share one SDK id: scores add up, variants unite, and an operation
        # is 501 only when no model serves it.
        facts = defaultdict(lambda: {"passed": 0, "total": 0, "names": set(), "served": False, "reason": "unwired"})
        for folder in folders:
            model = models[folder]
            for message, header_ops in variants[folder].items():
                op = attribute(set(model["ops"]), header_ops, message)
                name = variant_of(op, message) if op else None
                if op and name:
                    facts[op]["names"].add(name)
            for op in model["ops"]:
                fact = facts[op]
                passed, total = stats.get((folder, op), (0, 0))
                fact["passed"] += passed
                fact["total"] += total
                if op in wired[folder] and op not in scaffolded[folder]:
                    fact["served"] = True
                elif op in wired[folder] and fact["reason"] == "unwired":
                    fact["reason"] = "scaffolded"
        ops = {}
        for op, fact in facts.items():
            entry = {}
            if not fact["served"]:
                entry["tier"] = "red"
                entry["reason"] = fact["reason"]
            elif fact["total"]:
                entry["tier"] = tier(fact["passed"] / fact["total"])
            else:
                entry["tier"] = "yellow" if fact["names"] else "green"
            if fact["total"]:
                entry["pass"] = f"{fact['passed']}/{fact['total']}"
            if fact["names"]:
                entry["unsupported"] = sorted(fact["names"])
            ops[op] = entry
        result[key] = {
            "name": first["title"],
            "sdkId": first["sdkId"],
            "prefix": first["prefix"],
            "models": folders,
            "ops": dict(sorted(ops.items())),
        }
    return {
        "vendor": {"repo": UPSTREAM, "commit": commit[:12], "tag": tag, "scoredAt": scores.get("scoredAt", "")},
        "thresholds": {"green": f">= {int(GREEN_AT * 100)}%", "yellow": "> 0%", "red": "0% or HTTP 501"},
        "services": result,
    }


def write(matrix, out):
    """One operation per line, so a pin bump diffs line by line."""
    lines = ["{", f' "vendor": {json.dumps(matrix["vendor"])},', f' "thresholds": {json.dumps(matrix["thresholds"])},', ' "services": {']
    keys = list(matrix["services"])
    for i, key in enumerate(keys):
        svc = matrix["services"][key]
        lines.append(f"  {json.dumps(key)}: {{")
        lines.append(f'   "name": {json.dumps(svc["name"])}, "sdkId": {json.dumps(svc["sdkId"])}, "prefix": {json.dumps(svc["prefix"])}, "models": {json.dumps(svc["models"])},')
        lines.append('   "ops": {')
        ops = list(svc["ops"].items())
        for j, (op, entry) in enumerate(ops):
            lines.append(f"    {json.dumps(op)}: {json.dumps(entry)}{',' if j < len(ops) - 1 else ''}")
        lines.append("   }")
        lines.append("  }" + ("," if i < len(keys) - 1 else ""))
    lines += [" }", "}", ""]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def summary(matrix, keys):
    print(f"{'service':<16}{'ops':>5}{'green':>7}{'yellow':>8}{'red':>6}{'scored':>8}{'variants':>10}")
    for key in keys:
        svc = matrix["services"].get(key)
        if not svc:
            print(f"{key:<16} missing")
            continue
        ops = svc["ops"].values()
        count = lambda t: sum(1 for e in ops if e["tier"] == t)
        print(f"{key:<16}{len(svc['ops']):>5}{count('green'):>7}{count('yellow'):>8}{count('red'):>6}"
              f"{sum(1 for e in ops if 'pass' in e):>8}{sum(len(e.get('unsupported', [])) for e in ops):>10}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--scores", help="path to a scores.json.gz instead of the release asset")
    parser.add_argument("--summary", action="store_true", help="print tier counts of the 11 console services")
    args = parser.parse_args()

    commit, tag = pinned()
    scores = scores_for(tag, args.scores)
    if scores.get("commit") and scores["commit"] != commit:
        sys.exit(f"scores were made from {scores['commit'][:12]}, the submodule is at {commit[:12]}")
    matrix = build(commit, tag, scores)
    write(matrix, Path(args.out))
    total = sum(len(s["ops"]) for s in matrix["services"].values())
    print(f"capability: {tag} ({commit[:12]}), {len(matrix['services'])} services, {total} operations -> {args.out}")
    if args.summary:
        summary(matrix, ["s3", "dynamodb", "sqs", "sns", "lambda", "iam", "secrets-manager", "ssm", "kms",
                         "cloudwatch-logs", "eventbridge", "cloudwatch-events"])


if __name__ == "__main__":
    main()
