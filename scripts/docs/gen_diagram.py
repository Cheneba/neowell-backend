"""Generates docs/03-database-diagram.excalidraw (+ .svg preview) from prisma/schema.prisma.
Run: python3 scripts/docs/gen_diagram.py"""
import json
import random
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prisma_schema  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
models, enums, _ = prisma_schema.parse(ROOT / "prisma/schema.prisma")
random.seed(42)

BLUE, BLUE_DEEP, BLUE_SOFT = "#62A6EA", "#2C6CB5", "#EAF3FD"
PINK, PINK_DEEP, PINK_SOFT = "#F0849F", "#C2446A", "#FDEEF2"
INK, MUTED, WHITE = "#1E2B3C", "#5E6E82", "#FFFFFF"

# Rows of domains; each domain is a list of columns, each column a list of tables.
LAYOUT = [
    [
        ("Identity & access", [["User"], ["OtpCode", "RefreshToken"]]),
        ("Babies & growth", [["Baby"], ["Measurement"]]),
        ("Facilities & referral", [["Facility", "FacilityDepartment"], ["Referral"]]),
    ],
    [
        ("Checks & triage", [["Observation"], ["Recheck", "VoiceNote"]]),
        ("Clinicians", [["ClinicianProfile"], ["ClinicianDocument", "ClinicianAvailability"]]),
        ("Teleconsultation", [["Consultation"], ["Message", "Review"]]),
    ],
    [
        ("Payments & payouts", [["Payment"], ["Payout"]]),
        ("Drug chart", [["DrugChart", "DrugChartItem"], ["DoseLog"]]),
        ("Notifications", [["Device", "Notification"]]),
        ("Platform", [["Job"], ["WebhookEvent", "AuditLog"]]),
    ],
]

BOX_W, HEAD_H, LINE_H, PAD = 330, 36, 19, 10
COL_GAP, ROW_GAP_IN, DOMAIN_GAP, ZONE_PAD, ZONE_TITLE = 40, 30, 80, 24, 44
FONT = 14


def fk_map(name):
    out = {}
    for f in models[name]["fields"]:
        a = f["attrs"]
        if f["relation"] and "fields:" in a:
            for col in a.split("fields:")[1].split("]")[0].strip(" [").split(","):
                out[col.strip()] = f["base"]
    return out


def rows_for(name):
    fks = fk_map(name)
    rows = []
    for f in models[name]["fields"]:
        if f["relation"]:
            continue
        tag = "PK" if "@id" in f["attrs"] else ("FK" if f["name"] in fks else ("UQ" if "@unique" in f["attrs"] else ""))
        t = f["base"] + ("[]" if f["list"] else "") + ("?" if f["optional"] else "")
        rows.append((tag, f["name"], t))
    return rows


def box_h(name):
    return HEAD_H + PAD * 2 + LINE_H * len(rows_for(name))


# ── layout pass ───────────────────────────────────────────────
pos, zones = {}, []
y = 0
for row in LAYOUT:
    x = 0
    row_h = 0
    for title, cols in row:
        zx, zy = x, y
        cx = zx + ZONE_PAD
        zone_h = 0
        for col in cols:
            cy = zy + ZONE_TITLE
            for t in col:
                pos[t] = (cx, cy)
                cy += box_h(t) + ROW_GAP_IN
            zone_h = max(zone_h, cy - zy)
            cx += BOX_W + COL_GAP
        zw = cx - zx - COL_GAP + ZONE_PAD
        zh = zone_h - ROW_GAP_IN + ZONE_PAD
        zones.append((title, zx, zy, zw, zh))
        row_h = max(row_h, zh)
        x += zw + DOMAIN_GAP
    y += row_h + DOMAIN_GAP

# ── excalidraw elements ───────────────────────────────────────
elements = []


def base(kind, eid, x, y, w, h, **kw):
    e = {
        "id": eid, "type": kind, "x": x, "y": y, "width": w, "height": h, "angle": 0,
        "strokeColor": kw.pop("stroke", INK), "backgroundColor": kw.pop("bg", "transparent"),
        "fillStyle": "solid", "strokeWidth": kw.pop("sw", 1), "strokeStyle": kw.pop("style", "solid"),
        "roughness": 0, "opacity": 100, "groupIds": kw.pop("groups", []), "frameId": None,
        "roundness": kw.pop("roundness", None), "seed": random.randint(1, 2**31), "version": 1,
        "versionNonce": random.randint(1, 2**31), "isDeleted": False, "boundElements": [],
        "updated": 1760000000000, "link": None, "locked": False,
    }
    e.update(kw)
    elements.append(e)
    return e


