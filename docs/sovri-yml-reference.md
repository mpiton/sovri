# `.sovri.yml` Reference

This document describes the repository-level configuration file consumed by
Sovri Community. The active schema is `SovriConfigSchema` in
`packages/config/src/types/SovriConfig.ts`.

`.sovri.yml` is **optional**. It is a repository-level override: when it is
absent (or present but empty), the bot uses the deployment-level defaults
configured on the bot host. See
[deployment-configuration.md](./deployment-configuration.md) for how a self-host
operator sets the default provider once and reviews many repositories without
committing a `.sovri.yml` to each one. Add a `.sovri.yml` only when a repository
needs settings that differ from the deployment defaults (a different provider or
model, custom review mode, ignore patterns, or limits).

When present, the file lives at the root of the reviewed repository:

```text
.sovri.yml
```

The v0.2 configuration surface has four top-level blocks:

- `llm`
- `review`
- `ignores`
- `limits`

## Examples

### Minimal Anthropic Example

```yaml
llm:
  provider: anthropic
  model: claude-3-5-sonnet-latest
  apiKeySecret: ANTHROPIC_API_KEY
```

The value of `apiKeySecret` is the name of an environment variable that exists
in the bot runtime. It is never the API key value.

### Full Mistral Example

```yaml
llm:
  provider: mistral
  model: mistral-large-latest
  apiKeySecret: MISTRAL_API_KEY

review:
  mode: minimal
  autoReviewDrafts: false
  severityThreshold: major

ignores:
  - "dist/**"
  - "coverage/**"
  - "**/*.generated.ts"
  - "**/*.snap"
  - "docs/archive/**"

limits:
  maxFilesPerReview: 75
  maxLinesPerReview: 8000
```

## Field Reference

| Field                      | Type                      | Required | Default           | Allowed values                                                      | Notes                                                                                                                            |
| -------------------------- | ------------------------- | -------- | ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `llm.provider`             | String                    | Yes      | No schema default | `anthropic`, `mistral`                                              | Selects the active LLM adapter. Only these two providers are accepted in v0.2.                                                   |
| `llm.model`                | String                    | Yes      | No schema default | Model identifiers containing letters, digits, `.`, `-`, `_`, or `:` | Maximum 256 characters. Control characters and whitespace are rejected.                                                          |
| `llm.baseUrl`              | Optional HTTPS URL        | No       | Omitted           | Any valid `https://` URL up to 2048 characters                      | Use only when an adapter needs a provider endpoint override. Do not place API keys in URLs.                                      |
| `llm.apiKeySecret`         | Environment variable name | Yes      | No schema default | Uppercase letters, digits, and `_`; must start with a letter or `_` | Configure `ANTHROPIC_API_KEY` or `MISTRAL_API_KEY` in the bot environment. The YAML value is never the API key value.            |
| `review.mode`              | String                    | No       | Default: `full`   | `full`, `bugs-only`, `strict`, `minimal`                            | Controls the prompt strategy used for review. Use `strict` for comprehensive regulated-codebase reviews.                         |
| `review.autoReviewDrafts`  | Boolean                   | No       | Default: `false`  | `true`, `false`                                                     | When `false`, draft pull requests are skipped until they become ready for review.                                                |
| `review.severityThreshold` | String                    | No       | Default: `minor`  | `blocker`, `major`, `minor`                                         | Findings below the selected threshold are filtered from the final review output.                                                 |
| `ignores`                  | Array of strings          | No       | Default: `[]`     | Repository-relative POSIX glob patterns                             | A finding is hidden when its file path matches at least one pattern. Each pattern must be non-empty and at most 1024 characters. |
| `limits.maxFilesPerReview` | Positive integer          | No       | Default: `50`     | `1` to `500`                                                        | Pull requests above this file count are outside the configured review budget.                                                    |
| `limits.maxLinesPerReview` | Positive integer          | No       | Default: `5000`   | `1` to `50000`                                                      | Pull requests above this changed-line count are outside the configured review budget.                                            |

## Provider Keys

Provider API keys are supplied through environment variables on the bot host,
not through `.sovri.yml`.

```bash
export ANTHROPIC_API_KEY="<anthropic-api-key>"
export MISTRAL_API_KEY="<mistral-api-key>"
```

The YAML file selects which environment variable name to read:

```yaml
llm:
  provider: mistral
  model: mistral-large-latest
  apiKeySecret: MISTRAL_API_KEY
```

Do not commit real provider API keys, private keys, webhook secrets, or any
other credential to the reviewed repository.

## Defaults

When the `review` block is omitted, Sovri behaves as if the file contained:

```yaml
review:
  mode: full
  autoReviewDrafts: false
  severityThreshold: minor
```

When the `limits` block is omitted, Sovri behaves as if the file contained:

```yaml
limits:
  maxFilesPerReview: 50
  maxLinesPerReview: 5000
```

When `ignores` is omitted, no path patterns are ignored.

When the whole file is absent or empty, the `llm` block is resolved from the
deployment configuration instead of the file. See
[deployment-configuration.md](./deployment-configuration.md). The `review`,
`ignores`, and `limits` blocks then take the schema defaults listed above.

## Validation Behavior

Sovri validates `.sovri.yml` before using it. Unknown keys are rejected, invalid
provider or review-mode values are rejected, non-HTTPS `baseUrl` values are
rejected, and malformed environment variable names are rejected before the
configuration reaches the review engine.
