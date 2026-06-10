<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Sovri SAS -->

# Audit trail (Community)

Sovri can write a signed, offline-verifiable audit trail of every review it runs. Each trail is a
JSONL file: an Ed25519-signed hash chain opened by a `trail.started` genesis entry, followed by the
review lifecycle (`review.started`, `llm.called`, `finding.created`, `review.completed` / `review.failed`).
Deleting, reordering, or editing any entry breaks the chain and is detectable with no network access.

The trail is **off by default**. It is an instance-level concern (it writes to the bot host's disk),
so it is configured through environment variables, never through a repository's `.sovri.yml`.

## Enabling the trail on the bot

| Variable                        | Required     | Description                                                                                                                                                                                              |
| ------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOVRI_AUDIT_TRAIL`             | yes          | Set to `on` / `true` / `1` / `yes` to enable. Any other value leaves the review path unchanged.                                                                                                          |
| `SOVRI_AUDIT_TRAIL_PATH`        | when enabled | A writable directory. One JSONL file is written per review.                                                                                                                                              |
| `SOVRI_AUDIT_TRAIL_PRIVATE_KEY` | no           | An Ed25519 private key (PKCS#8 PEM) for a stable signing identity across runs. When omitted, an ephemeral key is generated per trail: the trail stays tamper-evident, but carries no cross-run identity. |

The bot's container runs with a read-only filesystem except for mounted volumes, so
`SOVRI_AUDIT_TRAIL_PATH` must point at a writable mount.

A misconfiguration (enabled with no path, or an invalid private key) surfaces as a deployment
configuration error on the review path, not a crash at startup.

### Output files

One file per webhook delivery, named `<repo>__pr<number>__<commitSha>__<deliveryId>.jsonl`
(for example `octo_repo__pr42__<sha>__<delivery>.jsonl`). Distinct trails never share a writer, so
concurrent reviews cannot interleave entries onto the same chain.

The signing public key is embedded in the `trail.started` entry, so each file is self-describing and
verifiable on its own.

## Verifying a trail offline

Use the `sovri verify` command from the `@sovri/cli` package:

```bash
# Verify against the key embedded in the trail's trail.started entry
sovri verify path/to/trail.jsonl

# Or pin a known signing key (recommended for an external auditor)
sovri verify path/to/trail.jsonl --public-key path/to/signing-key.pem
```

Output and exit codes:

- valid trail: prints `VALID — N entries, chain and signatures intact`, exit code `0`.
- tampered trail: prints `INVALID — entry <i>: <reason>` (`previous_hash mismatch`,
  `entry_hash mismatch`, or `signature invalid`), exit code `1`.
- unreadable or malformed input: prints `verify failed: …`, exit code `1`.

The verifier performs no I/O beyond reading the two files and never reaches the network, so an
auditor can run it in an isolated environment.
