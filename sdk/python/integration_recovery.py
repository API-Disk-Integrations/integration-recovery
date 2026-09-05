"""
Integration Recovery API client.

Zero dependencies beyond the standard library — no requests, no httpx — so it
drops into any environment without a dependency negotiation.

    from integration_recovery import IntegrationRecovery

    client = IntegrationRecovery()             # reads INTEGRATION_RECOVERY_API_KEY
    client = IntegrationRecovery("sp_live_…")  # or pass it explicitly

There is no baked-in hostname. A published SDK carrying a stale default origin
is how dead URLs reach production, so the service origin comes from
``base_url``, from ``INTEGRATION_RECOVERY_BASE_URL``, or from
``DEFAULT_BASE_URL`` below if a deployment fills it in.

Start free-key verification, then claim the token delivered by email:
Free tier: 200 integration checks a month, no card.

    curl -X POST $INTEGRATION_RECOVERY_BASE_URL/v1/keys \
      -H 'content-type: application/json' -d '{"email":"you@example.com","source":{"source":"sdk","medium":"python"}}'

The one idea to hold on to is DIRECTION. A field added to a ``response`` is
free; the same field added as required to a ``request`` rejects every call.
Put request fields under ``request`` and response fields under ``response``,
and the severities take care of themselves.
"""

from __future__ import annotations

import json as _json
import os
import urllib.error
import urllib.request

__all__ = [
    "IntegrationRecovery",
    "ApiError",
    "DRIFT_CODES",
    "REPAIR_ACTIONS",
    "REPAIR_PHASES",
    "SEVERITIES",
    "VERDICTS",
    "FIELD_TYPES", "API_TITLE", "API_VERSION", "API_BASE_URL", "ERROR_CODES", "OPERATIONS"]

#: Set at deploy time. Empty means "pass base_url or set INTEGRATION_RECOVERY_BASE_URL".
DEFAULT_BASE_URL = "https://integrationrecovery-api.com"

FIELD_TYPES = ("string", "integer", "number", "boolean", "object", "array", "any")

SEVERITIES = ("breaking", "degraded", "safe")
VERDICTS = ("compatible", "degraded", "broken")

#: Branch on these, never on the human-readable ``detail``.
#: ``GET /v1/drift-types`` returns each one with its severity in each direction.
DRIFT_CODES = (
    "endpoint_added", "endpoint_removed", "endpoint_deprecated",
    "field_added",            # outbound + required -> breaking; inbound -> safe
    "field_removed",          # outbound -> degraded;            inbound -> breaking
    "field_renamed",          # breaking both ways, and the cheapest to repair
    "type_changed",           # outbound safe when widened; inbound safe when narrowed
    "field_made_required",    # outbound -> breaking;            inbound -> safe
    "field_made_optional",    # outbound -> safe;                inbound -> breaking
    "nullability_changed",
    "enum_value_added",       # outbound -> safe;                inbound -> degraded
    "enum_value_removed",     # outbound -> breaking;            inbound -> safe
    "auth_scheme_changed", "auth_location_changed", "scope_added", "scope_removed",
    "token_lifetime_reduced",
    "webhook_event_added", "webhook_event_removed",
    "webhook_field_added", "webhook_field_removed", "webhook_signature_changed",
    "rate_limit_reduced", "rate_limit_increased", "rate_limit_headers_changed",
    "pagination_changed", "page_size_reduced",
)

#: Repairs are applied in this order. Auth first: nothing else is testable
#: without a working credential. Throughput last: a backoff added before the
#: calls succeed only slows down failures.
REPAIR_PHASES = ("auth", "routing", "outbound_schema", "inbound_schema", "webhook", "throughput")

REPAIR_ACTIONS = (
    "map_renamed_field", "add_default_value", "remove_sent_field", "coerce_type",
    "guard_nullable_read", "handle_unknown_enum", "replace_enum_value", "read_with_fallback",
    "request_scope", "drop_scope", "migrate_auth_scheme", "move_credential",
    "shorten_token_refresh", "switch_endpoint", "plan_endpoint_migration",
    "rewrite_pagination", "reduce_page_size", "add_backoff", "rename_rate_limit_header",
    "resubscribe_webhook", "update_webhook_verifier", "manual_review",
)


class ApiError(Exception):
    """
    Raised for any non-2xx response.

    NOT raised for a verdict of ``broken`` — that is a successful answer to a
    legitimate question. On a 400, ``details["path"]`` names the exact field
    that failed validation.
    """

    def __init__(self, status: int, code: str, message: str, request_id: str | None = None, details=None):
        super().__init__(f"[{status} {code}] {message}")
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details


