"""Splice functions from a DeepSeek reply into a JS module by name.

    python fsplice.py FILE REPLY [--before "  function startPlay"]

Every `  function NAME(` in the reply's ```js blocks replaces the function of
the same name in FILE (matched by braces), or is inserted before the --before
anchor when FILE has no such function.  A block that starts with `return {`
replaces the module's last `  return {...};`.  Use for replies that send only
changed functions (long files get cut off when sent whole).
"""
import re, sys

def func_spans(src, indent="  "):
    out = {}
    for m in re.finditer(r"^" + indent + r"function (\w+)\s*\(", src, re.M):
        i = src.index("{", m.end())
        d = 0
        for j in range(i, len(src)):
            if src[j] == "{": d += 1
            elif src[j] == "}":
                d -= 1
                if d == 0: break
        out[m.group(1)] = (m.start(), j + 1)
    return out

def main():
    f, reply = sys.argv[1], open(sys.argv[2], encoding="utf-8").read()
    before = sys.argv[sys.argv.index("--before") + 1] if "--before" in sys.argv else None
    src = open(f, encoding="utf-8").read()
    blocks = [b.rstrip("\n") for b in re.findall(r"```(?:js|javascript)?\n(.*?)```", reply, re.S)]
    done = []
    for b in blocks:
        b2 = b if b.startswith("  ") else "\n".join("  " + l if l else l for l in b.split("\n"))
        if b2.lstrip().startswith("return {"):
            i = src.rindex("  return {"); j = src.index("};", i) + 2
            src = src[:i] + b2.strip("\n") + src[j:]; done.append("return"); continue
        new = func_spans(b2)
        for name, (s, e) in sorted(new.items(), key=lambda kv: kv[1][0]):
            body = b2[s:e]
            cur = func_spans(src)
            if name in cur:
                a, z = cur[name]; src = src[:a] + body + src[z:]; done.append(name)
            elif before and before in src:
                k = src.index(before); src = src[:k] + body + "\n\n" + src[k:]; done.append("+" + name)
            else:
                print("NOT PLACED:", name)
    open(f, "w", encoding="utf-8").write(src)
    print("spliced:", " ".join(done))

if __name__ == "__main__":
    main()
