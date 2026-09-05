/**
 * Integration Recovery API client.
 *
 * Zero dependencies — uses the platform `fetch`, so it runs on Node 18+, Deno,
 * Bun, Cloudflare Workers and in the browser without a bundler argument, and
 * loads under `--experimental-strip-types` with no build step.
 *
 * ```ts
 * const client = new IntegrationRecovery()                    // reads INTEGRATION_RECOVERY_API_KEY
 * const client = new IntegrationRecovery({ apiKey: 'sp_live_…', baseUrl: 'https://…' })
 * ```
 *
 * There is no baked-in hostname. A published SDK carrying a stale default
 * origin is how dead URLs reach production; the service origin comes from
 * `options.baseUrl`, from `INTEGRATION_RECOVERY_BASE_URL`, or from
 * `DEFAULT_BASE_URL` below if a deployment fills it in.
 *
 * The one idea to hold on to: **direction**. A field added to a `response` is
 * free; the same field added as required to a `request` rejects every call.
 * Put request fields under `request` and response fields under `response`, and
 * the severities take care of themselves.
 */

/** Set at deploy time. Empty means "pass baseUrl or set INTEGRATION_RECOVERY_BASE_URL". */
export const DEFAULT_BASE_URL = 'https://integrationrecovery-api.com'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'any'
export type AuthScheme = 'none' | 'api_key' | 'basic' | 'bearer' | 'oauth2' | 'hmac' | 'mtls'
export type PaginationStyle = 'none' | 'page' | 'offset' | 'cursor' | 'link_header'

/** `outbound`: your client produces the value. `inbound`: the provider does. */
export type Direction = 'outbound' | 'inbound'
export type Surface = 'endpoint' | 'request' | 'response' | 'auth' | 'webhook' | 'rate_limit' | 'pagination'
export type Severity = 'breaking' | 'degraded' | 'safe'
export type Verdict = 'compatible' | 'degraded' | 'broken'

/** Branch on these, not on `detail`. `GET /v1/drift-types` documents every one. */
export type DriftCode =
  | 'endpoint_added' | 'endpoint_removed' | 'endpoint_deprecated'
  | 'field_added' | 'field_removed' | 'field_renamed' | 'type_changed'
  | 'field_made_required' | 'field_made_optional' | 'nullability_changed'
  | 'enum_value_added' | 'enum_value_removed'
  | 'auth_scheme_changed' | 'auth_location_changed' | 'scope_added' | 'scope_removed'
  | 'token_lifetime_reduced'
  | 'webhook_event_added' | 'webhook_event_removed' | 'webhook_field_added'
  | 'webhook_field_removed' | 'webhook_signature_changed'
  | 'rate_limit_reduced' | 'rate_limit_increased' | 'rate_limit_headers_changed'
  | 'pagination_changed' | 'page_size_reduced'

export type RepairAction =
  | 'map_renamed_field' | 'add_default_value' | 'remove_sent_field' | 'coerce_type'
  | 'guard_nullable_read' | 'handle_unknown_enum' | 'replace_enum_value' | 'read_with_fallback'
  | 'request_scope' | 'drop_scope' | 'migrate_auth_scheme' | 'move_credential'
  | 'shorten_token_refresh' | 'switch_endpoint' | 'plan_endpoint_migration'
  | 'rewrite_pagination' | 'reduce_page_size' | 'add_backoff' | 'rename_rate_limit_header'
  | 'resubscribe_webhook' | 'update_webhook_verifier' | 'manual_review'

/** Apply repairs in this order. Auth first; a backoff added before auth works only slows failures. */
export type RepairPhase = 'auth' | 'routing' | 'outbound_schema' | 'inbound_schema' | 'webhook' | 'throughput'

export interface FieldSpec {
  /** Dotted path inside the object, e.g. `customer.address.postcode`. */
  path: string
  type: FieldType
  /**
   * On a request: the provider rejects the call without it.
   * On a response: the provider guarantees it is present.
   * Never defaulted by the API — this flag decides breaking from safe.
   */
  required: boolean
  /** Defaults to false. On a response, true means your reader must null-check. */
  nullable?: boolean
  /** The complete permitted set. Omit for unconstrained — which is not an empty list. */
  enumValues?: string[]
}