def text(eid, x, y, w, h, s, size=FONT, color=INK, align="left", valign="top", container=None, family=3, groups=None):
    return base("text", eid, x, y, w, h, stroke=color, groups=groups or [], text=s, fontSize=size,
                fontFamily=family, textAlign=align, verticalAlign=valign, containerId=container,
                originalText=s, autoResize=True, lineHeight=1.25)


for i, (title, zx, zy, zw, zh) in enumerate(zones):
    tint = BLUE_SOFT if i % 2 == 0 else PINK_SOFT
    edge = BLUE if i % 2 == 0 else PINK
    base("rectangle", f"zone-{i}", zx, zy, zw, zh, stroke=edge, bg=tint, roundness={"type": 3}, style="dashed")
    text(f"zone-{i}-t", zx + ZONE_PAD, zy + 10, zw - 2 * ZONE_PAD, 24, title, size=20,
         color=BLUE_DEEP if i % 2 == 0 else PINK_DEEP, family=2)

head_ids = {}
body_ids = {}
for name, (bx, by) in pos.items():
    g = [f"g-{name}"]
    h = box_h(name)
    body = base("rectangle", f"{name}-body", bx, by, BOX_W, h, stroke=BLUE_DEEP, bg=WHITE, sw=2, groups=g,
                roundness={"type": 3})
    head = base("rectangle", f"{name}-head", bx, by, BOX_W, HEAD_H, stroke=BLUE_DEEP, bg=BLUE, sw=2, groups=g,
                roundness={"type": 3})
    t = text(f"{name}-head-t", bx, by + 8, BOX_W, 20, name, size=17, color=WHITE, align="center",
             valign="middle", container=head["id"], family=2, groups=g)
    head["boundElements"].append({"id": t["id"], "type": "text"})
    head_ids[name], body_ids[name] = head, body
    lines = []
    for tag, fname, ftype in rows_for(name):
        lines.append(f"{tag:<3}{fname:<22}{ftype}")
    text(f"{name}-fields", bx + PAD, by + HEAD_H + PAD, BOX_W - 2 * PAD, LINE_H * len(lines),
         "\n".join(lines), size=12.5, color=INK, groups=g)

# Arrows: one per FK, from the FK-holding table to the referenced table.
edges = []
for name in pos:
    for col, target in fk_map(name).items():
        if target in pos and target != name:
            edges.append((name, target, col))


def anchor(name, toward):
    x, y = pos[name]
    h = box_h(name)
    cx, cy = x + BOX_W / 2, y + h / 2
    tx, ty = toward
    dx, dy = tx - cx, ty - cy
    if abs(dx) * h > abs(dy) * BOX_W:  # left/right side
        return (x + BOX_W if dx > 0 else x, min(max(ty, y + HEAD_H / 2), y + h - 10))
    return (min(max(tx, x + 20), x + BOX_W - 20), y + h if dy > 0 else y)


svg_arrows = []
for i, (src, dst, col) in enumerate(edges):
    sx, sy = pos[src]
    dxp, dyp = pos[dst]
    dcenter = (dxp + BOX_W / 2, dyp + HEAD_H / 2)
    scenter = (sx + BOX_W / 2, sy + box_h(src) / 2)
    p1 = anchor(src, dcenter)
    p2 = anchor(dst, scenter)
    aid = f"fk-{i}"
    arrow = base("arrow", aid, p1[0], p1[1], abs(p2[0] - p1[0]), abs(p2[1] - p1[1]), stroke=MUTED, sw=1.5,
                 roundness={"type": 2}, points=[[0, 0], [p2[0] - p1[0], p2[1] - p1[1]]], lastCommittedPoint=None,
                 startBinding={"elementId": body_ids[src]["id"], "focus": 0, "gap": 4},
                 endBinding={"elementId": body_ids[dst]["id"], "focus": 0, "gap": 4},
                 startArrowhead=None, endArrowhead="triangle", elbowed=False)
    body_ids[src]["boundElements"].append({"id": aid, "type": "arrow"})
    body_ids[dst]["boundElements"].append({"id": aid, "type": "arrow"})
    svg_arrows.append((p1, p2, col))

