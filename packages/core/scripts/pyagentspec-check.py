# Reads topology files with Oracle's pyagentspec and says whether it reads each
# compact file exactly as the full one beside it: python pyagentspec-check.py
# <compact dir> <full dir>. One line per file, "same" or the paths that differ.
# Run by src/formats/pyagentspec.test.ts when AGENTIC_LAB_PYAGENTSPEC names a
# Python that has pyagentspec 26.3.1.
import glob
import json
import sys

from pyagentspec.serialization import AgentSpecDeserializer, AgentSpecSerializer


def as_read(path):
    with open(path) as fh:
        component = AgentSpecDeserializer().from_yaml(fh.read())
    return json.loads(AgentSpecSerializer().to_json(component))


def differences(a, b, path=""):
    if type(a) is not type(b):
        return [path]
    if isinstance(a, dict):
        return [d for k in sorted(set(a) | set(b)) for d in differences(a.get(k), b.get(k), f"{path}/{k}")]
    if isinstance(a, list):
        if len(a) != len(b):
            return [path]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in differences(x, y, f"{path}/{i}")]
    return [] if a == b else [path]


for compact in sorted(glob.glob(f"{sys.argv[1]}/*.yaml")):
    name = compact.split("/")[-1]
    try:
        diff = differences(as_read(compact), as_read(f"{sys.argv[2]}/{name}"))
        print(f"{name} " + ("same" if not diff else "differs " + " ".join(diff[:5])))
    except Exception as error:  # a file pyagentspec refuses
        print(f"{name} refused {type(error).__name__}: {str(error)[:300]}")
