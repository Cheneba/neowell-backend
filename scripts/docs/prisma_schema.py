"""Minimal parser for prisma/schema.prisma, used to generate the schema doc tables and the Excalidraw diagram."""
import re
from pathlib import Path

SCALARS = {"String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes"}


def parse(path):
    text = Path(path).read_text()
    models, enums, docs = {}, {}, {}
    pending_doc = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("///"):
            pending_doc.append(line[3:].strip())
        m = re.match(r"^(model|enum)\s+(\w+)\s*\{", line)
        if m:
            kind, name = m.groups()
            body = []
            i += 1
            while not lines[i].strip().startswith("}"):
                body.append(lines[i])
                i += 1
            if kind == "enum":
                enums[name] = [l.strip().split()[0] for l in body if l.strip() and not l.strip().startswith("//")]
            else:
                models[name] = parse_model(body)
                docs[name] = " ".join(pending_doc)
            pending_doc = []
        elif line and not line.startswith("///"):
            pending_doc = [] if not line.startswith("//") else pending_doc
        i += 1
    for m in models.values():
        for f in m["fields"]:
            f["relation"] = f["base"] in models
            f["enum"] = f["base"] in enums
    return models, enums, docs


def parse_model(body):
    fields, attrs = [], []
    for raw in body:
        s = raw.strip()
        if not s or s.startswith("//"):
            continue
        if s.startswith("@@"):
            attrs.append(s)
            continue
        comment = ""
        if "//" in s:
            s, comment = s.split("//", 1)
            s, comment = s.strip(), comment.strip()
        parts = s.split()
        name, ftype = parts[0], parts[1]
        rest = " ".join(parts[2:])
        base = ftype.rstrip("?").replace("[]", "")
        fields.append(
            {
                "name": name,
                "type": ftype,
                "base": base,
                "optional": ftype.endswith("?"),
                "list": ftype.endswith("[]"),
                "attrs": rest,
                "comment": comment,
                "relation": False,  # resolved in parse() once all models are known
            }
        )
    return {"fields": fields, "attrs": attrs}
