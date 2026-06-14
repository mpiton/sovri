<p align="center">
  <img src="assets/banner.png" alt="Sovri — EU-sovereign AI code review for regulated enterprises" width="100%">
</p>

# Sovri

> EU-sovereign AI code review for regulated enterprises.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-339933?logo=node.js&logoColor=white)](.nvmrc)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)

Sovri is a GitHub pull-request review bot built for organizations that cannot adopt US-hosted SaaS code-review tools — banks under DORA, healthcare providers under HDS, public-sector operators under NIS2, defense and dual-use industries. It is distributed as two complementary editions:

- **Community** — Apache 2.0, self-hosted, free. Everything you need to run reviews on your own infrastructure with the LLM provider of your choice. Lives in this repository under [`packages/*`](#architecture) and [`apps/community-bot/`](#architecture).
- **Cloud** — proprietary, managed in the European Union. Adds SSO, multi-tenancy, billing, and an audit log on top of the Community engine. Not published here.

The Community edition is the source of truth for all review logic. The Cloud edition only adds SaaS infrastructure; no review feature is gated behind it.

---

## Why Sovri

The dominant AI code-review tools — CodeRabbit, Qodo, CodeAnt — are US-centric SaaS products. For regulated EU customers, that model fails three tests at once:

1. **Data residency** — code is shipped to a US-hosted backend, often through a US-controlled LLM endpoint.
2. **Auditability** — closed-source pipelines cannot be reviewed by a DPO or RSSI before adoption.
3. **Vendor lock-in on the model** — the LLM provider is imposed by the vendor, not chosen by the customer.

Sovri inverts each of these:

- **Self-host first** — the bot runs on your own infrastructure; no Sovri-controlled backend is involved in the Community edition.
- **Open and auditable** — Apache 2.0 source, deterministic toolchain (pinned dependencies, locked LLM SDK versions, SBOM at every release).
- **Bring-your-own LLM** — Anthropic, Mistral, OpenAI, or any OpenAI-compatible endpoint. No model is bundled or required.

Sovri does **not** claim to be a certified product. There is no ISO 27001, no SOC 2, no HDS, no SecNumCloud certification today. Each of these has a roadmap entry; none is implied by the current state of the code.

---

## How it works

<p align="center">
  <img src="assets/how-it-works.png" alt="A pull request flows through three steps: Sovri reads the diff, runs the review, and returns findings with an audit trail" width="640">
</p>

A pull request opens. Sovri reads the diff, runs it through the review engine with the LLM provider you configured, and posts a walkthrough plus inline findings. Every finding carries a provenance trail — model, prompt digest, hosting region — so a reviewer can audit how the verdict was reached.

---

## Install

The Community bot ships as a multi-arch container image on the GitHub Container Registry. The current published pre-alpha release is `v0.9.0`:

```bash
docker pull ghcr.io/mpiton/sovri/community-bot:v0.9.0
```

Additional tags follow the [Image tags](#image-tags) section of `Run the Community bot` below (`v0.9`, `v0`, `latest`).

---

## Status

**Pre-alpha.** The `v0.5.0` sprint has shipped the public design system (`@sovri/brand` tokens) and applied it to the bot's review output: a deterministic verdict header, a severity-badged findings table, the review assessment block, refreshed inline findings, the collapsible compliance/provenance block, GitHub Checks status rows, and a light/dark snapshot harness — all GitHub-safe Markdown. The `v0.6.0` sprint shipped observability (OpenTelemetry + a `/metrics` endpoint, see `docs/adr/019-otel-milestone-v0-6.md`) and supply-chain hardening (cosign keyless signing + SLSA build provenance). The `v0.7.0` sprint adds regulatory compliance enrichment: security and bug findings now carry GDPR, DORA, and NIS2 references derived from a CWE-to-regulation mapping, gated on a confidence threshold. The `v0.8.0` sprint adds SARIF 2.1.0 ingestion: an external scanner report is validated at the boundary, mapped to findings (severity, CWE, file-path safety, suppressions), and merged with the LLM findings with cross-tool dedup, plus a `@sovri/cli` package whose `sovri verify` command checks an audit trail. The `v0.9.0` sprint hardens the release path: a per-file license-header gate, an `esbuild` advisory pin (GHSA-gv7w-rqvm-qjhr), and a boot-time warning when the GitHub App is missing a required webhook subscription.

Track progress through the [issues](https://github.com/mpiton/sovri/issues) and the `[Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md).

---

## Architecture

The runtime is a thin Probot adapter that delegates every review to pure TypeScript packages.

```text
GitHub webhook
      │
      ▼
apps/community-bot           (Probot, HMAC validation, command routing)
      │
      ▼
packages/review-engine       (diff → prompt → LLM call → Zod parsing → findings)
      │
      ├─► packages/llm-providers   (BYOK adapters)
      ├─► packages/config          (.sovri.yml parsing)
      └─► packages/observability   (Pino logger, OpenTelemetry)
      │
      ▼
packages/core                (pure domain, Zod schemas, zero I/O)
```

Detailed technical decisions are tracked as Architecture Decision Records under [`docs/adr/`](docs/adr/). The full toolchain (Node.js 24 LTS, pnpm 10, Turborepo 2, Probot 14, Zod 4, Vitest 4, oxlint, oxfmt, tsup, Docker on GHCR) is locked through ADRs 001 to 014.

---

## Build from source

The repository builds today, even though the bot is not yet feature-complete.

### Prerequisites

- **Node.js 24 LTS** — version pinned in [`.nvmrc`](.nvmrc). Use `nvm use` or `fnm use`.
- **pnpm 10** — enable through Corepack: `corepack enable && corepack prepare pnpm@10 --activate`.
- **Docker** (optional) — only required for the integration tests and the bot image.

### Steps

```bash
git clone https://github.com/mpiton/sovri.git
cd sovri
pnpm install --frozen-lockfile
pnpm turbo build
pnpm turbo test
```

The first install runs `--ignore-scripts` by policy (see [`.npmrc`](.npmrc)); no transitive `postinstall` script is allowed to execute.

---

## Run the Community bot

The `v0.9.0` image is published for pre-alpha validation. It is not yet the
complete self-host Community product; on top of the v0.7.0 compliance enrichment
it adds SARIF 2.1.0 ingestion (external scanner findings merged into the review)
and release-path hardening (per-file license-header gate, `esbuild` advisory
pin). The bot is distributed as:

- a multi-architecture container image on GitHub Container Registry (`ghcr.io/mpiton/sovri/community-bot`),
- a standalone Node.js process built from source for users who prefer to deploy without Docker.

Configuration is provided through a `.sovri.yml` file in each repository and environment variables for the GitHub App credentials and LLM API keys. The bot remains **stateless** in pre-alpha: its only persistent state is the configuration file and the GitHub API itself.

### Configuration

The active self-host providers are Anthropic and Mistral. Configure at least
one provider API key in the bot runtime, then point `.sovri.yml` at the matching
environment variable name:

```bash
export ANTHROPIC_API_KEY="<anthropic-api-key>"
export MISTRAL_API_KEY="<mistral-api-key>"
```

```yaml
llm:
  provider: mistral
  model: mistral-large-latest
  apiKeySecret: MISTRAL_API_KEY
```

See the full [`.sovri.yml` reference](docs/sovri-yml-reference.md) for every
supported field, default, and example.

### Image tags

Each release publishes the same image digest under four tags on `ghcr.io/mpiton/sovri/community-bot`:

- `vX.Y.Z` — pinned to the exact SemVer release (e.g. `v0.9.0`).
- `vX.Y` — moving alias for the latest patch of a minor (e.g. `v0.9`).
- `vX` — moving alias for the latest minor of a major (e.g. `v0`).
- `latest` — always points at the most recent published release.

Deployments that need reproducibility should pin to `vX.Y.Z`. The moving aliases (`vX.Y`, `vX`, `latest`) are convenient for local trials but receive new digests on every release.

---

## Documentation

| Resource                                                     | What you will find                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`CHANGELOG.md`](CHANGELOG.md)                               | Keep-a-Changelog 1.1 history, Unreleased section updated on every PR.   |
| [`docs/sovri-yml-reference.md`](docs/sovri-yml-reference.md) | `.sovri.yml` fields, defaults, providers, and examples.                 |
| [`docs/observability.md`](docs/observability.md)             | Self-host OTel wiring, the `/metrics` endpoint, and image verification. |
| [`docs/adr/`](docs/adr/)                                     | Architecture Decision Records (toolchain, licensing, security policy).  |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                         | How to file issues, propose features, send pull requests.               |
| [`.github/SECURITY.md`](.github/SECURITY.md)                 | Vulnerability reporting policy, scope, response SLA.                    |

---

## Contributing

Contributions are welcome under the Apache 2.0 license of this repository. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a substantial change --
Sovri deliberately ships a narrow feature set and several common additions are
out of scope.

Security-sensitive reports go through the private channels in [`.github/SECURITY.md`](.github/SECURITY.md), never through public issues.

---

## License

This repository is licensed under the [Apache License 2.0](LICENSE). The license applies to every file under `packages/*` and `apps/community-bot/`. The proprietary Cloud edition (`apps/cloud-api/`) is **not** distributed under Apache 2.0 and is not published in this repository.

Copyright 2026 Sovri contributors.
