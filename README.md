# Integration Recovery API

Detect auth, schema, webhook and rate-limit drift in third-party integrations and generate an ordered, machine-readable compatibility repair plan.

- [Product and pricing](https://integrationrecovery-api.com/?utm_source=github&utm_medium=developer&utm_campaign=integration-recovery-github&utm_content=readme#pricing)
- [Developer documentation](https://integrationrecovery-api.com/docs?utm_source=github&utm_medium=developer&utm_campaign=integration-recovery-github&utm_content=readme)
- [Create a free account](https://integrationrecovery-api.com/signup?utm_source=github&utm_medium=developer&utm_campaign=integration-recovery-github&utm_content=readme)
- [OpenAPI contract](https://integrationrecovery-api.com/openapi.json)
- [Postman collection](./postman_collection.json)

## Quickstart

### 1. Request a free-key verification email

```bash
curl -X POST https://integrationrecovery-api.com/v1/keys \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","source":{"source":"github","medium":"developer","campaign":"integration-recovery-github","content":"readme"}}'
```

The service returns `202 Accepted` and sends a one-time claim link. Follow the
email, or exchange its token with `POST /v1/keys/claim`. The API key is shown
once after verification; store it securely. No card is required for the free
sandbox. Current free allowance: **200 integration checks/month**.

### 2. Make the first product call

```bash
curl -X POST https://integrationrecovery-api.com/v1/checks \
  -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"check":{
        "integrationId":"acme-payments-prod",
        "provider":"northwind-payments",
        "previous":{"endpoints":[{"method":"POST","path":"/v1/charges",
          "request":[{"path":"amount","type":"integer","required":true}],
          "response":[{"path":"receipt_url","type":"string","required":true}]}]},
        "current":{"endpoints":[{"method":"POST","path":"/v1/charges",
          "request":[{"path":"amount","type":"integer","required":true},
                     {"path":"statement_descriptor","type":"string","required":true}],
          "response":[{"path":"receiptUrl","type":"string","required":true}]}]}}}'
```

## SDKs

The repository includes dependency-light client files that point to the current
contract and canonical product domain:

- [Python SDK](./sdk/python/integration_recovery.py) — reads `INTEGRATION_RECOVERY_API_KEY`
- [TypeScript SDK](./sdk/typescript/index.ts)

Copy the file you need into your project. The OpenAPI document remains the
authoritative operation and schema contract.

## Authentication and errors

API operations use `Authorization: Bearer <API_KEY>` (or `x-api-key` where
documented). Dashboard-session operations and signed service webhooks are not
callable with a customer API key. Public demo and health operations require no
credential. Errors use a stable `error.code` plus a request ID for support.

## Distribution attribution

The key request above identifies this README with the stable tuple
`github / developer / integration-recovery-github / readme`. The Postman collection and both
SDKs carry their own source metadata. Attribution is used to compare qualified
activation and retained use; it is not evidence that this channel already
performs.

## License

[MIT](./LICENSE)
