# Shared HEYMI source compute

This public static PWA now has a developer-only client for the maintained compute
engine in the owner's trusted HEYMI checkout. It does not add a browser backend,
remote-control permission or provider connection to Pocket.

Use Node.js 24+ locally. Keep sibling checkouts named `HEYMI` and `HEYMI-Pocket`,
or set `HEYMI_COMPUTE_CLI` to the absolute path of
`HEYMI/tools/black-sheep-compute/cli.mjs`. No dependency installation is required.
The shared engine needs explicit `--project-root` and literal root scope support.

```sh
node scripts/heymi-compute.mjs pack \
  --query "pairing remote permission" --scope . --max-files 3
node scripts/heymi-compute.mjs check --pack-dir ABSOLUTE_OUTPUT_DIRECTORY
node scripts/heymi-compute.mjs doctor
```

The pack searches only permitted tracked materialized source, includes this
project's `AGENTS.md`, and saves bounded matching lines, source hashes and a
review job outside the public checkout. A literal `.` scope covers this flat
repository; sensitive paths, private untracked files, binaries and source limits
remain enforced by the shared engine. No model or API key is needed for pack/check.
Doctor probes provider metadata only if `--probe true` is explicitly supplied.

The checker verifies exact source hashes, parses JSON and checks supported
JavaScript syntax without executing selected source. Unsupported extensions are
reported honestly. It does not replace real PWA/browser/device tests.

`integrations/heymi-compute.json` describes developer capabilities. The new
`package.json` contains only optional developer command shortcuts; it does not
change the static app's runtime or service-worker asset cache. The local client
accepts only pack/check/doctor and fixed options. It never initiates AI generation,
installs packages, creates a hosted service or changes application data.

Keep all provider keys, browser profiles, pairing tokens, localStorage exports
and private desktop files out of source packs. Existing desktop access continues
to require the actual private-network pairing flow and desktop approval. A
public static page cannot directly run a local Node/Git/LLM service.

Verify the consumer independently of any application dependencies:

```sh
node --test scripts/heymi-compute.test.mjs
```

These contract tests use a fake shared CLI; all five passed on 26 October 2026.
A real shared-engine pack of this flat repository included `app.js`, which passed
the actual Node syntax check without being executed. This does not establish a
live paired desktop, browser behavior, provider or deployment. A missing trusted
shared checkout returns a setup blocker.
