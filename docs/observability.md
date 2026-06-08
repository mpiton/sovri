# Self-host observability and image verification

This guide is for Community-edition self-host operators running the Sovri community-bot image. It
assumes the v0.6.0 (or newer) image. Every command below is copy-pasteable. For the rationale behind
the v0.6 observability milestone see [`docs/adr/019-otel-milestone-v0-6.md`](adr/019-otel-milestone-v0-6.md)
and the unchanged logging/tracing architecture in [`docs/adr/006-pino-then-otel.md`](adr/006-pino-then-otel.md).

## OpenTelemetry stacks

The bot exports OpenTelemetry traces, logs, and metrics over OTLP. Pick one OTLP-compatible backend
and point the bot at it with `OTEL_EXPORTER_OTLP_ENDPOINT`. These three setups are recommended.

- Grafana Cloud (hosted): set `OTEL_EXPORTER_OTLP_ENDPOINT` to your Grafana Cloud OTLP endpoint, for
  example `https://otlp-gateway-prod-eu-west-0.grafana.net/otlp`. Gives traces, logs, and metrics with
  no collector to run yourself.
- Grafana + Tempo + Loki + Prometheus (self-hosted): set `OTEL_EXPORTER_OTLP_ENDPOINT` to your
  collector, e.g. `http://otel-collector:4318`. Tempo stores traces, Loki logs, Prometheus metrics.
  This is the fully sovereign option: nothing leaves your network.
- SigNoz (all-in-one): set `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://signoz-otel-collector:4318`. One
  install gives traces, logs, and metrics behind a single UI.

## Environment variables

| Variable                      | Default               | Purpose                                                  |
| ----------------------------- | --------------------- | -------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (unset)               | OTLP collector URL. Leaving it unset disables telemetry. |
| `OTEL_SERVICE_NAME`           | `sovri-community-bot` | Resource service name on every span and metric.          |
| `OTEL_SERVICE_VERSION`        | `0.0.0`               | Resource service version.                                |

No-op default: with `OTEL_EXPORTER_OTLP_ENDPOINT` unset the bot starts normally and emits no telemetry,
and `createLogger()` behaves exactly as before. You opt into telemetry by setting the endpoint; you
never opt out of anything by leaving it blank.

## Metrics endpoint

The bot serves Prometheus text exposition at `GET /metrics` from the OpenTelemetry meter on port 3000. Scrape it directly:

```
curl http://localhost:3000/metrics
```

Point Prometheus at the same path:

```
scrape_configs:
  - job_name: sovri-community-bot
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:3000"]
```

With telemetry off the endpoint still returns `200` with an empty-but-valid body, so a scraper reads a
healthy zero-series target rather than a failure.

### Business metrics

| Metric                      | Type      | Tags                             |
| --------------------------- | --------- | -------------------------------- |
| `sovri.reviews.total`       | counter   | `status`, `llm_provider`         |
| `sovri.reviews.duration_ms` | histogram | `llm_provider`                   |
| `sovri.findings.total`      | counter   | `severity`, `category`, `source` |
| `sovri.llm.tokens`          | counter   | `provider`, `model`, `direction` |
| `sovri.llm.errors`          | counter   | `provider`, `error_type`         |

### Business spans

A review opens one root span `review.pull_request` with attributes `pr.number`, `pr.repo`,
`llm.provider`, and `findings.count`. It has four child spans: `review.fetch_diff`,
`review.build_prompt`, `review.llm_call`, and `review.parse_findings`. A trace therefore reads
top-down as "fetch the diff, build the prompt, call the model, parse the findings" under one
pull-request root.

What never leaves the bot: spans, metrics, and logs never carry a GitHub token, an LLM API key, or a
raw webhook payload. Telemetry attributes are low-cardinality identifiers and counts only.

## Verify the image before you deploy

Run these checks before you deploy: verify the released digest, then deploy that digest. The release
workflow signs and attests the multi-arch image by digest, so verification is a pre-deploy gate, not a
post-deploy audit.

Keyless signature (cosign):

```
cosign verify ghcr.io/mpiton/sovri/community-bot:v0.6.0 \
  --certificate-identity-regexp '^https://github.com/mpiton/sovri/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

SLSA build provenance, to prove the image was built from the Sovri source by the official release
workflow:

```
gh attestation verify oci://ghcr.io/mpiton/sovri/community-bot:v0.6.0 --owner mpiton
```

Both commands pin the same `ghcr.io/mpiton/sovri/community-bot` repository and the
`https://token.actions.githubusercontent.com` OIDC issuer used by the release workflow. The published
image tags (`v0.6.0`, `v0.6`, `v0`, `latest`) are described in the root README.md; pin a digest or an
exact `vX.Y.Z` tag for reproducible deployments.
