# HEYMI Pocket

An installable static companion PWA for the HEYMI ecosystem. The public app keeps
its existing device-local behavior and explicit private-network desktop pairing.

## Shared developer source tools

[HEYMI source compute](docs/HEYMI_COMPUTE.md) connects this checkout to the
maintained Black Sheep Compute engine in a trusted HEYMI checkout. It creates
bounded source-evidence packs and performs supported static checks without AI
inference, an API key or a GitHub Actions runner.

```sh
node scripts/heymi-compute.mjs --help
node scripts/heymi-compute.mjs pack --query "pairing remote permission" --scope .
node --test scripts/heymi-compute.test.mjs
```

These developer commands need Node.js 24+ and a separately available HEYMI source
checkout. They do not install a backend into this static app or bypass the actual
desktop pairing flow. Keep private runtime state and credentials out of this
public repository.

## Offline shell protection

The service worker caches only known public app files and the app, index and
privacy pages. API and unknown paths, authorization headers and arbitrary query
parameters bypass its cache handler. Public tab links and versioned assets retain
offline support. Shell refreshes omit cookies and refuse redirects; private and
`no-store` responses cannot replace cached public files. The cache revision clears
older shell caches when the updated worker activates.

Run the source-compute and service-worker regression tests with `npm test`.
Browser verification is still required when changing the shipped PWA. This source
change does not update an already installed PWA until its host serves the new
worker and the browser activates it.