legend_y = y
text("legend", 0, legend_y, 1400, 60,
     "NeoWell database (v2) — generated from prisma/schema.prisma by scripts/docs/gen_diagram.py.\n"
     "PK = primary key · FK = foreign key (arrow points to the referenced table) · UQ = unique · ? = nullable · [] = list",
     size=16, color=MUTED, family=2)

doc = {"type": "excalidraw", "version": 2, "source": "https://excalidraw.com", "elements": elements,
       "appState": {"gridSize": 20, "viewBackgroundColor": "#ffffff"}, "files": {}}
(ROOT / "docs/03-database-diagram.excalidraw").write_text(json.dumps(doc, indent=1))

# ── SVG preview (same layout) ────────────────────────────────
W = max(z[1] + z[3] for z in zones) + 20
H = legend_y + 70
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="-10 -10 {W + 10} {H + 10}" '
       'font-family="Helvetica, Arial, sans-serif">',
       '<defs><marker id="tri" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" '
       f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker></defs>',
       f'<rect x="-10" y="-10" width="{W + 10}" height="{H + 10}" fill="#fff"/>']
for i, (title, zx, zy, zw, zh) in enumerate(zones):
    tint, edge = (BLUE_SOFT, BLUE) if i % 2 == 0 else (PINK_SOFT, PINK)
    col = BLUE_DEEP if i % 2 == 0 else PINK_DEEP
    svg.append(f'<rect x="{zx}" y="{zy}" width="{zw}" height="{zh}" rx="18" fill="{tint}" stroke="{edge}" stroke-dasharray="8 6"/>')
    svg.append(f'<text x="{zx + ZONE_PAD}" y="{zy + 30}" font-size="20" font-weight="bold" fill="{col}">{escape(title)}</text>')
for p1, p2, _ in svg_arrows:
    svg.append(f'<line x1="{p1[0]}" y1="{p1[1]}" x2="{p2[0]}" y2="{p2[1]}" stroke="{MUTED}" stroke-width="1.5" '
               'marker-end="url(#tri)" opacity="0.8"/>')
for name, (bx, by) in pos.items():
    h = box_h(name)
    svg.append(f'<rect x="{bx}" y="{by}" width="{BOX_W}" height="{h}" rx="10" fill="#fff" stroke="{BLUE_DEEP}" stroke-width="2"/>')
    svg.append(f'<path d="M{bx},{by + HEAD_H} V{by + 10} a10,10 0 0 1 10,-10 H{bx + BOX_W - 10} a10,10 0 0 1 10,10 V{by + HEAD_H} Z" fill="{BLUE}" stroke="{BLUE_DEEP}" stroke-width="2"/>')
    svg.append(f'<text x="{bx + BOX_W / 2}" y="{by + 24}" font-size="17" font-weight="bold" fill="#fff" text-anchor="middle">{name}</text>')
    for j, (tag, fname, ftype) in enumerate(rows_for(name)):
        ty = by + HEAD_H + PAD + 14 + j * LINE_H
        color = PINK_DEEP if tag in ("PK", "FK") else MUTED
        svg.append(f'<text x="{bx + PAD}" y="{ty}" font-size="11" font-weight="bold" fill="{color}">{tag}</text>')
        svg.append(f'<text x="{bx + PAD + 28}" y="{ty}" font-size="12.5" fill="{INK}">{escape(fname)}</text>')
        svg.append(f'<text x="{bx + BOX_W - PAD}" y="{ty}" font-size="12" fill="{MUTED}" text-anchor="end">{escape(ftype)}</text>')
svg.append(f'<text x="0" y="{legend_y + 20}" font-size="16" fill="{MUTED}">NeoWell database (v2) — generated from prisma/schema.prisma. '
           'PK primary key · FK foreign key (arrow → referenced table) · UQ unique · ? nullable · [] list</text>')
svg.append("</svg>")
(ROOT / "docs/03-database-diagram.svg").write_text("\n".join(svg))
print(f"wrote diagram: {len(pos)} tables, {len(edges)} relations, {len(elements)} excalidraw elements")
