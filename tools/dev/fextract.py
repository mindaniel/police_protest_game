"""Copy named functions out of a JS module, for short DeepSeek prompts.

    python fextract.py FILE NAME [NAME...] > out.js

Prints each `  function NAME(` (2-space indented, matched by braces) with a
comment naming the file and its line number.
"""
import re, sys

def main():
    f = sys.argv[1]
    s = open(f, encoding="utf-8").read().replace("\r\n", "\n")
    for name in sys.argv[2:]:
        m = re.search(r"^  function " + name + r"\s*\(", s, re.M)
        if not m:
            print("/* %s: %s not found */" % (f, name)); continue
        i = s.index("{", m.end()); d = 0
        for j in range(i, len(s)):
            if s[j] == "{": d += 1
            elif s[j] == "}":
                d -= 1
                if d == 0: break
        print("/* %s line %d */" % (f.replace("\\", "/").split("/")[-1], s.count("\n", 0, m.start()) + 1))
        print(s[m.start():j + 1] + "\n")

if __name__ == "__main__":
    main()
