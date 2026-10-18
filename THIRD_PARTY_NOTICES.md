# Third-party dependency review

Release review date: 2026-10-18. The production bundle has no runtime package dependencies; its image work uses browser APIs. Development and build dependencies are locked in `package-lock.json`.

## Preferred licenses found

The installed dependency tree includes MIT, Apache-2.0, BSD-3-Clause, and ISC packages. These are compatible with the project’s preferred license policy. Their license texts remain available in installed package metadata and registry distributions.

## MPL-2.0 review

Vite resolves the optional build-tool packages `lightningcss` and platform-specific `lightningcss-win32-x64-msvc`, both MPL-2.0. They are development/build dependencies, not an application runtime dependency, and inspection of the generated bundle finds no shipped `lightningcss` code. MPL-2.0 is file-level copyleft: if project-owned MPL-covered files are modified and distributed, their source must be made available under MPL-2.0. This project does not modify or distribute those package files. No additional attribution is required for the application’s MIT source, beyond retaining package notices when redistributing those packages themselves.

No model weights are included. Any future local-AI addition requires a separate review of source, weight, commercial-use, and redistribution terms.