export interface PaginationSpec {
  style: PaginationStyle
  parameter?: string
  nextField?: string
  maxPageSize?: number
}

export interface EndpointSpec {
  method: HttpMethod
  /** Template. `{id}` and `:id` are equivalent; parameter names are ignored when matching. */
  path: string
  /** Fields you SEND. Outbound. */
  request?: FieldSpec[]
  /** Fields you RECEIVE. Inbound. */
  response?: FieldSpec[]
  pagination?: PaginationSpec
  deprecated?: boolean
  /** Announced removal date, compared in whole UTC days. */
  sunsetOn?: string
}

export interface WebhookSpec {
  event: string
  /** Always inbound — you never write a webhook body. */
  payload?: FieldSpec[]
  signatureAlgorithm?: string
  signatureHeader?: string
}

export interface RateLimitSpec {
  /** Requests per window. A whole number, at least 1. */
  limit: number
  windowSeconds: number
  headers?: { limit?: string; remaining?: string; reset?: string }
}

export interface IntegrationSnapshot {
  capturedAt?: string
  /**
   * Omitting the key means "not observed" and skips endpoint drift. An
   * explicit `[]` means "observed, and there are none" — which DOES report
   * every previous endpoint as removed.
   */
  endpoints?: EndpointSpec[]
  auth?: { scheme: AuthScheme; requiredScopes?: string[]; location?: string; tokenLifetimeSeconds?: number }
  webhooks?: WebhookSpec[]
  rateLimit?: RateLimitSpec
}

/** What your client does. Supplying it lets the engine rule changes out; omitting it does not. */
export interface ClientUsage {
  heldScopes?: string[]
  subscribedEvents?: string[]
  observedVolume?: { requests: number; windowSeconds: number }
}

export interface IntegrationCheckInput {
  integrationId: string
  provider: string
  previous: IntegrationSnapshot
  current: IntegrationSnapshot
  usage?: ClientUsage
  metadata?: Record<string, string>
}

export interface DriftChange {
  code: DriftCode
  surface: Surface
  direction: Direction
  target: string
  /** Endpoint label, webhook event, or null for auth and rate limits. */
  container: string | null
  /** Equivalent to `severity === 'breaking'`. */
  breaking: boolean
  severity: Severity
  from: string | null
  to: string | null
  detail: string
}

export interface Repair {
  /** Index into `changes`. */
  change: number
  action: RepairAction
  phase: RepairPhase
  /** 1-based. Apply in ascending order. */
  order: number
  target: string
  container: string | null
  /** Integer 0–100: how likely the repair is correct if applied as described. */
  confidence: number
  /**
   * True only when applying it mechanically cannot lose information, change
   * what you store, or weaken a security check. A step can be high-confidence
   * and still false here — confidence and safety are different questions.
   */
  autoApplicable: boolean
  requiresHuman: string | null
  parameters: Record<string, unknown>
  detail: string
}

export interface RepairPlan {
  steps: Repair[]
  autoApplicable: number
  requiresHuman: number
  fullyAutomatic: boolean
  minConfidence: number | null
}

export interface RateLimitAnalysis {
  previous: { limit: number; windowSeconds: number }
  current: { limit: number; windowSeconds: number }
  direction: 'reduced' | 'increased' | 'unchanged'
  observedVolume: { requests: number; windowSeconds: number } | null
  permittedInObservedWindow: number | null
  excessRequests: number | null
  headroomPct: number | null
  /** Null when no volume was supplied. Never guessed. */
  willExceed: boolean | null
  /** Milliseconds between requests to stay under the limit. Rounded up. */
  minIntervalMs: number
  backoff: { initialDelayMs: number; multiplier: number; maxDelayMs: number; maxAttempts: number }
}

