# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build the trimmed API model bundle and the open-issue index of the pinned aws-emulator submodule.

    uv run tools/apimodel-gen/apimodel_gen.py [--out DIR] [--cli-dir DIR] [--summary]

Reads, from the commit the submodule is checked out at:
- the Smithy model of every service: the input shape of every operation and the shapes it reaches,
  with documentation, traits other than required, enum values and streaming output dropped;
- `issues/things-that-do-not-work/*.md`: severity, title and the services each issue names.

Reads, from the installed AWS CLI v2 (`--cli-dir`, default: next to `aws` on PATH):
- `awscli/data/ac.index`, the CLI's own command table, so every service and operation name written
  to the bundle is one the installed CLI accepts (`logs`, `s3api`, `describe-log-groups`);
- `awscli/botocore/data/*/*/service-2.json`, only for the `serviceId` that ties a CLI service to a
  Smithy SDK id.

Writes `src/apimodel/<service key>.json` (one file per service, loaded on demand by the API
Console) and `src/capability/issues.json`. The service key is the SDK id slug, as in
`src/capability/capability.json` (ASD-D26). An operation the installed CLI does not know is written
without a `cli` name, and the console disables it with that reason.

The output is committed so a build needs neither the submodule nor the CLI.
"""

import argparse
import json
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "capability-gen"))
from capability_gen import REPO, UPSTREAM, blobs, git, pinned, slug  # noqa: E402

OUT = REPO / "src" / "apimodel"
ISSUES_OUT = REPO / "src" / "capability" / "issues.json"
ISSUES_DIR = "issues/things-that-do-not-work"
MAX_ISSUES_PER_SERVICE = 100

PRIMITIVE = {
    "string": "@str", "integer": "@int", "long": "@int", "short": "@int", "byte": "@int",
    "bigInteger": "@int", "float": "@num", "double": "@num", "bigDecimal": "@num",
    "boolean": "@bool", "timestamp": "@ts", "blob": "@blob", "document": "@doc",
}
PRELUDE = {
    "String": "@str", "Integer": "@int", "PrimitiveInteger": "@int", "Long": "@int", "PrimitiveLong": "@int",
    "Short": "@int", "PrimitiveShort": "@int", "Byte": "@int", "PrimitiveByte": "@int", "BigInteger": "@int",
    "Float": "@num", "PrimitiveFloat": "@num", "Double": "@num", "PrimitiveDouble": "@num", "BigDecimal": "@num",
    "Boolean": "@bool", "PrimitiveBoolean": "@bool", "Timestamp": "@ts", "Blob": "@blob", "Document": "@doc",
}

# botocore's name transform, which the CLI applies to an operation name.
FIRST_CAP = re.compile("(.)([A-Z][a-z]+)")
END_CAP = re.compile("([a-z0-9])([A-Z])")
SPECIAL_CASE = re.compile("[A-Z]{2,}s$")


def xform(name, sep="-"):
    if sep in name:
        return name
    match = SPECIAL_CASE.search(name)
    if match:
        name = name[: -len(match.group())] + sep + match.group().lower()
    return END_CAP.sub(r"\1" + sep + r"\2", FIRST_CAP.sub(r"\1" + sep + r"\2", name)).lower()


def find_cli(explicit):
    if explicit:
        return Path(explicit)
    exe = shutil.which("aws")
    if not exe:
        sys.exit("aws not found on PATH; pass --cli-dir <AWSCLIV2 install folder>")
    return Path(exe).resolve().parent


def cli_tables(cli_dir):
    """CLI service name -> set of operation names, and serviceId slug -> CLI service name."""
    index = sqlite3.connect(str(cli_dir / "awscli" / "data" / "ac.index"))
    commands = defaultdict(set)
    for command, parent in index.execute("select command, parent from command_table"):
        if parent.startswith("aws."):
            commands[parent[4:]].add(command)
    services = {c for (c,) in index.execute("select command from command_table where parent = 'aws'")}
    by_id = {}
    for folder in sorted((cli_dir / "awscli" / "botocore" / "data").iterdir()):
        versions = sorted(p for p in folder.iterdir() if p.is_dir()) if folder.is_dir() else []
        model = versions[-1] / "service-2.json" if versions else None
        if not model or not model.exists():
            continue
        meta = json.loads(model.read_text(encoding="utf-8")).get("metadata", {})
        name = {"s3": "s3api", "codedeploy": "deploy", "config": "configservice"}.get(folder.name, folder.name)
        if name in services:
            by_id.setdefault(slug(meta.get("serviceId", folder.name)), name)
    return commands, by_id


def load_models(commit):
    """Folder -> parsed Smithy model, for every service model of the commit."""
    paths = [p for p in git("ls-tree", "-r", "--name-only", commit, "--", "services").decode().split()
             if "/smithy-model/" in p and p.endswith(".json")]
    models = {}
    for path, raw in blobs(commit, paths).items():
        # A folder may hold several model files (a service file and shared shapes): merge them.
        models.setdefault(path.split("/")[1], {"shapes": {}})["shapes"].update(json.loads(raw).get("shapes", {}))
    return models


def service_shape(model):
    # A model may hold two service shapes; capability_gen keeps the last, so this does too and the
    # two outputs name the same service keys.
    found = (None, None)
    for sid, shape in model["shapes"].items():
        if shape.get("type") == "service":
            traits = shape.get("traits", {})
            meta = traits.get("aws.api#service", {})
            found = sid, {
                "sdkId": meta.get("sdkId") or sid.split("#", 1)[1],
                "prefix": meta.get("endpointPrefix") or meta.get("arnNamespace") or "",
                "title": traits.get("smithy.api#title") or meta.get("sdkId") or sid,
            }
    return found


class Trimmer:
    """Collects, for one service, the shapes reachable from operation inputs, in compact form."""

    def __init__(self, shapes):
        self.shapes = shapes
        self.out = {}
        self.names = {}

    def ref(self, target):
        """`@str`-style code for a primitive, else the key of a collected shape."""
        short = target.split("#", 1)[1] if "#" in target else target
        if target.startswith("smithy.api#"):
            return PRELUDE.get(short, "@doc")
        shape = self.shapes.get(target)
        if shape is None:
            return "@doc"
        kind = shape["type"]
        if kind in PRIMITIVE and not self.enum_values(shape):
            return PRIMITIVE[kind]
        if target in self.names:
            return self.names[target]
        key = short
        if key in self.out:
            key = f"{key}~{len(self.out)}"
        self.names[target] = key
        self.out[key] = None  # placeholder: recursive shapes reach themselves before they finish
        self.out[key] = self.build(shape)
        return key

    @staticmethod
    def enum_values(shape):
        if shape["type"] in ("enum", "intEnum"):
            values = []
            for name, member in shape.get("members", {}).items():
                values.append(member.get("traits", {}).get("smithy.api#enumValue", name))
            return values
        legacy = shape.get("traits", {}).get("smithy.api#enum")
        return [item["value"] for item in legacy if "value" in item] if legacy else []

    def build(self, shape):
        kind = shape["type"]
        if kind in ("structure", "union"):
            members = {}
            for name, member in shape.get("members", {}).items():
                required = "smithy.api#required" in member.get("traits", {})
                members[name] = [self.ref(member["target"]), 1] if required else [self.ref(member["target"])]
            return {"t": "s" if kind == "structure" else "u", "m": members}
        if kind in ("list", "set"):
            return {"t": "l", "i": self.ref(shape["member"]["target"])}
        if kind == "map":
            return {"t": "m", "k": self.ref(shape["key"]["target"]), "v": self.ref(shape["value"]["target"])}
        values = self.enum_values(shape)
        return {"t": "e", "v": values, "n": kind == "intEnum"}

    def streaming_output(self, op):
        """True when the operation answers with a streaming blob, which the CLI writes to a file."""
        target = op.get("output", {}).get("target", "smithy.api#Unit")
        shape = self.shapes.get(target)
        if not shape:
            return False
        for member in shape.get("members", {}).values():
            if "smithy.api#streaming" in member.get("traits", {}):
                return True
            target_shape = self.shapes.get(member["target"], {})
            if "smithy.api#streaming" in target_shape.get("traits", {}):
                return True
        return False


def build_bundle(models, commands, by_id):
    """Service key -> bundle dict."""
    grouped = defaultdict(list)
    for folder, model in models.items():
        sid, meta = service_shape(model)
        if meta:
            grouped[slug(meta["sdkId"])].append((folder, sid, meta, model))
    bundles = {}
    for key, entries in sorted(grouped.items()):
        entries.sort()
        meta = entries[0][2]
        cli = by_id.get(key)
        known = commands.get(cli, set()) if cli else set()
        ops, shapes = {}, {}
        for _, _, _, model in entries:
            trimmer = Trimmer(model["shapes"])
            for sid, shape in model["shapes"].items():
                if shape.get("type") != "operation":
                    continue
                name = sid.split("#", 1)[1]
                target = shape.get("input", {}).get("target", "smithy.api#Unit")
                entry = {}
                command = xform(name)
                if cli and command in known:
                    entry["c"] = command
                if target != "smithy.api#Unit":
                    entry["i"] = trimmer.ref(target)
                if trimmer.streaming_output(shape):
                    entry["st"] = 1
                ops[name] = entry
            for short, shape in trimmer.out.items():
                if short in shapes and shapes[short] != shape:
                    sys.exit(f"{key}: shape {short} differs between two models of one SDK id")
                shapes[short] = shape
        bundles[key] = {"n": meta["title"], **({"cli": cli} if cli else {}), "ops": dict(sorted(ops.items())), "shapes": shapes}
    return bundles


def write_bundle(bundles, out):
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.json"):
        stale.unlink()
    for key, bundle in bundles.items():
        (out / f"{key}.json").write_text(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False), encoding="utf-8", newline="\n")


HEADER = re.compile(r"^([A-Za-z-]+): (.*)$")
TIMESTAMP = re.compile(r"^\d{8}T\d{6}Z-")
SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def build_issues(commit, tag, models):
    """Open issues grouped by the services they name: shape id, issue key services, file name prefix."""
    names = git("ls-tree", "--name-only", commit, f"{ISSUES_DIR}/").decode().split()
    paths = [p for p in names if p.endswith(".md")]
    shape_to_key, tokens = {}, defaultdict(set)
    for _, model in models.items():
        sid, meta = service_shape(model)
        if not meta:
            continue
        key = slug(meta["sdkId"])
        shape_to_key[sid] = key
        for token in {meta["prefix"].lower(), key, key.replace("-", ""), re.sub(r"[^a-z0-9]", "", meta["sdkId"].lower())}:
            if token:
                tokens[token].add(key)
    # A token that two services share (`lambda` for four of them) names none of them.
    unique = {token: next(iter(keys)) for token, keys in tokens.items() if len(keys) == 1}
    # The service the console pages cover when a shared token is the console service itself.
    known = set(shape_to_key.values())
    unique.update({t: k for t, k in {"lambda": "lambda", "events": "eventbridge", "logs": "cloudwatch-logs"}.items() if k in known})
    result = defaultdict(lambda: {"open": 0, "items": []})
    unmatched = 0
    for path, raw in blobs(commit, paths).items():
        text = raw.decode("utf-8", "replace").splitlines()
        headers, title = {}, ""
        for line in text[:40]:
            if line.startswith("# ") and not title:
                title = line[2:].strip().strip("`")
                break
            match = HEADER.match(line)
            if match:
                headers[match.group(1)] = match.group(2)
        keys = set()
        if headers.get("Issue-Shape-Id") in shape_to_key:
            keys.add(shape_to_key[headers["Issue-Shape-Id"]])
        issue_key = headers.get("Issue-Key", "")
        if "." in issue_key.split("|", 1)[0]:
            for token in issue_key.split(".", 1)[0].split("__"):
                if token in unique:
                    keys.add(unique[token])
        rest = TIMESTAMP.sub("", path.rsplit("/", 1)[1])
        first = rest.split("-", 1)[0]
        if not keys and first in unique:
            keys.add(unique[first])
        if not keys:
            unmatched += 1
            continue
        severity = headers.get("Issue-Severity", "")
        entry = [path.rsplit("/", 1)[1], severity, title[:180]]
        for key in keys:
            result[key]["open"] += 1
            result[key]["items"].append(entry)
    for value in result.values():
        value["items"].sort(key=lambda e: (SEVERITY_ORDER.get(e[1], 9), e[0]))
        value["items"] = value["items"][:MAX_ISSUES_PER_SERVICE]
    return {
        "vendor": {"repo": UPSTREAM, "commit": commit[:12], "tag": tag, "dir": ISSUES_DIR, "open": len(paths), "unmatched": unmatched},
        "services": dict(sorted(result.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--issues-out", default=str(ISSUES_OUT))
    parser.add_argument("--cli-dir", help="AWS CLI v2 install folder (the one that holds awscli/)")
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()

    commit, tag = pinned()
    commands, by_id = cli_tables(find_cli(args.cli_dir))
    models = load_models(commit)
    bundles = build_bundle(models, commands, by_id)
    write_bundle(bundles, Path(args.out))
    issues = build_issues(commit, tag, models)
    Path(args.issues_out).write_text(json.dumps(issues, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    ops = sum(len(b["ops"]) for b in bundles.values())
    runnable = sum(1 for b in bundles.values() for o in b["ops"].values() if "c" in o)
    size = sum(f.stat().st_size for f in Path(args.out).glob("*.json"))
    print(f"apimodel: {tag} ({commit[:12]}), {len(bundles)} services, {ops} operations, {runnable} runnable through the installed CLI, {size / 1e6:.2f} MB -> {args.out}")
    print(f"issues: {issues['vendor']['open']} open, {issues['vendor']['unmatched']} name no service, {len(issues['services'])} services -> {args.issues_out}")
    if args.summary:
        for key in ("s3", "logs", "cloudwatch-logs", "ec2", "kinesis", "stepfunctions"):
            b = bundles.get(key)
            print(f"  {key}: " + (f"cli={b.get('cli')} ops={len(b['ops'])} shapes={len(b['shapes'])}" if b else "missing"))
        no_cli = sorted(k for k, b in bundles.items() if "cli" not in b)
        print(f"  services without a CLI name: {len(no_cli)}: {', '.join(no_cli[:15])}")


if __name__ == "__main__":
    main()