def _resolve_base(base_url: str | None) -> str:
    base = base_url or os.environ.get("INTEGRATION_RECOVERY_BASE_URL") or DEFAULT_BASE_URL
    if not base:
        raise ValueError(
            "No base URL. Pass base_url=... or set INTEGRATION_RECOVERY_BASE_URL "
            "to the service origin."
        )
    return base.rstrip("/")


class IntegrationRecovery:
    def __init__(self, api_key: str | None = None, *, base_url: str | None = None, timeout: float = 30.0):
        self.base_url = _resolve_base(base_url)
        key = api_key or os.environ.get("INTEGRATION_RECOVERY_API_KEY")
        if not key:
            raise ValueError(
                "No API key. Pass one to IntegrationRecovery(...) or set "
                "INTEGRATION_RECOVERY_API_KEY. Request a free key verification email: POST "
                '{}/v1/keys with {{"email": "you@example.com"}}'.format(self.base_url)
            )
        self.api_key = key
        self.timeout = timeout

    # -- transport ---------------------------------------------------------
    def _request(self, method: str, path: str, *, body=None, auth: bool = True) -> dict:
        data = _json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        if auth:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return _json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                err = _json.loads(raw).get("error", {})
            except Exception:
                err = {}
            raise ApiError(
                e.code, err.get("code", "unknown"), err.get("message", raw[:200]),
                err.get("requestId"), err.get("details"),
            ) from None

    # -- API ---------------------------------------------------------------
    def health(self) -> dict:
        """Liveness and deployed version. Does not require a key."""
        return self._request("GET", "/health", auth=False)

    def check(
        self,
        integration_id: str,
        provider: str,
        previous: dict,
        current: dict,
        usage: dict | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """
        Compare two observations of one integration.

        Billed one unit. ``previous`` and ``current`` are snapshots: any of
        ``endpoints``, ``auth``, ``webhooks`` and ``rateLimit``. Omitting a key
        means "not observed" and skips that section; an explicit ``[]`` means
        "observed, and there are none", which does report removals.

        ``usage`` is what lets the engine rule changes out — ``heldScopes``,
        ``subscribedEvents`` and ``observedVolume``. Leaving it out never
        lowers a severity.
        """
        payload: dict = {
            "integrationId": integration_id,
            "provider": provider,
            "previous": previous,
            "current": current,
        }
        if usage is not None:
            payload["usage"] = usage
        if metadata is not None:
            payload["metadata"] = metadata
        return self._request("POST", "/v1/checks", body={"check": payload})

    def check_batch(self, checks: list) -> dict:
        """
        Compare up to 50 integrations in one call, billed one unit each.

        The whole batch is reserved before any comparison runs, so an
        over-quota call is refused with 429 and consumes nothing.
        """
        return self._request("POST", "/v1/checks", body={"checks": checks})

    def demo_check(self, check: dict) -> dict:
        """The real engine with no key: one check, at most 5 endpoints and 60 fields."""
        return self._request("POST", "/v1/demo/check", body={"check": check}, auth=False)

    def drift_types(self) -> dict:
        """Every drift code and repair action, with its severity in each direction."""
        return self._request("GET", "/v1/drift-types", auth=False)

    @staticmethod
    def create_key(
        email: str,
        *,
        base_url: str | None = None,
        name: str | None = None,
        source: dict[str, str] | None = None,
    ) -> dict:
        """Request a free sandbox key; this emails a claim token. Claiming returns the key once."""
        payload: dict = {
            "email": email,
            "source": source if source is not None else {"source": "sdk", "medium": "python"},
        }
        if name:
            payload["name"] = name
        req = urllib.request.Request(
            _resolve_base(base_url) + "/v1/keys", data=_json.dumps(payload).encode(), method="POST"
        )
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as res:
            return _json.loads(res.read().decode())

# ---8<--- BEGIN GENERATED BY tools/gen-sdk.mjs — DO NOT EDIT BELOW ---8<---
# Everything between these markers is written from openapi.json. Change the
# service, regenerate the contract, then re-run `npm run gen:sdk`.

#: The contract this SDK was generated from.
API_TITLE = "Integration Recovery API"
API_VERSION = "1.0.0"
#: The origin the published contract names.
API_BASE_URL = "https://integrationrecovery-api.com"

#: Every ``error.code`` the contract publishes. Branch on these, never on the message.
ERROR_CODES = ("invalid_api_key", "missing_api_key", "quota_exceeded", "rate_limited", "invalid_request", "not_found", "method_not_allowed", "payload_too_large", "conflict", "internal_error")

#: The published surface, generated. Ships with the client so an integration
#: can assert against the contract instead of against a changelog.
OPERATIONS = (
    {
        "operation_id": "get/",
        "method": "GET",
        "path": "/",
        "summary": "Service index — endpoints, auth and error format",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "postApiBillingWebhook",
        "method": "POST",
        "path": "/api/billing/webhook",
        "summary": "Square billing events, forwarded by the shared hub",
        "auth": False,
        "auth_kind": "signature",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "getHealth",
        "method": "GET",
        "path": "/health",
        "summary": "Liveness and deployed version",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "postV1Checkout",
        "method": "POST",
        "path": "/v1/checkout",
        "summary": "Start a hosted Square checkout for a paid tier",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("tier",),
        "success_status": 200,
        "response_fields": ("checkoutUrl", "tier", "sku", "requestId"),
    },
    {
        "operation_id": "postV1Checks",
        "method": "POST",
        "path": "/v1/checks",
        "summary": "Detect drift between two observations of an integration and generate a repair plan",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("count", "breaking", "checks"),
    },
    {
        "operation_id": "postV1DemoCheck",
        "method": "POST",
        "path": "/v1/demo/check",
        "summary": "Public demo — one drift check without a key",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("check",),
        "success_status": 200,
        "response_fields": ("check",),
    },
    {
        "operation_id": "getV1DriftTypes",
        "method": "GET",
        "path": "/v1/drift-types",
        "summary": "Every drift code, repair action and severity rule the engine uses",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("directions", "severities", "verdicts", "driftCodes", "repairPhases", "repairActions", "rules", "limits"),
    },
    {
        "operation_id": "getV1Invoices",
        "method": "GET",
        "path": "/v1/invoices",
        "summary": "Every invoice issued against this account, newest first (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "count", "note", "invoices", "requestId"),
    },
    {
        "operation_id": "getV1Keys",
        "method": "GET",
        "path": "/v1/keys",
        "summary": "List your API keys for this API",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "accountId", "keys", "requestId"),
    },
    {
        "operation_id": "postV1Keys",
        "method": "POST",
        "path": "/v1/keys",
        "summary": "Request a free sandbox API key (sends a verification email)",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("email",),
        "success_status": 202,
        "response_fields": ("status", "email", "expiresAt", "next", "message", "requestId"),
    },
    {
        "operation_id": "postV1KeysIdRevoke",
        "method": "POST",
        "path": "/v1/keys/{id}/revoke",
        "summary": "Revoke one of your API keys",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": ("id",),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("id", "status", "message", "requestId"),
    },
    {
        "operation_id": "postV1KeysIdRotate",
        "method": "POST",
        "path": "/v1/keys/{id}/rotate",
        "summary": "Replace one of your API keys with a new secret",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": ("id",),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 201,
        "response_fields": ("apiKey", "keyId", "replaced", "product", "quotaPerPeriod", "plan", "warning", "requestId"),
    },
    {
        "operation_id": "postV1KeysClaim",
        "method": "POST",
        "path": "/v1/keys/claim",
        "summary": "Exchange an emailed claim token for the API key",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("token",),
        "success_status": 201,
        "response_fields": ("apiKey", "keyId", "product", "quotaPerPeriod", "plan", "warning", "usage", "requestId"),
    },
    {
        "operation_id": "getV1Payments",
        "method": "GET",
        "path": "/v1/payments",
        "summary": "Every payment attempted against this account and how it went (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "count", "note", "payments", "requestId"),
    },
    {
        "operation_id": "getV1Subscription",
        "method": "GET",
        "path": "/v1/subscription",
        "summary": "Your current plan, billing window and available changes (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "subscribed", "status", "plan", "pendingPlan", "planChangesGoThrough", "baseFeeOwner", "cancellation", "tiers", "requestId"),
    },
    {
        "operation_id": "postV1SubscriptionCancel",
        "method": "POST",
        "path": "/v1/subscription/cancel",
        "summary": "Cancel this plan and end metered access (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("canceled", "canceledAt", "entitlement", "money", "finalInvoice", "requestId"),
    },
    {
        "operation_id": "postV1SubscriptionPlan",
        "method": "POST",
        "path": "/v1/subscription/plan",
        "summary": "Upgrade or downgrade to another plan (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("planId",),
        "success_status": 200,
        "response_fields": ("changed", "direction", "from", "to", "entitlement", "billing", "requestId"),
    },
    {
        "operation_id": "getV1Usage",
        "method": "GET",
        "path": "/v1/usage",
        "summary": "Your consumption and remaining allowance for this period",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "tier", "status", "unit", "period", "included", "used", "ceiling", "remaining", "overageSoFarMinor", "spendCapMinor", "requestId"),
    },
)
# ---8<--- END GENERATED BY tools/gen-sdk.mjs ---8<---