export interface IntegrationDrift {
  integrationId: string
  provider: string
  verdict: Verdict
  summary: {
    total: number
    breaking: number
    degraded: number
    safe: number
    byCode: Record<string, number>
    bySurface: Record<string, number>
  }
  /** Breaking first, then degraded, then safe. */
  changes: DriftChange[]
  repairPlan: RepairPlan
  rateLimit: RateLimitAnalysis | null
  sunsets: Array<{ endpoint: string; sunsetOn: string; daysRemaining: number; passed: boolean }>
  evaluatedAt: string
  warnings: string[]
}

export type ApiErrorCode =
  | 'invalid_api_key' | 'missing_api_key' | 'quota_exceeded' | 'rate_limited'
  | 'invalid_request' | 'not_found' | 'method_not_allowed' | 'payload_too_large'
  | 'conflict' | 'internal_error'

/**
 * Thrown for any non-2xx response.
 *
 * NOT thrown for a verdict of `broken` — that is a successful answer to a
 * legitimate question. On a 400, `details.path` names the exact field.
 */
export class ApiError extends Error {
  // Declared as fields rather than constructor parameter properties: those are
  // unsupported by strip-only TypeScript runtimes, and an SDK should run
  // without a build step.
  readonly status: number
  readonly code: ApiErrorCode | 'unknown'
  readonly requestId?: string
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode | 'unknown', message: string, requestId?: string, details?: unknown) {
    super(`[${status} ${code}] ${message}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

export interface ClientOptions {
  apiKey?: string
  baseUrl?: string
  /** Milliseconds. Default 30000. */
  timeoutMs?: number
  fetch?: typeof fetch
}

/** Optional acquisition metadata. Invalid values are ignored by the service. */
export interface KeySource {
  source?: string
  medium?: string
  campaign?: string
  content?: string
}

export class IntegrationRecovery {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: ClientOptions = {}) {
    const env = (globalThis as any).process?.env ?? {}
    const base = options.baseUrl ?? env.INTEGRATION_RECOVERY_BASE_URL ?? DEFAULT_BASE_URL
    if (!base) {
      throw new Error(
        'No base URL. Pass { baseUrl } or set INTEGRATION_RECOVERY_BASE_URL to the service origin.',
      )
    }
    const key = options.apiKey ?? env.INTEGRATION_RECOVERY_API_KEY
    if (!key) {
      throw new Error(
        'No API key. Pass { apiKey } or set INTEGRATION_RECOVERY_API_KEY. ' +
          'Request a free key verification email: POST ' + String(base).replace(/\/$/, '') + '/v1/keys',
      )
    }
    this.apiKey = key
    this.baseUrl = String(base).replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  private async request(method: string, path: string, body?: unknown, auth = true): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        signal: controller.signal,
        headers: {
          ...(auth ? { authorization: `Bearer ${this.apiKey}` } : {}),
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      const text = await res.text()
      const json = text ? JSON.parse(text) : {}
      if (!res.ok) {
        const e = json?.error ?? {}
        throw new ApiError(res.status, e.code ?? 'unknown', e.message ?? text.slice(0, 200), e.requestId, e.details)
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  /** Liveness and deployed version. Does not require a key. */
  async health(): Promise<{ ok: boolean; product: string; version: string }> {
    return this.request('GET', '/health', undefined, false)
  }

  /**
   * Compare two snapshots of one integration, or up to 50 in a batch.
   *
   * Billed one unit per check. The whole batch is reserved before any
   * comparison runs, so an over-quota call is refused rather than half-served.
   */
  async check(
    check: IntegrationCheckInput | IntegrationCheckInput[],
  ): Promise<{ count: number; breaking: number; checks: IntegrationDrift[]; requestId: string }> {
    return this.request('POST', '/v1/checks', Array.isArray(check) ? { checks: check } : { check })
  }

  /** The real engine with no key: one check, at most 5 endpoints and 60 fields. */
  async demoCheck(check: IntegrationCheckInput): Promise<{ check: IntegrationDrift }> {
    return this.request('POST', '/v1/demo/check', { check }, false)
  }

  /** Every drift code and repair action, with its severity in each direction. Static — cache it. */
  async driftTypes(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/drift-types', undefined, false)
  }

  /** Request a free sandbox key; this emails a claim token. Claiming returns the key once. */
  static async createKey(email: string, opts: { baseUrl?: string; name?: string; source?: KeySource } = {}): Promise<any> {
    const env = (globalThis as any).process?.env ?? {}
    const base = opts.baseUrl ?? env.INTEGRATION_RECOVERY_BASE_URL ?? DEFAULT_BASE_URL
    if (!base) throw new Error('No base URL. Pass { baseUrl } or set INTEGRATION_RECOVERY_BASE_URL.')
    const res = await fetch(String(base).replace(/\/$/, '') + '/v1/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        ...(opts.name ? { name: opts.name } : {}),
        source: opts.source ?? { source: 'sdk', medium: 'typescript' },
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'unknown', json?.error?.message ?? 'failed', json?.error?.requestId)
    return json
  }
}

export default IntegrationRecovery

// ---8<--- BEGIN GENERATED BY tools/gen-sdk.mjs — DO NOT EDIT BELOW ---8<---
// Everything between these markers is written from openapi.json. Change the
// service, regenerate the contract, then re-run `npm run gen:sdk`.

/** The contract this SDK was generated from. */
export const API_TITLE = "Integration Recovery API"
export const API_VERSION = "1.0.0"
/** The origin the published contract names. `DEFAULT_BASE_URL` resolves to this unless overridden. */
export const API_BASE_URL = "https://integrationrecovery-api.com"

/**
 * Every `error.code` the contract publishes.
 *
 * The runtime companion to the `ApiErrorCode` union: a union is erased at
 * compile time, so a caller wanting to test an unknown string against the
 * documented set had nothing to test it with.
 */
export const ERROR_CODES = ["invalid_api_key", "missing_api_key", "quota_exceeded", "rate_limited", "invalid_request", "not_found", "method_not_allowed", "payload_too_large", "conflict", "internal_error"] as const

/** One published operation, exactly as the contract describes it. */
export interface OperationDescriptor {
  readonly operationId: string
  readonly method: string
  readonly path: string
  readonly summary: string
  /** True when the operation requires an API key. False does NOT mean public — see `authKind`. */
  readonly auth: boolean
  /**
   * The credential the operation actually takes.
   *
   * `api_key` — the bearer token this client sends.
   * `session` — the dashboard session cookie, plus `x-csrf-token` on writes.
   *             An API key is REFUSED: these endpoints change what you are
   *             billed and read your payment history, and a key that lives
   *             in CI must not reach them. Call them from the signed-in
   *             dashboard, not from this SDK.
   * `signature` — machine-to-machine; not callable by API consumers.
   * `public` — no credential at all.
   */
  readonly authKind: 'api_key' | 'session' | 'signature' | 'public'
  readonly pathParams: readonly string[]
  readonly queryParams: readonly string[]
  readonly requiredBodyFields: readonly string[]
  readonly successStatus: number | null
  /** Property names of the documented 2xx body. A field absent here is a field the service does not promise. */
  readonly responseFields: readonly string[]
}

/**
 * The published surface, generated. Ships with the client so an integration
 * can assert against the contract instead of against a changelog.
 */
export const OPERATIONS: readonly OperationDescriptor[] = [
  {
    operationId: "get/",
    method: "GET",
    path: "/",
    summary: "Service index — endpoints, auth and error format",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "postApiBillingWebhook",
    method: "POST",
    path: "/api/billing/webhook",
    summary: "Square billing events, forwarded by the shared hub",
    auth: false,
    authKind: "signature",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "getHealth",
    method: "GET",
    path: "/health",
    summary: "Liveness and deployed version",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "postV1Checkout",
    method: "POST",
    path: "/v1/checkout",
    summary: "Start a hosted Square checkout for a paid tier",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["tier"],
    successStatus: 200,
    responseFields: ["checkoutUrl", "tier", "sku", "requestId"],
  },
  {
    operationId: "postV1Checks",
    method: "POST",
    path: "/v1/checks",
    summary: "Detect drift between two observations of an integration and generate a repair plan",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["count", "breaking", "checks"],
  },
  {
    operationId: "postV1DemoCheck",
    method: "POST",
    path: "/v1/demo/check",
    summary: "Public demo — one drift check without a key",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["check"],
    successStatus: 200,
    responseFields: ["check"],
  },
  {
    operationId: "getV1DriftTypes",
    method: "GET",
    path: "/v1/drift-types",
    summary: "Every drift code, repair action and severity rule the engine uses",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["directions", "severities", "verdicts", "driftCodes", "repairPhases", "repairActions", "rules", "limits"],
  },
  {
    operationId: "getV1Invoices",
    method: "GET",
    path: "/v1/invoices",
    summary: "Every invoice issued against this account, newest first (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "count", "note", "invoices", "requestId"],
  },
  {
    operationId: "getV1Keys",
    method: "GET",
    path: "/v1/keys",
    summary: "List your API keys for this API",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "accountId", "keys", "requestId"],
  },
  {
    operationId: "postV1Keys",
    method: "POST",
    path: "/v1/keys",
    summary: "Request a free sandbox API key (sends a verification email)",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["email"],
    successStatus: 202,
    responseFields: ["status", "email", "expiresAt", "next", "message", "requestId"],
  },
  {
    operationId: "postV1KeysIdRevoke",
    method: "POST",
    path: "/v1/keys/{id}/revoke",
    summary: "Revoke one of your API keys",
    auth: true,
    authKind: "api_key",
    pathParams: ["id"],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["id", "status", "message", "requestId"],
  },
  {
    operationId: "postV1KeysIdRotate",
    method: "POST",
    path: "/v1/keys/{id}/rotate",
    summary: "Replace one of your API keys with a new secret",
    auth: true,
    authKind: "api_key",
    pathParams: ["id"],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 201,
    responseFields: ["apiKey", "keyId", "replaced", "product", "quotaPerPeriod", "plan", "warning", "requestId"],
  },
  {
    operationId: "postV1KeysClaim",
    method: "POST",
    path: "/v1/keys/claim",
    summary: "Exchange an emailed claim token for the API key",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["token"],
    successStatus: 201,
    responseFields: ["apiKey", "keyId", "product", "quotaPerPeriod", "plan", "warning", "usage", "requestId"],
  },
  {
    operationId: "getV1Payments",
    method: "GET",
    path: "/v1/payments",
    summary: "Every payment attempted against this account and how it went (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "count", "note", "payments", "requestId"],
  },
  {
    operationId: "getV1Subscription",
    method: "GET",
    path: "/v1/subscription",
    summary: "Your current plan, billing window and available changes (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "subscribed", "status", "plan", "pendingPlan", "planChangesGoThrough", "baseFeeOwner", "cancellation", "tiers", "requestId"],
  },
  {
    operationId: "postV1SubscriptionCancel",
    method: "POST",
    path: "/v1/subscription/cancel",
    summary: "Cancel this plan and end metered access (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["canceled", "canceledAt", "entitlement", "money", "finalInvoice", "requestId"],
  },
  {
    operationId: "postV1SubscriptionPlan",
    method: "POST",
    path: "/v1/subscription/plan",
    summary: "Upgrade or downgrade to another plan (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["planId"],
    successStatus: 200,
    responseFields: ["changed", "direction", "from", "to", "entitlement", "billing", "requestId"],
  },
  {
    operationId: "getV1Usage",
    method: "GET",
    path: "/v1/usage",
    summary: "Your consumption and remaining allowance for this period",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "tier", "status", "unit", "period", "included", "used", "ceiling", "remaining", "overageSoFarMinor", "spendCapMinor", "requestId"],
  },
]
// ---8<--- END GENERATED BY tools/gen-sdk.mjs ---8<---
