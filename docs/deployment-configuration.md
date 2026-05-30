# Deployment Configuration

This document describes the deployment-level environment variables that a
self-hosted Sovri Community operator sets on the bot host. These complement the
repository-level [`.sovri.yml`](./sovri-yml-reference.md): the file is an
optional per-repository override, while the variables below define the defaults
used when a repository has no (or an empty) `.sovri.yml`.

## Why deployment defaults exist

`.sovri.yml` is optional. An operator configures the default LLM provider once,
then reviews any number of repositories without committing a `.sovri.yml` to
each one. A repository that needs different settings ships its own `.sovri.yml`,
which always takes precedence over the deployment defaults.

## Default LLM provider variables

| Variable                           | Required    | Default                                        | Notes                                                                                      |
| ---------------------------------- | ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SOVRI_DEFAULT_LLM_PROVIDER`       | No          | Inferred from the present API key              | Accepted values: `anthropic`, `mistral`. When set, it overrides inference.                 |
| `SOVRI_DEFAULT_LLM_MODEL`          | No          | Provider default (see below)                   | Must satisfy the same model-identifier rules as `llm.model` in `.sovri.yml`.               |
| `SOVRI_DEFAULT_LLM_API_KEY_SECRET` | No          | Conventional name for the provider (see below) | The **name** of the env var holding the key, e.g. `MISTRAL_API_KEY`. Never the key itself. |
| `ANTHROPIC_API_KEY`                | Conditional | —                                              | The Anthropic API key. Required when the resolved provider is Anthropic.                   |
| `MISTRAL_API_KEY`                  | Conditional | —                                              | The Mistral API key. Required when the resolved provider is Mistral.                       |

Per-provider defaults when `SOVRI_DEFAULT_LLM_MODEL` / `SOVRI_DEFAULT_LLM_API_KEY_SECRET`
are omitted:

| Provider    | Default model              | Conventional key secret |
| ----------- | -------------------------- | ----------------------- |
| `anthropic` | `claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY`     |
| `mistral`   | `mistral-large-latest`     | `MISTRAL_API_KEY`       |

## Resolution order

When a repository has no `.sovri.yml` (or an empty / comment-only one), the
provider is resolved as follows:

1. **Explicit** — if `SOVRI_DEFAULT_LLM_PROVIDER` is set, that provider is used.
2. **Inferred** — otherwise the bot checks the present API keys. If only one of
   `ANTHROPIC_API_KEY` / `MISTRAL_API_KEY` is set, that provider is used.
3. **Both keys present** — when both keys are set and no explicit provider is
   configured, the bot selects **Anthropic** (a deterministic, backward-compatible
   precedence) and logs a warning recommending an explicit
   `SOVRI_DEFAULT_LLM_PROVIDER`.
4. **None determinable** — if no provider can be chosen (no explicit provider and
   no provider key), the pull request receives a configuration error explaining
   how to set `SOVRI_DEFAULT_LLM_PROVIDER` and a key, or to add a `.sovri.yml`.

For regulated self-host deployments, set `SOVRI_DEFAULT_LLM_PROVIDER` explicitly
rather than relying on inference.

## Examples

Mistral-only deployment, no per-repository config required:

```bash
export MISTRAL_API_KEY="<mistral-api-key>"
export SOVRI_DEFAULT_LLM_PROVIDER="mistral"
```

Anthropic deployment with an explicit model and a custom key-secret name:

```bash
export ACME_ANTHROPIC_KEY="<anthropic-api-key>"
export SOVRI_DEFAULT_LLM_PROVIDER="anthropic"
export SOVRI_DEFAULT_LLM_MODEL="claude-3-5-sonnet-latest"
export SOVRI_DEFAULT_LLM_API_KEY_SECRET="ACME_ANTHROPIC_KEY"
```

## Validation and safety

Every `SOVRI_DEFAULT_LLM_*` value is validated through the same schema as
`.sovri.yml`. An unsupported provider, an invalid model identifier, or an
api-key-secret name that is not a valid environment variable name is rejected
with a clear configuration error before it is used, logged, or posted to a pull
request. `SOVRI_DEFAULT_LLM_API_KEY_SECRET` is the **name** of an environment
variable, never the secret value; a value that looks like a real key is rejected
by the env-var-name rule.

A repository `.sovri.yml` is never merged with or shadowed by these defaults.
When a repository ships its own `.sovri.yml`, that configuration is used as-is,
and a missing-key error names the repository-selected provider's key.
