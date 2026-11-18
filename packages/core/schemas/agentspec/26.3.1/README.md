# Agent Spec 26.3.1, JSON Schema (vendored)

`agentspec_json_spec_26_3_1.json` is the JSON Schema of the Open Agent Specification, version 26.3.1, copied unchanged from Oracle's repository `oracle/agent-spec` at commit `9beda2b`, path `docs/pyagentspec/source/agentspec/json_spec/agentspec_json_spec_26_3_1.json` (SHA-256 `94555001754af4c35b5ce167860d53d8c066ff78612dfaca33a69d48a73e712d`).

Copyright (c) 2025 Oracle and/or its affiliates. It is licensed under the Apache License 2.0 (`LICENSE-APACHE.txt`) or the Universal Permissive License 1.0 (`LICENSE-UPL.txt`), at your option. Both licence texts are copied here from the same commit.

The lab validates Agent Spec documents against this file through `packages/core/src/formats`. How it is used, and the one place where the lab reads it differently from how it is written (the top-level `agentspec_version`), is in `docs/FORMAT.md`.

To move to a later Agent Spec version, add its schema in a folder of its own beside this one and a dialect plugin for it; never edit this file.
