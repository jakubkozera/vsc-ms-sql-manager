---
agent: agent
description: "git remove tag current vesion"
---

Remove local tag "v<current_package_json_version>" and push it to origin i.e.
For version in package.json '0.23.3' execute the following:
`git tag -d v0.23.3; git push origin :refs/tags/v0.23.3`