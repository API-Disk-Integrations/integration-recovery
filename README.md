# Integration Recovery API

Detect auth, schema, webhook and rate-limit drift in third-party integrations
and generate an ordered, machine-readable compatibility repair plan.

- [Product and pricing](https://integrationrecovery-api.com/?utm_source=github&utm_medium=developer&utm_campaign=integration-recovery-github&utm_content=readme#pricing)
- [Developer documentation](https://integrationrecovery-api.com/docs?utm_source=github&utm_medium=developer&utm_campaign=integration-recovery-github&utm_content=readme)
- [Create a free account](https://integrationrecovery-api.com/signup?utm_source=github&utm_medium=developer&utm_campaign=integration-recovery-github&utm_content=readme)
- [OpenAPI contract](https://integrationrecovery-api.com/openapi.json)
- [Postman collection](./postman_collection.json)

## Quickstart: diagnose one integration drift without an account

This deliberately small demo runs the production comparison and repair engine,
stores nothing, and requires no key.

```bash
curl -sS -X POST https://integrationrecovery-api.com/v1/demo/check \
  -H 'content-type: application/json' \
  -d '{"check":{"integrationId":"acme-payments-prod","provider":"northwind-payments","previous":{"capturedAt":"2026-05-01T00:00:00Z","endpoints":[{"method":"POST","path":"/v1/charges","request":[{"path":"amount","type":"integer","required":true}],"response":[{"path":"receipt_url","type":"string","required":true}]}]},"current":{"capturedAt":"2026-08-01T00:00:00Z","endpoints":[{"method":"POST","path":"/v1/charges","request":[{"path":"amount","type":"integer","required":true},{"path":"statement_descriptor","type":"string","required":true}],"response":[{"path":"receiptUrl","type":"string","required":true}]}]}}}'
```

The response classifies both changes as breaking and orders the repair work:

```json
{
  "check": {
    "integrationId": "acme-payments-prod",
    "verdict": "broken",
    "summary": {"total": 2, "breaking": 2, "degraded": 0, "safe": 0},
    "changes": [
      {"code": "field_added", "surface": "request", "target": "statement_descriptor", "breaking": true},
      {"code": "field_renamed", "surface": "response", "target": "receipt_url", "to": "receiptUrl", "breaking": true}
    ],
    "repairPlan": {
      "steps": [
        {"change": 0, "action": "add_default_value", "phase": "outbound_schema", "order": 1, "target": "statement_descriptor", "confidence": 20, "autoApplicable": false},
        {"change": 1, "action": "map_renamed_field", "phase": "inbound_schema", "order": 2, "target": "receipt_url", "confidence": 95, "autoApplicable": true}
      ],
      "autoApplicable": 1,
      "requiresHuman": 1,
      "fullyAutomatic": false
    }
  },
  "requestId": "req_example"
}
```

That is the first useful result: `verdict` says whether the integration is safe
to run, while `repairPlan.steps` says what to change and in what order. Step 1
needs a human-supplied default because `autoApplicable` is false; step 2 is an
automatic response-field mapping because `autoApplicable` is true.

## Create and use a free API key

```bash
curl -sS -X POST https://integrationrecovery-api.com/v1/keys \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","source":{"source":"github","medium":"developer","campaign":"integration-recovery-github","content":"readme"}}'

curl -sS -X POST https://integrationrecovery-api.com/v1/keys/claim \
  -H 'content-type: application/json' \
  -d '{"token":"PASTE_ONE_TIME_TOKEN_FROM_EMAIL"}'

export KEY='PASTE_API_KEY_FROM_CLAIM_RESPONSE'
```

Use the same complete `check` under the authenticated endpoint for a metered
integration check:

```bash
curl -sS -X POST https://integrationrecovery-api.com/v1/checks \
  -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"check":{"integrationId":"acme-payments-prod","provider":"northwind-payments","previous":{"capturedAt":"2026-05-01T00:00:00Z","endpoints":[{"method":"POST","path":"/v1/charges","request":[{"path":"amount","type":"integer","required":true}],"response":[{"path":"receipt_url","type":"string","required":true}]}]},"current":{"capturedAt":"2026-08-01T00:00:00Z","endpoints":[{"method":"POST","path":"/v1/charges","request":[{"path":"amount","type":"integer","required":true},{"path":"statement_descriptor","type":"string","required":true}],"response":[{"path":"receiptUrl","type":"string","required":true}]}]}}}'
```

## SDKs

- [Python SDK](./sdk/python/integration_recovery.py) — reads `INTEGRATION_RECOVERY_API_KEY`
- [TypeScript SDK](./sdk/typescript/index.ts)

The request shown here is a supported runtime example and has been checked
against the deployed comparison engine. The current OpenAPI document describes
the routes and documented request shapes, but it is not authoritative for the
still-unreconciled nullable or opaque response fields. Generated/certified
connector use remains held until Development reconciles the deployed runtime,
OpenAPI, and SDK request exclusivity, required fields, response shapes,
nullability, `evaluatedAt`, and `rateLimit` behavior. This hold does not prevent
the exact direct-HTTP example above from being used.

## Collection scope

The runnable Postman collection includes the public demo, the no-key checkout
path, key bootstrap, and API-key product operations. It intentionally excludes
the provider-only billing webhook and browser-session subscription, invoice,
and payment routes: those require a signed hub request or the dashboard's
HttpOnly session and CSRF controls, and a bearer API key cannot run them. The
OpenAPI document linked above remains the reference for those operations.

## Authentication and troubleshooting

- `401`: set `KEY` to the value returned once by `/v1/keys/claim`.
- `400 invalid_request`: send exactly one `check` (or a non-empty `checks`
  array), each with `integrationId`, `provider`, `previous` and `current`. A
  client-side schema tool may label the same input problem `422` before send.
- `429`: wait for `Retry-After` when present, then retry with backoff.

Errors use a stable `error.code` and request ID. Share only the request ID with
support, never customer contract captures, the API key or claim token.

## Distribution attribution

The key request above uses the stable tuple
`github / developer / integration-recovery-github / readme`. The Postman
collection and SDKs carry their own source metadata. Attribution compares
qualified activation and retained use; it does not claim that this channel
already performs.

## License

[MIT](./LICENSE)
