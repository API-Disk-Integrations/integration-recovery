# Integration Recovery API TypeScript SDK

Detect auth, schema, webhook and rate-limit drift in third-party integrations and generate an ordered, machine-readable compatibility repair plan.

This package is the zero-runtime-dependency TypeScript/JavaScript client from
the audited public integration repository. It supports ESM and CommonJS on
Node.js 18 or newer. Import and construction perform no network request.

## Install

```sh
npm install integration-recovery
```

## Authenticated client

```ts
import { IntegrationRecovery } from 'integration-recovery'

const client = new IntegrationRecovery({
  apiKey: process.env.INTEGRATION_RECOVERY_API_KEY,
})
```

Never place an API key in browser code, source control, logs, or examples.
Requesting a sandbox key is an email-verification and claim flow; it does not
return a key in the initial response.

- [Product, docs, demo, pricing, privacy, and terms](https://integrationrecovery-api.com/?utm_source=npm&utm_medium=package&utm_campaign=integration-recovery&utm_content=readme)
- [Source and changelog](https://github.com/API-Disk-Integrations/integration-recovery)
- [Issues](https://github.com/API-Disk-Integrations/integration-recovery/issues)

Security reports must not be filed in a public issue. Use the repository's
private security-reporting path after the owner confirms it is enabled.

MIT licensed. The API service remains governed by the product site's terms.
