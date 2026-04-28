import json
import re
from pathlib import Path

IMAGE_DIR = Path("images")
OUTPUT_FILE = Path("flags.json")

# Optional starter metadata. Add to this gradually as you tag flags.
# Everything not listed here will still be included, but with empty tag arrays.
KNOWN_TAGS = {
    "norway": {
        "colors": ["red", "white", "blue"],
        "layout": ["nordic-cross"],
        "symbols": ["cross"]
    },
    "iceland": {
        "colors": ["blue", "white", "red"],
        "layout": ["nordic-cross"],
        "symbols": ["cross"]
    },
    "denmark": {
        "colors": ["red", "white"],
        "layout": ["nordic-cross"],
        "symbols": ["cross"]
    },
    "sweden": {
        "colors": ["blue", "yellow"],
        "layout": ["nordic-cross"],
        "symbols": ["cross"]
    },
    "finland": {
        "colors": ["white", "blue"],
        "layout": ["nordic-cross"],
        "symbols": ["cross"]
    },
    "united-kingdom": {
        "colors": ["red", "white", "blue"],
        "layout": ["diagonal-cross", "quartered"],
        "symbols": ["cross", "saltire"]
    },
    "england": {
        "colors": ["white", "red"],
        "layout": ["centered-cross"],
        "symbols": ["cross"]
    },
    "scotland": {
        "colors": ["blue", "white"],
        "layout": ["diagonal-cross"],
        "symbols": ["saltire"]
    },
    "wales": {
        "colors": ["red", "white", "green"],
        "layout": ["horizontal-bicolor", "centered-emblem"],
        "symbols": ["dragon"]
    },
    "france": {
        "colors": ["blue", "white", "red"],
        "layout": ["vertical-tricolor"],
        "symbols": []
    },
    "italy": {
        "colors": ["green", "white", "red"],
        "layout": ["vertical-tricolor"],
        "symbols": []
    },
    "ireland": {
        "colors": ["green", "white", "orange"],
        "layout": ["vertical-tricolor"],
        "symbols": []
    },
    "germany": {
        "colors": ["black", "red", "yellow"],
        "layout": ["horizontal-tricolor"],
        "symbols": []
    },
    "belgium": {
        "colors": ["black", "yellow", "red"],
        "layout": ["vertical-tricolor"],
        "symbols": []
    },
    "netherlands": {
        "colors": ["red", "white", "blue"],
        "layout": ["horizontal-tricolor"],
        "symbols": []
    },
    "russia": {
        "colors": ["white", "blue", "red"],
        "layout": ["horizontal-tricolor"],
        "symbols": []
    },
    "united-states": {
        "colors": ["red", "white", "blue"],
        "layout": ["stripes", "canton"],
        "symbols": ["stars"]
    },
    "australia": {
        "colors": ["blue", "white", "red"],
        "layout": ["canton"],
        "symbols": ["stars", "union-jack"]
    },
    "new-zealand": {
        "colors": ["blue", "white", "red"],
        "layout": ["canton"],
        "symbols": ["stars", "union-jack"]
    },
    "japan": {
        "colors": ["white", "red"],
        "layout": ["solid-field", "centered-emblem"],
        "symbols": ["disc", "sun"]
    },
    "bangladesh": {
        "colors": ["green", "red"],
        "layout": ["solid-field", "centered-emblem"],
        "symbols": ["disc", "sun"]
    },
    "turkey": {
        "colors": ["red", "white"],
        "layout": ["solid-field"],
        "symbols": ["crescent", "star"]
    },
    "tunisia": {
        "colors": ["red", "white"],
        "layout": ["solid-field", "centered-emblem"],
        "symbols": ["crescent", "star", "disc"]
    },
}

NAME_FIXES = {
    "Peoples Republic of China": "China",
    "Taiwan Republic of China": "Taiwan",
    "Federated States of Micronesia": "Micronesia",
    "Democratic Republic of Congo": "Democratic Republic of the Congo",
    "Republic of Congo": "Republic of the Congo",
    "Cote dIvoire": "Côte d'Ivoire",
}

ID_FIXES = {
    "peoples-republic-of-china": "china",
    "taiwan-republic-of-china": "taiwan",
    "federated-states-of-micronesia": "micronesia",
    "democratic-republic-of-congo": "democratic-republic-of-the-congo",
    "republic-of-congo": "republic-of-the-congo",
    "cote-divoire": "cote-d-ivoire",
}


def strip_size_and_extension(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"-\d+x\d+$", "", stem)
    stem = stem.replace("Flag_of_", "")
    return stem


def make_name(filename: str) -> str:
    raw = strip_size_and_extension(filename).replace("_", " ")
    raw = NAME_FIXES.get(raw, raw)
    return raw


def make_id(name: str) -> str:
    value = name.lower()
    value = value.replace("ø", "o").replace("é", "e").replace("ô", "o").replace("'", "")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return ID_FIXES.get(value, value)


def main():
    if not IMAGE_DIR.exists():
        raise SystemExit("Could not find images/ folder. Put this script next to index.html and flags.json.")

    existing_by_id = {}
    if OUTPUT_FILE.exists():
        try:
            existing = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
            existing_by_id = {item["id"]: item for item in existing if "id" in item}
        except Exception:
            print("Warning: Could not read existing flags.json. Creating a new one.")

    flags = []

    for path in sorted(IMAGE_DIR.glob("*.png")):
        name = make_name(path.name)
        flag_id = make_id(name)

        previous = existing_by_id.get(flag_id, {})
        known = KNOWN_TAGS.get(flag_id, {})

        entry = {
            "id": flag_id,
            "name": previous.get("name", name),
            "image": f"images/{path.name}",
            "colors": previous.get("colors", known.get("colors", [])),
            "layout": previous.get("layout", known.get("layout", [])),
            "symbols": previous.get("symbols", known.get("symbols", [])),
        }
        flags.append(entry)

    OUTPUT_FILE.write_text(json.dumps(flags, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(flags)} entries to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
