# Integration Recovery API Python SDK

Detect auth, schema, webhook and rate-limit drift in third-party integrations and generate an ordered, machine-readable compatibility repair plan.

This package is the standard-library-only Python client from the audited public
integration repository. It supports Python 3.10 or newer. Import and
construction perform no network request.

## Install

```sh
python -m pip install integration-recovery
```

## Authenticated client

```python
import os
from integration_recovery import IntegrationRecovery

client = IntegrationRecovery(os.environ["INTEGRATION_RECOVERY_API_KEY"])
```

Never place an API key in source control, logs, or examples. Requesting a
sandbox key is an email-verification and claim flow; it does not return a key
in the initial response.

- [Product, docs, demo, pricing, privacy, and terms](https://integrationrecovery-api.com/?utm_source=pypi&utm_medium=project&utm_campaign=integration-recovery&utm_content=readme)
- [Source and changelog](https://github.com/API-Disk-Integrations/integration-recovery)
- [Issues](https://github.com/API-Disk-Integrations/integration-recovery/issues)

Security reports must not be filed in a public issue. Use the repository's
private security-reporting path after the owner confirms it is enabled.

MIT licensed. The API service remains governed by the product site's terms.
