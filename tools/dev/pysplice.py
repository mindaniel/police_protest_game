"""Splice top-level Python defs and NAME = ... tables from a reply into a file.

    python pysplice.py FILE.py REPLY.md [--before "def name"]

Each top-level `def X(` or `X = ` in the reply's ```python blocks replaces the
item of the same name in FILE; new items go before --before (default: the
first replaced item). Keeps the file's line endings.
"""
import re, sys

def items(s):
    lines, out, i = s.split("\n"), {}, 0
    while i < len(lines):
        m = re.match(r"def (\w+)\(|([A-Z_][A-Z0-9_]*)\s*=", lines[i])
        if m:
            j = i + 1
            while j < len(lines) and (lines[j] == "" or lines[j][0] in " \t)}]"): j += 1
            while j > i + 1 and lines[j - 1] == "": j -= 1
            out[m.group(1) or m.group(2)] = (i, j); i = j
        else:
            i += 1
    return out

def main():
    f, reply = sys.argv[1], open(sys.argv[2], encoding="utf-8").read()
    before = sys.argv[sys.argv.index("--before") + 1] if "--before" in sys.argv else None
    raw = open(f, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in raw else "\n"
    src = raw.replace("\r\n", "\n")
    done = []
    for code in re.findall(r"```python\n(.*?)```", reply, re.S):
        cl = code.split("\n")
        for name, (a, b) in sorted(items(code).items(), key=lambda kv: kv[1][0]):
            sl, cur = src.split("\n"), items(src)
            if name in cur:
                x, y = cur[name]; sl[x:y] = cl[a:b]; done.append(name)
            else:
                k = None
                if before:
                    k = next((n for n, l in enumerate(sl) if l.startswith(before)), None)
                if k is None and done:
                    k = items(src)[done[0]][0]
                if k is None:
                    print("NOT PLACED:", name); continue
                sl[k:k] = cl[a:b] + [""]; done.append("+" + name)
            src = "\n".join(sl)
    open(f, "w", encoding="utf-8", newline="").write(src.replace("\n", nl))
    print("spliced:", " ".join(done))

if __name__ == "__main__":
    main()
