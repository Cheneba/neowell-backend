"""Generates docs/02-database-schema-specification.md from prisma/schema.prisma.
Run: python3 scripts/docs/gen_schema_doc.py"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prisma_schema  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
models, enums, docs = prisma_schema.parse(ROOT / "prisma/schema.prisma")

DOMAINS = [
    ("Identity & access", ["User", "OtpCode", "RefreshToken"]),
    ("Babies & growth", ["Baby", "Measurement"]),
    ("Checks & triage", ["Observation", "Recheck", "VoiceNote"]),
    ("Facilities & referral", ["Facility", "FacilityDepartment", "Referral"]),
    ("Clinicians", ["ClinicianProfile", "ClinicianDocument", "ClinicianAvailability"]),
    ("Teleconsultation", ["Consultation", "Message", "Review"]),
    ("Payments & payouts", ["Payment", "Payout"]),
    ("Drug chart", ["DrugChart", "DrugChartItem", "DoseLog"]),
    ("Notifications", ["Device", "Notification"]),
    ("Platform", ["Job", "WebhookEvent", "AuditLog"]),
]

PURPOSE = {
    "User": "Every person with an account: caregiver, clinician or admin. Holds consents and the name used for the 42-day naming rule.",
    "OtpCode": "One-time sign-in codes (stored as HMAC, never in clear).",
    "RefreshToken": "Rotating refresh tokens (stored as SHA-256 hash).",
    "Baby": "A baby followed by a caregiver, with the birth data required by FR-BABY-01. The display name is computed, never stored (FR-BABY-02).",
    "Measurement": "Weight / length / head circumference over time; the first row is the birth measurement (FR-MEAS-01..03).",
    "Observation": "One routine or unwell check: answers, complaints and the stored triage result (FR-CHK).",
    "Recheck": docs.get("Recheck") or "",
    "VoiceNote": "Voice description recorded in the unwell flow, transcribed by the self-hosted speech service (FR-VOICE).",
    "Facility": "Health facility in the directory (also used as birth facility and referral destination).",
    "FacilityDepartment": "Department helpline (Neonatology, Paediatrics, …) of a facility.",
    "Referral": "Clinician referral of a baby to a facility, with urgency and a short code (FR-CONS-11).",
    "ClinicianProfile": "Professional profile, per-medium fees, availability flag, verification state and payout number.",
    "ClinicianDocument": "Licence, degree and employment proof uploaded for verification (FR-CLIN-02).",
    "ClinicianAvailability": docs.get("ClinicianAvailability") or "",
    "Consultation": "A paid teleconsultation: medium, timing, lifecycle, money split, pre-visit summary and outcome.",
    "Message": "Chat message in a consultation; contact details masked (FR-CONS-07/08).",
    "Review": "Caregiver rating of a completed consultation (FR-CONS-13).",
    "Payment": "Mobile-money collection or refund for a consultation (FR-PAY).",
    "Payout": "Weekly grouping of a clinician's earnings, marked paid by admins (FR-CONS-14).",
    "DrugChart": "Medication plan prescribed in a consultation (FR-CONS-12).",
    "DrugChartItem": "One medicine with dose, route, times and duration.",
    "DoseLog": "Caregiver's record that a scheduled dose was given or skipped (FR-DRUG-03).",
    "Device": "Push-notification device (Expo push token) of a user (FR-ACC-05).",
    "Notification": "In-app inbox entry; also tracks push/SMS delivery (FR-NOT).",
    "Job": docs.get("Job") or "",
    "WebhookEvent": docs.get("WebhookEvent") or "",
    "AuditLog": "Who did what, when (FR-AUD). No request bodies.",
}

ENUM_NOTES = {
    "CareStatus": "IN_HOSPITAL / KANGAROO_CARE pause home checks (FR-BABY-05).",
    "ConsultationStatus": "See the lifecycle diagram in §4.",
    "PaymentStatus": "Consultation-level and payment-level money state.",
    "Complaint": "Unwell-flow complaints (FR-CHK-03).",
}


def fmt_type(f):
    t = f["base"] + ("[]" if f["list"] else "")
    return f"`{t}`" + (" (enum)" if f.get("enum") else "")


def keys(f, model):
    a = f["attrs"]
    out = []
    if "@id" in a:
        out.append("PK")
    if "@unique" in a:
        out.append("unique")
    if f["base"] in models and "@relation" in a and "fields:" in a:
        pass
    return ", ".join(out)


def fk_fields(model):
    fks = {}
    for f in models[model]["fields"]:
        a = f["attrs"]
        if "@relation" in a and "fields:" in a:
            src = a.split("fields:")[1].split("]")[0].strip(" [")
            for col in src.split(","):
                fks[col.strip()] = f["base"]
    return fks


def default_of(f):
    a = f["attrs"]
    if "@default(" in a:
        d = a.split("@default(", 1)[1]
        depth, out = 1, ""
        for ch in d:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    break
            out += ch
        return out
    if "@updatedAt" in a:
        return "auto (on update)"
    return ""


lines = []
for domain, names in DOMAINS:
    lines.append(f"### {domain}\n")
    for name in names:
        m = models[name]
        fks = fk_fields(name)
        lines.append(f"#### `{name}`\n")
        lines.append(PURPOSE.get(name, "") + "\n")
        lines.append("| Field | Type | Null | Key | Default | Notes |")
        lines.append("|---|---|---|---|---|---|")
        for f in m["fields"]:
            if f["relation"]:
                continue
            key = []
            if "@id" in f["attrs"]:
                key.append("PK")
            if "@unique" in f["attrs"]:
                key.append("UQ")
            if f["name"] in fks:
                key.append(f"FK → {fks[f['name']]}")
            dbm = re.search(r"@db\.(\w+(\([^)]*\))?)", f["attrs"])
            db = f" ({dbm.group(1)})" if dbm else ""
            null = "yes" if f["optional"] else ("—" if f["list"] else "no")
            lines.append(
                f"| `{f['name']}` | {fmt_type(f)}{db} | {null} | {', '.join(key)} | {default_of(f).replace('|', '/')} | {f['comment'].replace('|', '/')} |"
            )
        rels = [f for f in m["fields"] if f["relation"]]
        if rels:
            lines.append("")
            lines.append("**Relations:** " + "; ".join(
                f"`{f['name']}` → {f['base']}{' (many)' if f['list'] else (' (optional)' if f['optional'] else '')}" for f in rels))
        idx = [a for a in m["attrs"]]
        if idx:
            lines.append("")
            lines.append("**Constraints / indexes:** " + "; ".join(f"`{a}`" for a in idx))
        lines.append("")

enum_lines = ["| Enum | Values | Notes |", "|---|---|---|"]
for name, values in enums.items():
    enum_lines.append(f"| `{name}` | {', '.join(f'`{v}`' for v in values)} | {ENUM_NOTES.get(name, '')} |")

template = (ROOT / "scripts/docs/schema-doc-template.md").read_text()
out = template.replace("{{ENTITY_TABLES}}", "\n".join(lines)).replace("{{ENUMS}}", "\n".join(enum_lines))
out = out.replace("{{COUNTS}}", f"{len(models)} tables and {len(enums)} enums")
(ROOT / "docs/02-database-schema-specification.md").write_text(out)
print("wrote docs/02-database-schema-specification.md")
