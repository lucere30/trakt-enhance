from pathlib import Path

p = Path("upstream/trakt_simplified_chinese/src/shared/trakt-translation-helper.mjs")
s = p.read_text(encoding="utf-8")


def remove_duplicate_top_level_functions(source, name):
    marker = f"function {name}("
    positions = []
    cursor = 0
    while True:
        index = source.find(marker, cursor)
        if index < 0:
            break
        line_start = source.rfind("\n", 0, index) + 1
        if source[line_start:index].strip() == "":
            positions.append(index)
        cursor = index + len(marker)

    if len(positions) <= 1:
        return source

    ranges = []
    for start in positions[1:]:
        brace_start = source.find("{", start)
        if brace_start < 0:
            raise SystemExit(f"Cannot locate body for duplicate {name}")
        depth = 0
        quote = None
        escaped = False
        end = None
        for i in range(brace_start, len(source)):
            ch = source[i]
            if quote:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == quote:
                    quote = None
                continue
            if ch in ("'", '"', "`"):
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end is None:
            raise SystemExit(f"Unbalanced braces in duplicate {name}")
        line_end = source.find("\n", end)
        ranges.append((start, len(source) if line_end < 0 else line_end + 1))

    for start, end in reversed(ranges):
        source = source[:start] + source[end:]
    return source


for function_name in ("isChineseProductionRef", "shouldTranslateMediaRef"):
    s = remove_duplicate_top_level_functions(s, function_name)

p.write_text(s, encoding="utf-8")
print("Translation patch normalized: duplicate helper declarations removed; first declaration retained.")
