# Sovri — Architecture technique

**Version :** 1.0
**Périmètre :** Architecture du bot de revue de PR Sovri Community + préparation des fondations Cloud
**Statut :** Document de référence pour l'implémentation v0.1 → v1.0
**Auteur :** Mathieu

---

## 0. Note de cadrage

Ce document définit l'architecture technique de Sovri. Il complète le PRD (`prd-v1.md`) qui définit **quoi** construire ; ARCHI.md définit **comment** le construire.

Les choix présentés ici sont **opinionated**. Chaque décision majeure est justifiée par un ADR (Architecture Decision Record) en section 13. Une remise en cause d'un ADR nécessite une révision tracée du document, pas une modification silencieuse.

Trois principes directeurs :

1. **Le code Community doit être auditable par n'importe quel RSSI en moins d'une journée.** Architecture lisible, dépendances minimales, séparation claire entre logique métier et adapters.
2. **Le code Cloud n'apporte que de l'infrastructure SaaS, jamais de la logique métier propriétaire.** Tout le moteur de review reste dans Community ; Cloud n'ajoute que SSO, multi-tenancy, billing, audit log.
3. **La sécurité supply chain n'est pas une feature, c'est un prérequis.** Suite à l'attaque mini-shai-hulud du 11 mai 2026 (TanStack, Mistral SDK, OpenSearch compromis), Sovri intègre les protections dès le walking skeleton.

---

## 1. Vue d'ensemble

### 1.1 Architecture en couches

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Webhook Events                    │
│         (pull_request.opened, synchronize, etc.)            │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS + HMAC
                             ▼
┌─────────────────────────────────────────────────────────────┐
│           apps/community-bot (Probot + Octokit)             │
│      Webhook handlers, command parser (@sovri-bot)          │
└────────────────────────────┬────────────────────────────────┘
                             │ orchestrates
                             ▼
┌─────────────────────────────────────────────────────────────┐
│           packages/review-engine                            │
│   Diff parsing → Prompt building → LLM call → Parsing       │
│   → Compliance enrichment → Walkthrough composition         │
│   → Optional audit trail sink                               │
└──────┬──────────────┬──────────────┬──────────────┬─────────┬─────────┘
       │              │              │              │         │
       ▼              ▼              ▼              ▼         ▼
   ┌────────┐   ┌──────────┐   ┌────────┐   ┌──────────────┐ ┌──────────┐
   │  core  │   │   llm-   │   │ config │   │observability │ │compliance│
   │(types) │   │providers │   │(.sovri.│   │ (Pino, +OTel │ │ mapping +│
   │        │   │  (BYOK)  │   │  yml)  │   │  à v0.6)     │ │ audit API│
   └────────┘   └──────────┘   └────────┘   └──────────────┘ └──────────┘
                     │
            ┌────────┴────────┬────────┬────────┐
            ▼                 ▼        ▼        ▼
        ┌────────┐      ┌─────────┐  ┌────┐  ┌─────────┐
        │Mistral │      │Anthropic│  │... │  │ OpenAI- │
        │   v2   │      │   SDK   │  │    │  │compat   │
        └────────┘      └─────────┘  └────┘  └─────────┘
```

### 1.2 Frontière Community / Cloud

```
sovri (monorepo)
│
├── packages/           ← TOUS publiés en Apache 2.0
│   ├── core
│   ├── review-engine
│   ├── llm-providers
│   ├── config
│   ├── compliance
│   └── observability
│
├── apps/
│   ├── community-bot/  ← Apache 2.0, image Docker publique
│   │
│   ├── cloud-api/      ← Propriétaire, jamais publié
│   │   (scaffold en v0.9, Cloud Beta en v1.0 ; importe les packages)
│   └── site/           ← Propriétaire/local, jamais publié dans le repo OSS
│       (landing page `sovri.eu`, pages privacy/terms/DPA/subprocessors)
│
└── docs/               ← partiellement public
```

Le code Cloud importe les `packages/` (qui sont Apache 2.0) mais **ne contribue rien en retour** côté open source. C'est une pratique licite : Apache 2.0 ne couvre que le code explicitement publié sous cette licence. Cloud reste 100 % propriétaire.

### 1.3 Public Website Boundary

`apps/site` is the local workspace for the `sovri.eu` public website. It follows the same
local/private boundary model as `apps/cloud-api`: it may live under `apps/` for developer
ergonomics and shared workspace tooling, but it is excluded from the public OSS publication
unless a later explicit publication decision is made.

The site is a React + Vite application compiled to static assets. Vite is used as the local
dev server and production compiler; there is no SSR, no Next.js runtime, and no backend in
the website workspace for v1.0. Public pages are implemented as explicit routes/pages in the
React app and deployed as static HTML/CSS/JS assets.

The site owns:

- the landing page based on the validated mockup;
- public legal pages: `/privacy`, `/terms` or `/cgu`, `/dpa`, `/subprocessors`;
- Cloud Beta signing support content, including the public subprocessor registry.

`apps/site` may consume published public packages such as `@sovri/brand`, but must not
contain review business logic and must not be imported by `packages/*` or
`apps/community-bot`. Legal drafts under local ignored paths are working material only; the
published website pages become the customer-facing source once reviewed and deployed.

### 1.4 Cloud API and Identity Boundary

`apps/cloud-api` owns SaaS infrastructure only: authentication, tenant membership,
billing, audit logs, GitHub/GitLab installation management, and customer-facing API
orchestration. Review business logic stays in `packages/review-engine`.

The Cloud API backend is a NestJS application running on the Fastify adapter. This does
not change the v0.1 Community bot decision: Probot remains the public bot framework, and
the v0.1 rejection of NestJS applies only to the stateless Community bot surface.

Identity is evaluated through an implementation spike before the auth dependency is
locked. Better Auth is the first candidate. The spike must prove:

- passwordless email sign-in through magic link or OTP, with password login disabled;
- GitHub OAuth and Google OAuth sign-in;
- GitLab sign-in through OAuth/OIDC, including a self-hosted provider path when possible;
- tenant-scoped organization membership and RBAC;
- tenant-scoped OIDC/SAML SSO for enterprise customers;
- secure session cookie behavior across the website and API domains;
- explicit account-linking rules and audit events for sensitive auth changes.

Direct LDAP binds are out of scope for public Sovri Cloud. Customers with LDAP or Active
Directory must expose it through an IdP that supports OIDC or SAML, such as Keycloak,
Authentik, Microsoft Entra ID, Okta, Google Workspace, or Zitadel. Direct LDAP can only be
revisited for dedicated/self-hosted deployments after the public Cloud path is stable.

---

## 2. Toolchain — Décisions verrouillées

| Couche                         | Choix                          | Version cible v0.1 | Justification (ADR) |
| ------------------------------ | ------------------------------ | ------------------ | ------------------- |
| Runtime                        | Node.js LTS                    | 24.x               | ADR-001             |
| Langage                        | TypeScript strict              | 5.7+               | ADR-001             |
| Package manager                | pnpm                           | 10.x               | ADR-002             |
| Monorepo orchestration         | Turborepo                      | 2.x                | ADR-002             |
| Module system                  | ESM uniquement                 | —                  | ADR-003             |
| Framework GitHub               | Probot                         | 14.x               | ADR-004             |
| Validation runtime             | Zod                            | 4.x                | ADR-005             |
| Logger                         | Pino                           | 9.x                | ADR-006             |
| Observability (traces/metrics) | OpenTelemetry SDK              | SDK 2.0+ — v0.6    | ADR-006, ADR-019    |
| Tests                          | Vitest                         | 4.x                | ADR-007             |
| Mock HTTP                      | MSW                            | 2.x                | ADR-007             |
| Bundler packages               | tsup                           | 8.x                | ADR-008             |
| Public site frontend           | React + Vite                   | v0.9+              | Website boundary    |
| Cloud API backend              | NestJS + Fastify               | v0.9+              | Cloud boundary      |
| Cloud auth candidate           | Better Auth spike              | v0.9               | Cloud boundary      |
| Container                      | Docker multi-stage             | —                  | ADR-009             |
| Registry images                | GHCR                           | —                  | ADR-009             |
| Linter                         | oxlint                         | 0.13+              | ADR-011             |
| Formatter                      | oxfmt                          | 0.x                | ADR-011             |
| Git hooks                      | lefthook                       | 1.x                | ADR-012             |
| Unused code detector           | knip                           | 5.x                | ADR-012             |
| Audit licences/deps            | `pnpm audit` + `pnpm licenses` | —                  | ADR-012             |
| SBOM                           | syft (CycloneDX)               | latest             | ADR-012             |

**Ce qui est explicitement rejeté en v0.1 :**

- **Bun** comme runtime : 90 % de compat Node mais ta cible Enterprise attend Node LTS. Bun reste un candidat pour des workers auxiliaires post-v1.0.
- **NestJS pour le bot Community v0.1** : injection de dépendances over-engineered pour cette taille de projet, ajoute une courbe d'apprentissage sans gain net. Cette décision ne s'applique pas à `apps/cloud-api`, qui a des besoins SaaS distincts.
- **Fastify / Hono custom** : Probot fait déjà le webhook handling proprement avec validation HMAC native.
- **Drizzle / Prisma** : pas de DB en v0.1, le bot est stateless.
- **Redis** : pas de cache nécessaire en v0.1.
- **BullMQ / queue** : les reviews sont synchrones jusqu'à v0.5 ; au-delà, à reconsidérer si latence devient un problème.
- **LangChain, LlamaIndex** : trop d'abstraction, surface d'attaque énorme, peu adapté à un cas d'usage aussi spécifique que la review de code.
- **npm, yarn classic** : pnpm est mieux pour workspaces et store dédupliqué.
- **ESLint, Prettier, Biome** : oxlint + oxfmt sont 10–100× plus rapides, écrits en Rust, sans plugin externe nécessaire pour le périmètre Sovri (TS/Node strict, pas de framework UI). Détails dans ADR-011.
- **Husky, simple-git-hooks** : lefthook supporte l'exécution parallèle des hooks, scoping glob natif, et a un binaire unique (pas de dépendance à Node pour s'installer). Détails dans ADR-012.
- **Next.js pour `apps/site`** : rejeté. Le site public v1.0 est un site statique marketing + pages légales ; React + Vite suffit, réduit la surface d'exécution, et évite d'introduire SSR/server actions/routing framework alors qu'aucun backend n'est requis.

---

## 3. Structure du monorepo

### 3.1 Arborescence

```
sovri/
├── package.json                       Root package, workspaces
├── pnpm-workspace.yaml                Déclaration workspaces
├── pnpm-lock.yaml                     Lockfile commité, frozen en CI
├── turbo.json                         Pipelines build/test/lint
├── tsconfig.base.json                 Config TypeScript stricte partagée
├── .nvmrc                             Node 24 pinning
├── .npmrc                             Config pnpm (auto-install-peers, etc.)
├── .gitignore
├── .gitattributes
├── README.md                          Public-facing
├── LICENSE                            Apache 2.0 pour la partie publiée
├── SECURITY.md                        Responsible disclosure policy
├── CONTRIBUTING.md                    Guide contributeurs Community
├── CODE_OF_CONDUCT.md
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                     Lint + typecheck + test + audit
│   │   ├── release.yml                Publication GHCR + npm
│   │   ├── codeql.yml                 SAST GitHub Advanced Security
│   │   └── dependency-review.yml      Review des dependencies en PR
│   ├── dependabot.yml
│   ├── CODEOWNERS
│   └── PULL_REQUEST_TEMPLATE.md
│
├── packages/
│   ├── core/                          Types, domaine pur, zéro I/O
│   ├── review-engine/                 Moteur de review
│   ├── llm-providers/                 Adapters LLM (BYOK)
│   ├── config/                        Parser .sovri.yml
│   ├── compliance/                    Mapping compliance + audit trail API
│   └── observability/                 Pino v0.1, +OTel v0.6
│
├── apps/
│   ├── community-bot/                 Apache 2.0, image Docker publique
│   ├── cloud-api/                     PRIVATE — scaffold v0.9, Cloud Beta v1.0
│   └── site/                          PRIVATE/local — React + Vite static site for sovri.eu
│
└── docs/
    ├── prd-v1.md                      Le PRD produit
    ├── ARCHI.md                       Ce document
    ├── adr/                           Architecture Decision Records
    │   ├── 001-runtime-typescript.md
    │   ├── 002-monorepo-pnpm-turborepo.md
    │   └── ...
    ├── annex-workflow.md              Détail du workflow de review
    └── annex-context-engine.md        Vision RAG long terme
```

### 3.2 pnpm workspaces

`pnpm-workspace.yaml` :

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Chaque package a son propre `package.json` avec `"type": "module"`. Les dépendances internes utilisent le protocole `workspace:` :

```json
{
  "name": "@sovri/community-bot",
  "dependencies": {
    "@sovri/review-engine": "workspace:*",
    "@sovri/llm-providers": "workspace:*"
  }
}
```

### 3.3 Turborepo

`turbo.json` minimal :

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

Cache local en dev, cache distant via Turbo Remote Cache (gratuit pour OSS) en CI.

---

## 4. Description des packages

### 4.1 `@sovri/core`

**Rôle :** Types et domaine métier purs. Aucune dépendance runtime externe sauf Zod (validation).

**Exports principaux :**

```typescript
// Types métier
export { Finding, FindingSchema, Severity, Category } from "./types/Finding";
export { ComplianceFrameworkSchema, ComplianceReferenceSchema } from "./types/Finding";
export { Review, ReviewSchema } from "./types/Review";
export { PullRequest, Diff, FileChange } from "./types/PullRequest";
export { ReviewConfig } from "./types/Config";

// Domain logic pur (testable sans I/O)
export { computeSeverityRank } from "./domain/severity";
export { groupFindingsByFile } from "./domain/grouping";
export { applyIgnoreRules } from "./domain/filtering";
```

**Pourquoi un package séparé ?** Permet à `cloud-api/` (privé) de réutiliser les mêmes types et la même logique métier sans dépendre du bot Probot. Aussi : audit Community + Cloud plus simple si les contrats sont co-localisés.

**V0.3 Compliance Trail :** `FindingSchema` porte aussi `compliance_references` et `audit_reference`. Le champ `id` reste l'identifiant technique UUID utilisé par le bot ; `audit_reference` est l'identifiant d'audit lisible au format `SOVRI-XX-HHHH-HHHH`.

**Dépendances :** `zod` uniquement.

### 4.2 `@sovri/review-engine`

**Rôle :** Le moteur central. Prend un diff et une config en entrée, retourne une `Review` complète (findings + walkthrough + métadonnées).

**Modules internes :**

```
review-engine/
├── src/
│   ├── diff/
│   │   ├── parser.ts                  Parse le diff GitHub
│   │   └── chunker.ts                 Découpe les gros diffs en chunks
│   ├── prompt/
│   │   ├── builder.ts                 Construit le prompt système + user
│   │   ├── templates.ts               Templates par mode (full, bugs-only...)
│   │   └── modes.ts                   Définitions des modes de review
│   ├── parsing/
│   │   ├── schema.ts                  Zod schema de la réponse LLM
│   │   ├── parser.ts                  Parse + valide + retry
│   │   └── retry.ts                   Stratégie de retry sur erreur schéma
│   ├── sarif/                         v0.8 (moteur ; feature productisée GA v1.0)
│   │   ├── reader.ts                  Parse + valide un rapport SARIF 2.1.0 (Zod)
│   │   ├── mapper.ts                  SARIF result → Finding + drops kind/suppression
│   │   ├── location.ts               Résolution de fichier sûre (anti path-traversal)
│   │   ├── cwe.ts                     Extraction CWE canonique
│   │   ├── caps.ts                    Bornes d'entrée + cap de findings
│   │   ├── merge.ts                   Fusionne findings SARIF + LLM (dédup)
│   │   └── ingest.ts                  Conducteur raw → findings (bornes→parse→…→cap)
│   ├── walkthrough/
│   │   ├── composer.ts                Compose le walkthrough markdown
│   │   └── inline.ts                  Génère les inline comments
│   └── orchestrator.ts                Coordination de tout le flow
```

**Contrat principal :**

```typescript
export interface ReviewEngine {
  reviewPullRequest(
    pr: PullRequest,
    diff: Diff,
    config: ReviewConfig,
    sarifReports?: SarifReport[],
  ): Promise<Review>;
}
```

**V0.3 Compliance Trail :**

- Le LLM retourne au plus un `cwe` optionnel.
- project compliance scans evaluate Framework -> Control -> Rule -> Evidence.
- project compliance scan produces ComplianceGap output.
- PR review may project relevant compliance gaps into pull request output.
- Le review engine transforme toutes ses sorties publiques en `Review` core enrichi.
- L'enrichissement compliance est déterministe via `@sovri/compliance`.
- Les `Potential compliance references` sont rendues dans le walkthrough uniquement.
- Les inline comments gardent le finding principal et portent seulement l'`audit_reference` de façon discrète.
- L'audit trail est activé uniquement par un `AuditTrailSink` injecté. Sans sink, le comportement review reste inchangé.
- `strictAudit` est un flag séparé du `review.mode`, `false` par défaut, sans effet observable tant que l'Organisational Learning n'existe pas.

**Dépendances :** `@sovri/core`, `@sovri/compliance`, `@sovri/llm-providers`, `zod`, `parse-diff`.

### 4.3 `@sovri/compliance`

**Rôle :** Mapping compliance local, enrichissement déterministe des findings, et APIs d'audit trail signé. Package Apache 2.0, auditable hors-ligne.

**Structure V0.3 :**

```
compliance/
├── src/
│   ├── index.ts
│   ├── mapping/
│   │   ├── data/                     JSON versionné, un fichier par CWE
│   │   ├── schema.ts                 Zod schema des fichiers JSON
│   │   └── enricher.ts               Finding → Finding enrichi
│   └── audit-trail/
│       ├── schema.ts                 Zod schema JSONL
│       ├── events.ts                 review.started, llm.called, etc.
│       ├── sink.ts                   AuditTrailSink interface + memory sink
│       ├── writer.ts                 file writer append-only
│       ├── signer.ts                 Ed25519 via node:crypto
│       └── verifier.ts               vérification offline
```

**Mapping :**

- Source de vérité : fichiers JSON locaux, un fichier par CWE.
- Couverture initiale : CWE Top 25 2025 + CWE-798.
- Import au build, pas de lecture disque runtime dans le chemin normal.
- Aucun appel API externe.
- Chaque référence porte `framework`, `identifier`, `description`, `source_url`, `applicability`, et `condition`.
- `applicability: confirmed` n'est jamais produit automatiquement ; l'enricher automatique retourne `applicable_if` ou `informational`.

**Audit trail :**

- Hash chain signée Ed25519, vérifiable hors-ligne.
- Clé injectée explicitement ; aucune génération ni lecture depuis l'environnement.
- `trail.started` contient la clé publique, et le verifier peut comparer à une clé attendue fournie séparément.
- Payload limité aux métadonnées et hashes : pas de prompt brut, diff brut, body complet, token, ou payload webhook.

**Exports publics V0.3 :**

```typescript
// Compliance mapping
export { enrichFindingCompliance } from "./mapping/enricher.js";
export {
  ComplianceFrameworkSchema,
  ComplianceMappingEntrySchema,
  ComplianceReferenceApplicabilitySchema,
  ComplianceReferenceEntrySchema,
  type ComplianceFramework,
  type ComplianceMappingEntry,
  type ComplianceReferenceApplicability,
  type ComplianceReferenceEntry,
} from "./mapping/schema.js";

// Audit trail
export {
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
} from "./audit-trail/schema.js";
export { type AuditTrailSink, MemoryAuditTrailSink } from "./audit-trail/sink.js";
export { verifyAuditTrail, type VerifyResult } from "./audit-trail/verifier.js";
```

`createSigner` (`./audit-trail/signer.js`) et `createFileAuditTrailWriter`
(`./audit-trail/writer.js`) restent **internes en v0.3** (wrapper Cloud uniquement,
surface d'attaque réduite) : ils ne sont pas réexportés par `index.ts`.

**Dépendances :** `@sovri/core`, `zod`, Node stdlib.

### 4.4 `@sovri/llm-providers`

**Rôle :** Adapters LLM. Définit l'interface abstraite `LLMProvider` et fournit les implémentations concrètes.

**Interface centrale :**

```typescript
export interface LLMProvider {
  readonly name: string;
  readonly maxTokens: number;

  generateStructured<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodSchema<T>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<T>;
}
```

**Implémentations v0.1 :**

- `AnthropicProvider` (Claude Sonnet 4+) — utilisé en démarrage car le plus simple à brancher.

**Implémentations v0.4 :**

- `MistralProvider` (Mistral Large 2 + Codestral) — provider recommandé par défaut pour les clients EU régulés.
- `OpenAIProvider` (GPT-5 + GPT-4.1).
- `OpenAICompatibleProvider` (Ollama, vLLM, Together, Groq, etc.).

**Dépendances par implémentation :**

- `@anthropic-ai/sdk`
- `@mistralai/mistralai` (v2, pinning exact)
- `openai`

### 4.5 `@sovri/config`

**Rôle :** Parser et validateur du fichier `.sovri.yml`. Définit le schéma, les valeurs par défaut, et la fusion avec les overrides organisationnels (Cloud).

**Exports :**

```typescript
export const SovriConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(["anthropic", "mistral", "openai", "openai-compatible"]),
    model: z.string(),
    baseUrl: z.string().url().optional(),
    apiKeySecret: z.string(),
  }),
  review: z.object({
    mode: z.enum(["full", "bugs-only", "strict", "minimal"]).default("full"),
    autoReviewDrafts: z.boolean().default(false),
    severityThreshold: z.enum(["blocker", "major", "minor"]).default("minor"),
  }),
  ignores: z.array(z.string()).default([]),
  limits: z
    .object({
      maxFilesPerReview: z.number().int().positive().default(50),
      maxLinesPerReview: z.number().int().positive().default(5000),
    })
    .default({}),
});

export type SovriConfig = z.infer<typeof SovriConfigSchema>;

export function loadConfig(repoRoot: string): Promise<SovriConfig>;
export function mergeWithOrgOverride(repo: SovriConfig, org: Partial<SovriConfig>): SovriConfig;
```

**Dépendances :** `zod`, `js-yaml`, `@sovri/core`.

### 4.6 `@sovri/observability`

**Rôle :** Setup unifié du logging (v0.1) puis du tracing/metrics (v0.6). Tous les autres packages importent leur logger depuis ici, jamais de Pino brut. Permet d'ajouter OTel à v0.6 sans toucher au code applicatif.

**Exports v0.1 :**

```typescript
export { createLogger, type Logger } from "./logger";
```

**Exports ajoutés à v0.6 :**

```typescript
export { initTelemetry, shutdownTelemetry } from "./telemetry";
export { withSpan, recordMetric } from "./tracing";
```

**Comportement v0.1 :**

- Logger Pino structuré JSON par défaut, output stdout.
- Champ `service`, `version`, `env` ajoutés automatiquement à chaque log.
- Log level configurable via `LOG_LEVEL` (info par défaut).
- Format pretty-print activable en dev via `LOG_PRETTY=true`.

**Comportement v0.6+ (ajout) :**

- Auto-instrumentation OTel pour HTTP, Octokit, fetch.
- Injection automatique du `trace_id` et `span_id` dans chaque log via `@opentelemetry/instrumentation-pino`.
- Export OTLP vers un collector configuré par `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Si pas de collector configuré, OTel reste no-op (pas d'erreur).

**Dépendances v0.1 :**

```
"pino": "^9",
"pino-pretty": "^11"     // dev dependency uniquement
```

**Dépendances ajoutées à v0.6 :**

```
"@opentelemetry/api": "^1",
"@opentelemetry/sdk-node": "^0.55",
"@opentelemetry/auto-instrumentations-node": "^0.60",
"@opentelemetry/instrumentation-pino": "^0.50",
"@opentelemetry/exporter-trace-otlp-http": "^0.55",
"@opentelemetry/resources": "^1.30",
"@opentelemetry/semantic-conventions": "^1.30"
```

---

## 5. Description de `apps/community-bot`

### 5.1 Rôle

Couche fine d'orchestration entre Probot et le `review-engine`. Ne contient aucune logique métier. Reçoit les webhooks, extrait le diff, appelle le moteur, poste les résultats sur GitHub.

### 5.2 Structure

```
apps/community-bot/
├── src/
│   ├── instrumentation.ts             Chargé en premier via --require
│   ├── server.ts                      Entry point Probot
│   ├── app.ts                         Configuration Probot
│   ├── handlers/
│   │   ├── pull-request.ts            pull_request.opened, synchronize
│   │   ├── issue-comment.ts           @sovri-bot commands
│   │   └── installation.ts            App install/uninstall
│   ├── commands/
│   │   ├── parser.ts                  Parse "@sovri-bot <command> <args>"
│   │   ├── review.ts                  @sovri-bot review
│   │   ├── resolve.ts                 @sovri-bot resolve
│   │   ├── dismiss.ts                 @sovri-bot dismiss
│   │   └── re-review.ts               @sovri-bot re-review
│   ├── github/
│   │   ├── diff-fetcher.ts            Récupère le diff via Octokit
│   │   ├── comment-poster.ts          Poste walkthrough + inline
│   │   └── sarif-fetcher.ts           Récupère SARIF depuis artifacts
│   └── types.ts
├── Dockerfile
├── package.json
└── tsconfig.json
```

### 5.3 Entry point

`src/server.ts` (v0.1) :

```typescript
import { run } from "probot";
import app from "./app.js";

run(app);
```

`package.json` (v0.1) :

```json
{
  "scripts": {
    "start": "node dist/server.js"
  }
}
```

À v0.6, l'entry point évoluera pour charger OTel en premier :

```typescript
// v0.6+ : OTel doit être initialisé avant tout autre import.
import { initTelemetry } from "@sovri/observability";
initTelemetry();

import { run } from "probot";
import app from "./app.js";

run(app);
```

Avec script Docker associé :

```json
{
  "scripts": {
    "start": "node --require @opentelemetry/auto-instrumentations-node/register dist/server.js"
  }
}
```

### 5.4 Handler webhook principal

`src/handlers/pull-request.ts` :

```typescript
import { Context } from "probot";
import { reviewEngine } from "@sovri/review-engine";
import { loadConfig } from "@sovri/config";
import { createLogger } from "@sovri/observability";
import { fetchDiff } from "../github/diff-fetcher.js";
import { postReview } from "../github/comment-poster.js";

const logger = createLogger("handler:pull-request");

export async function handlePullRequestOpened(
  context: Context<"pull_request.opened">,
): Promise<void> {
  const { pull_request: pr, repository: repo } = context.payload;

  logger.info(
    {
      pr_number: pr.number,
      repo: repo.full_name,
      author: pr.user.login,
    },
    "PR opened, starting review",
  );

  const config = await loadConfig(repo.full_name, context.octokit);
  if (!shouldReview(pr, config)) {
    logger.info("PR skipped per config");
    return;
  }

  const diff = await fetchDiff(context.octokit, repo, pr.number);
  const review = await reviewEngine.reviewPullRequest(pr, diff, config);
  await postReview(context.octokit, repo, pr.number, review);

  logger.info({ findings_count: review.findings.length }, "Review posted");
}
```

### 5.5 Workflow d'exécution complet

```
1. GitHub envoie webhook pull_request.opened
2. Probot vérifie signature HMAC (automatique)
3. handlePullRequestOpened démarre (v0.6+ : dans un span OTel)
4. Chargement config :
   - lecture .sovri.yml du repo via Octokit
   - validation Zod
   - merge avec org override (Cloud uniquement)
5. Filtre :
   - PR draft ignorée si autoReviewDrafts=false
   - PR > limits.maxFilesPerReview ignorée avec commentaire
6. Récupération du diff :
   - GET /repos/{owner}/{repo}/pulls/{pr}/files
   - Reconstruction du diff unifié
7. (v1.0) Récupération SARIF :
   - List artifacts du dernier workflow run
   - Téléchargement si présent et < N MB
   - Parsing + validation Zod
8. Construction du prompt :
   - Template système selon mode (full, bugs-only, strict)
   - Injection des diffs file par file
   - (v1.0) Injection des findings SARIF en contexte
9. Appel LLM :
   - Provider sélectionné par config.llm.provider
   - response_format: json_schema avec schéma Findings
   - Timeout 60s
   - Retry exponentiel (3 tentatives) sur 429/503
10. Parsing réponse :
    - Validation Zod
    - Si schéma invalide : retry avec prompt correctif (1 fois)
    - Si toujours invalide : log error + finding "review_failed"
11. Post-traitement :
    - applyIgnoreRules(findings, config.ignores)
    - filterBySeverity(findings, config.severityThreshold)
    - groupFindingsByFile(findings)
12. Composition walkthrough :
    - markdown structuré : summary, findings par sévérité, file-by-file
    - Inline comments via GitHub Review API
13. Posting :
    - POST /repos/{owner}/{repo}/pulls/{pr}/reviews avec event="COMMENT"
    - Inline comments rattachés au commit SHA cible
14. Logging final :
    - log Pino structuré : durée totale, tokens consommés, findings_count par sévérité
    - v0.6+ : span OTel fermé avec status OK ou ERROR
```

---

## 6. Contrats Zod — Données métier

### 6.1 Finding

```typescript
// packages/core/src/types/Finding.ts
import { z } from "zod";

export const SeveritySchema = z.enum([
  "blocker", // Bloque le merge — bug confirmé, faille sécurité
  "major", // Devrait être corrigé — bug probable, mauvaise pratique grave
  "minor", // À considérer — amélioration substantielle
  "info", // Note informative — bonne pratique non bloquante
  "nitpick", // Détail de style — peut être ignoré
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const CategorySchema = z.enum(["bug", "security"]);
export type Category = z.infer<typeof CategorySchema>;

export const ComplianceFrameworkSchema = z.enum([
  "CWE",
  "OWASP-TOP10-2021",
  "ISO27001-2022",
  "GDPR",
  "DORA",
  "NIS2",
  "AI-ACT",
  "CRA",
]);
export type ComplianceFramework = z.infer<typeof ComplianceFrameworkSchema>;

export const ComplianceReferenceSchema = z
  .object({
    framework: ComplianceFrameworkSchema,
    identifier: z.string().min(1),
    description: z.string().min(1),
    source_url: z.string().url(),
    applicability: z.enum(["applicable_if", "informational"]),
    condition: z.string().min(1).optional(),
  })
  .superRefine((reference, context) => {
    if (reference.applicability === "applicable_if" && reference.condition === undefined) {
      context.addIssue({
        code: "custom",
        path: ["condition"],
        message: "condition is required when applicability is applicable_if",
      });
    }
  });
export type ComplianceReference = z.infer<typeof ComplianceReferenceSchema>;

export const FindingSchema = z.object({
  id: z.string().uuid(),
  audit_reference: z
    .string()
    .regex(/^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/)
    .optional(),
  severity: SeveritySchema,
  category: CategorySchema,
  file: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  recommendation: z.string().min(1).max(1000),
  suggestion: z
    .object({
      code: z.string(),
      committable: z.boolean(),
    })
    .optional(),
  source: z.enum(["llm", "sarif"]),
  confidence: z.number().min(0).max(1),
  cwe: z
    .string()
    .regex(/^CWE-\d+$/)
    .optional(), // pour findings SARIF security
  compliance_references: z.array(ComplianceReferenceSchema).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;
```

`audit_reference` est optionnel au niveau du parsing core pour préserver la compatibilité avec des fixtures et objets legacy. Toute sortie produite par `@sovri/review-engine` en v0.3 doit toutefois le renseigner.

### 6.2 Review

```typescript
// packages/core/src/types/Review.ts
import { z } from "zod";
import { FindingSchema } from "./Finding";

export const ReviewSchema = z.object({
  id: z.string().uuid(),
  pr_number: z.number().int().positive(),
  repo_full_name: z.string(),
  commit_sha: z.string().length(40),
  started_at: z.date(),
  completed_at: z.date(),
  llm_provider: z.string(),
  llm_model: z.string(),
  tokens_used: z.object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
  }),
  summary: z.string(),
  findings: z.array(FindingSchema),
  walkthrough_markdown: z.string(),
  status: z.enum(["success", "partial", "failed"]),
  error: z.string().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;
```

### 6.3 Réponse LLM brute (schéma de parsing strict)

Le LLM ne retourne **jamais** directement une `Review`. Il retourne un objet plus simple validé strictement :

```typescript
// packages/review-engine/src/parsing/schema.ts
import { CategorySchema, SeveritySchema } from "@sovri/core";
import { z } from "zod";

export const LLMRawFindingSchema = z.strictObject({
  severity: SeveritySchema,
  category: CategorySchema,
  file: z.string(),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  title: z.string().max(200),
  body: z.string().max(2000),
  recommendation: z.string().min(1).max(1000),
  suggested_code: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(1),
  cwe: z
    .string()
    .regex(/^CWE-\d{1,7}$/)
    .optional(),
});

export const LLMResponseSchema = z.object({
  summary: z.string().max(2000),
  findings: z.array(LLMRawFindingSchema).max(100),
  walkthrough_markdown: z.string().optional(),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;
```

L'engine convertit les `LLMRawFinding` en `Finding` en ajoutant `id` (uuid v4), `audit_reference`, `source: 'llm'`, `compliance_references`, et `suggestion.committable` calculé à partir d'heuristiques (single-line replacement, etc.). Le LLM ne fournit jamais directement les références compliance.

---

## 7. Stratégie de tests

### 7.1 Pyramide

```
        ┌──────────────────┐
        │   E2E (3-5)      │  ← v0.5+, smee-client + repo de test
        └──────────────────┘
       ┌────────────────────┐
       │ Integration (~20)  │  ← MSW mock GitHub + LLM
       └────────────────────┘
      ┌──────────────────────┐
      │   Unit (>150)        │  ← Vitest, packages purs
      └──────────────────────┘
```

### 7.2 Unit tests

Chaque package a son `src/**/*.test.ts` colocalisé. Exigence : couverture minimale 70 % sur `core`, `review-engine`, `config`.

```typescript
// packages/review-engine/src/diff/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseDiff } from "./parser";

describe("parseDiff", () => {
  it("parses a simple addition", () => {
    const input = `diff --git a/foo.ts b/foo.ts
@@ -1,3 +1,4 @@
 line 1
+line 2 added
 line 3`;
    const result = parseDiff(input);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].additions).toBe(1);
  });
});
```

### 7.3 Integration tests avec MSW

MSW intercepte tous les appels HTTP, retourne des fixtures. Aucun réseau ne sort des tests.

```typescript
// apps/community-bot/test/integration/pull-request.test.ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { beforeAll, afterAll, it, expect } from "vitest";
import githubPRFixture from "./fixtures/pr-opened.json";
import anthropicResponseFixture from "./fixtures/anthropic-review.json";

const server = setupServer(
  http.get("https://api.github.com/repos/:owner/:repo/pulls/:n/files", () =>
    HttpResponse.json(githubPRFixture.files),
  ),
  http.post("https://api.anthropic.com/v1/messages", () =>
    HttpResponse.json(anthropicResponseFixture),
  ),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

it("produces a review for a simple PR", async () => {
  // ... simule webhook, vérifie poster appelé avec findings attendus
});
```

### 7.4 E2E tests

À partir de v0.5, repo dédié `sovri-e2e-fixtures` avec PRs préparées. Le bot Sovri tourne en local via smee-client qui forward les webhooks GitHub vers `localhost:3000`. Assertion via GitHub API que le review a été posté.

### 7.5 Tests des prompts LLM

Cas particulier : les réponses LLM sont non-déterministes. La stratégie de test est :

- **Pas de test de contenu exact** : on ne vérifie pas que le finding contient telle phrase.
- **Tests de structure** : on vérifie que le LLM retourne du JSON valide conforme au schéma Zod.
- **Tests de robustesse** : on injecte des réponses LLM corrompues (JSON invalide, schéma manquant) et on vérifie le retry + fallback.
- **Eval set manuel** : un dossier `evals/` avec 10-20 PRs réelles + golden output. Lancé en CI nightly, comparaison heuristique du nombre de findings par sévérité.

---

## 8. Déploiement et image Docker

### 8.1 Dockerfile multi-stage

```dockerfile
# syntax=docker/dockerfile:1.7

# 1. Builder
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/ packages/
COPY apps/community-bot/ apps/community-bot/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sovri/community-bot build

# 2. Production deps only
FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/community-bot/package.json apps/community-bot/

RUN pnpm install --frozen-lockfile --prod

# 3. Runtime
FROM node:24-alpine
WORKDIR /app

# Non-root user (sécurité)
RUN addgroup -g 1001 -S sovri && \
    adduser -u 1001 -S sovri -G sovri

# Copie des artefacts
COPY --from=prod-deps --chown=sovri:sovri /app/node_modules ./node_modules
COPY --from=builder --chown=sovri:sovri /app/apps/community-bot/dist ./dist
COPY --from=builder --chown=sovri:sovri /app/packages ./packages

USER sovri

ENV NODE_ENV=production
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# v0.1 : CMD simple
CMD ["node", "dist/server.js"]

# v0.5+ : remplacer par
# CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/server.js"]
```

### 8.2 Variables d'environnement Community

```bash
# GitHub App (obligatoires)
APP_ID=12345
PRIVATE_KEY=<pem content>
WEBHOOK_SECRET=<secret>

# LLM provider (au moins un)
ANTHROPIC_API_KEY=sk-ant-...
MISTRAL_API_KEY=...
OPENAI_API_KEY=...

# Logging
LOG_LEVEL=info                       # debug | info | warn | error
LOG_PRETTY=false                     # true en dev pour pretty-print

# Observability OTel (v0.6+, ignoré en v0.1)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=sovri-community-bot
OTEL_SERVICE_VERSION=0.5.0

# Behavior
PORT=3000
NODE_ENV=production
```

### 8.3 Registry et tagging

Images publiées sur `ghcr.io/sovri/community-bot` avec les tags :

- `latest` — dernière release stable
- `vX.Y.Z` — version SemVer
- `vX.Y` — alias minor le plus récent
- `vX` — alias major le plus récent
- `sha-<commit>` — pour debug

Signature des images via Sigstore/cosign à partir de v0.6.

---

## 9. Sécurité supply chain — Critique pour la cible Enterprise

### 9.1 Contexte 2026

Le 11 mai 2026, l'attaque mini-shai-hulud a compromis simultanément `@tanstack/react-router`, `@mistralai/mistralai`, `@opensearch-project/opensearch`, `@uipath/robot` et plus de 170 packages npm. Source : safedep.io, StepSecurity, Socket.

Pour Sovri qui vise les RSSI/DPO de banques et secteur santé, la sécurité supply chain est **un argument de vente direct**, pas juste une bonne pratique technique.

### 9.2 Mesures non-négociables

**Lockfile et versions :**

- `pnpm install --frozen-lockfile` partout en CI et en build Docker
- Pinning exact (sans `^` ni `~`) pour les SDK LLM et toute dépendance traitant des données sensibles
- Lockfile committé et reviewé en PR

```json
// package.json — exemple
{
  "dependencies": {
    "@anthropic-ai/sdk": "0.39.0",
    "@mistralai/mistralai": "2.1.4",
    "openai": "5.3.2"
  }
}
```

**Scans automatiques :**

- `pnpm audit` en CI sur chaque PR — échec si vuln critique/high
- GitHub Dependabot configuré, alertes sur CVE
- CodeQL activé (gratuit pour OSS)
- Socket.dev recommandé sur le repo (gratuit pour OSS)

**Postinstall scripts :**

- Ajout dans `.npmrc` : `ignore-scripts=true` par défaut
- Liste blanche explicite des packages autorisés à exécuter des scripts post-install
- Si un attaquant compromet un package, ses scripts ne tournent pas

**SBOM :**

- Génération automatique du SBOM en CycloneDX à chaque release via `@cyclonedx/cyclonedx-npm`
- Publié comme artifact de release GitHub
- Inclus dans l'image Docker à `/sovri-sbom.json`

**Signature et provenance :**

- À partir de v0.6 : signature des images Docker avec cosign (keyless OIDC) + attestation SLSA
- À partir de v1.0 : npm provenance pour les packages publiés

### 9.3 Argument commercial

Cette section, mise en avant dans la doc Sovri, est un avantage concurrentiel direct. Aucun concurrent AI code review (CodeRabbit, Qodo, CodeAnt) ne communique sur sa sécurité supply chain. Pour un DPO de banque, c'est l'un des premiers points qu'il regardera lors d'une revue de risque éditeur.

---

## 10. Logging (v0.1) et observability (v0.6+)

### 10.1 Logging Pino — v0.1

En v0.1, seul Pino est utilisé. Logs structurés JSON sur stdout, capture par n'importe quel runtime container (Docker, Kubernetes, OVHcloud).

`packages/observability/src/logger.ts` (v0.1) :

```typescript
import { pino } from "pino";

const isPretty = process.env.LOG_PRETTY === "true";
const level = process.env.LOG_LEVEL ?? "info";

const rootLogger = pino({
  level,
  base: {
    service: process.env.SERVICE_NAME ?? "sovri-community-bot",
    version: process.env.SERVICE_VERSION ?? "0.0.0",
    env: process.env.NODE_ENV ?? "development",
  },
  transport: isPretty ? { target: "pino-pretty", options: { colorize: true } } : undefined,
});

export type Logger = pino.Logger;

export function createLogger(name: string): Logger {
  return rootLogger.child({ component: name });
}
```

Utilisation dans les autres packages :

```typescript
import { createLogger } from "@sovri/observability";

const logger = createLogger("review-engine.orchestrator");

logger.info({ pr_number: 42, repo: "foo/bar" }, "Starting review");
logger.error({ err, pr_number: 42 }, "LLM call failed");
```

### 10.2 OpenTelemetry — ajout v0.6+

À partir de v0.6, OTel est ajouté au package `observability` sans casser l'API publique (cf. ADR-019, qui révise le calendrier d'ADR-006). Le code applicatif n'est pas modifié — seuls `instrumentation.ts` et `telemetry.ts` sont ajoutés.

#### 10.2.1 Initialisation OTel

`packages/observability/src/telemetry.ts` (v0.6) :

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;

export function initTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // Pas de collector → OTel no-op, on n'initialise pas
    return;
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "sovri-community-bot",
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? "0.0.0",
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
      new PinoInstrumentation({
        disableLogSending: false,
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
```

#### 10.2.2 Spans métier explicites

Pour les opérations métier importantes, span manuel :

```typescript
// packages/review-engine/src/orchestrator.ts (v0.6+)
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('sovri.review-engine');

export async function reviewPullRequest(...): Promise<Review> {
  return tracer.startActiveSpan('review.pull_request', async (span) => {
    span.setAttribute('pr.number', pr.number);
    span.setAttribute('pr.repo', repo.full_name);
    span.setAttribute('llm.provider', config.llm.provider);

    try {
      const diff = await tracer.startActiveSpan('review.fetch_diff', () => fetchDiff(...));
      const prompt = await tracer.startActiveSpan('review.build_prompt', () => buildPrompt(...));
      const response = await tracer.startActiveSpan('review.llm_call', () => callLLM(...));
      const findings = await tracer.startActiveSpan('review.parse_findings', () => parseFindings(...));

      span.setAttribute('findings.count', findings.length);
      return { ... };
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

#### 10.2.3 Métriques clés

Métriques exportées via OTel (à partir de v0.6) :

- `sovri.reviews.total` (counter, tags: status, llm_provider)
- `sovri.reviews.duration_ms` (histogram, tags: llm_provider)
- `sovri.findings.total` (counter, tags: severity, category, source)
- `sovri.llm.tokens` (counter, tags: provider, model, direction=prompt|completion)
- `sovri.llm.errors` (counter, tags: provider, error_type)

#### 10.2.4 Stack d'observability recommandée pour clients self-host

Sovri n'embarque aucun backend d'observability. À partir de v0.6, on documente trois stacks recommandées :

1. **Grafana Cloud Free** — collector OTel hébergé, gratuit jusqu'à 50 GB/mois, simple à brancher.
2. **Self-hosted Grafana + Tempo + Loki + Prometheus** — pour les clients qui veulent tout chez eux.
3. **SigNoz self-hosted** — alternative tout-en-un.

#### 10.2.5 Telemetry redaction guard (v0.6)

A single guard in `@sovri/observability` (`src/redaction.ts`) gates every span attribute and metric
tag at the `withSpan` / `recordMetric` choke point, so no producer can leak a secret into telemetry.

- **Allowlist (`ALLOWED_TELEMETRY_KEYS`).** Permitted keys are exactly: the §10.2.2 span attributes
  (`pr.number`, `pr.repo`, `llm.provider`, `findings.count`); the non-sensitive operational span
  attributes the review-engine already carries (`changed_files` and `reviewable_files` on
  `review.fetch_diff`, `provider.model` on `review.llm_call`); and the §10.2.3 metric tags (`status`,
  `llm_provider`, `severity`, `category`, `source`, `provider`, `model`, `direction`, `error_type`).
  Any other key is dropped. Adding an attribute or tag means extending this allowlist (one Zod enum,
  the type derived via `z.infer`) — never an ad-hoc bypass.
- **Secret censoring.** A scalar value matching a GitHub-token (`ghp_`/`ghs_`/`github_pat_`), LLM-key
  (`sk-`), PEM private-key, or webhook-payload JSON pattern is replaced with `[Redacted]` — the same
  censor token as the Pino `REDACT_PATHS`. Detection is shape-anchored, so a benign value that merely
  contains a token-like substring is kept. Only `string | number | boolean` values pass.
- **Correlation stays in logs.** `delivery_id` is a log-context field, never a span attribute, so it
  is absent from the allowlist and dropped from any span or metric.

---

## 11. Roadmap technique alignée sur la roadmap produit

### v0.1 — Walking skeleton (6–8 semaines)

**Objectif :** prouver le flow complet sur un repo de test.

- Monorepo + Turborepo + pnpm en place
- Package `core` avec types et schémas Zod
- Package `review-engine` minimal (diff parsing, prompt simple, parsing)
- Package `llm-providers` avec Anthropic uniquement
- Package `config` avec chargement `.sovri.yml` basique
- Package `observability` **avec Pino seul** (logs structurés JSON)
- App `community-bot` avec Probot, 1 handler `pull_request.opened`
- Inline comments + walkthrough markdown
- Image Docker buildable et runnable
- Tests unitaires sur `core` et `review-engine`
- CI GitHub Actions (lint + typecheck + test + audit)
- README + LICENSE Apache 2.0 sur ce qui sera publié

**Non-objectifs v0.1 :** SARIF, commands `@sovri-bot`, plusieurs providers LLM, suggestions committables, re-review, multi-tenant, **OTel traces/metrics**.

### v0.2 — Compliance package scaffold (livré)

**Objectif :** poser la fondation `@sovri/compliance` et durcir le marquage `dismiss` avant le pivot Compliance Trail de v0.3.

- Scaffold du package `@sovri/compliance` (metadata ESM, tsup, seuils Vitest).
- Schéma d'entrée de mapping compliance + loader statique du mapping CWE, données initiales CWE-798.
- Documentation de référence publique `.sovri.yml`.
- Sécurité : marquage `dismiss-finding` restreint aux commentaires émis par le bot, avec corrections et tests associés.

### v0.3 — Compliance Trail foundation

**Objectif :** intégrer le pivot Compliance Trail sans nouvelle infrastructure runtime.

- Nouveau package `@sovri/compliance`.
- Mapping CWE local en JSON versionné, un fichier par CWE, importé au build.
- Couverture initiale : CWE Top 25 2025 + CWE-798.
- Enrichissement déterministe `Finding.cwe` → `Finding.compliance_references`.
- Aucun appel API externe pour récupérer le mapping.
- `Finding.audit_reference` au format `SOVRI-XX-HHHH-HHHH`.
- Tous les entrypoints publics du review engine retournent un `Review` core enrichi.
- `AuditTrailSink` injecté, sink mémoire, file writer JSONL, signer Ed25519, verifier API.
- Hash chain signée pour rendre modification, suppression et réordonnancement détectables.
- Pas de CLI `sovri verify` en v0.3 (livré en v0.8).
- Organisational Learning limité à un placeholder documentaire.

**Non-objectifs v0.3 :** API externe de mapping, stockage des décisions accept/dismiss, learning runtime, Cloud dashboard, SSO/SAML.

### v0.4 — Resolve workflow and release hardening (completed)

**Objectif :** stabiliser le workflow de review existant avant d'ouvrir Community aux early adopters self-host.

- Handler `@sovri-bot resolve <findingId>` dédié.
- Routage des issue comments `resolve` depuis le dispatcher GitHub.
- Autorisation limitée à l'auteur de la PR.
- Résolution du thread actif/non résolu plutôt que du premier marker historique.
- Réactions d'acquittement idempotentes.
- Threads résolus exclus de la réconciliation des findings actifs.
- Logs d'échec de review enrichis par stage, provider/model, usage tokens et identifiants techniques non sensibles.
- Redaction des erreurs pour éviter les tokens, clés et payloads webhook bruts.
- Helpers GitHub partagés entre handlers de commandes.
- Release `v0.4.0` publiée avec image GHCR multi-arch, SBOM CycloneDX et GitHub Release.

**Non-objectifs de ce jalon v0.4 :** OTel et `/metrics` (→ v0.6), design system public (→ v0.5), dashboard Cloud, stockage permanent.

### v0.4 — Community BYOK complète

**Objectif :** produit Community utilisable en self-host par des early adopters.

- Tous les providers LLM (Mistral, OpenAI, OpenAI-compatible)
- Schéma `.sovri.yml` complet avec validation
- Commandes `@sovri-bot` restantes (`dismiss`, `re-review`) et polish de `resolve`
- Suggestions committables côté GitHub
- Modes de review (full, bugs-only, strict, minimal)
- Tests d'intégration MSW complets
- Documentation Community sur `sovri.eu/docs`
- Image Docker publiée sur GHCR `latest` + `v0.4.0`

Résidus de productization sortis de ce jalon : OTel + `/metrics` → v0.6 (cf. ADR-019) ; consommation SARIF → v1.0.

**Go/No-Go en fin de v0.4 :** décision sur le démarrage de `cloud-api/` selon les retours prospection (cf. PRD section 14).

### v0.5 — Public design implementation (prochain sprint, 2–3 semaines)

**Objectif :** codifier la direction visuelle validée en design system et l'appliquer à la surface de review du bot. La page publique `sovri.eu` est déjà en ligne.

- Design system codifié dans le package `@sovri/brand` : tokens (couleur/typo/espacement), palette severity/category, light/dark (cf. ADR-015).
- Assets de marque : shield, wordmark `Sov[r]i`, sceau EU en SVG.
- Rendu de review du bot aligné sur la direction visuelle : bandeau verdict, badges severity/category, bloc d'évaluation, inline findings, bloc compliance + provenance, statut Checks — en Markdown GitHub (ADR-016), provenance optionnelle (ADR-017), Checks API (ADR-018).
- Harness de snapshot clair/sombre (`gh-chrome.css` en preview local, jamais livré à GitHub).
- Shell documentation Community aligné avec le même vocabulaire visuel.
- Aucun dashboard Cloud, onboarding wizard, frontend applicatif, DB, cache ou queue introduit par ce jalon.

### v0.6 — Observability & supply-chain hardening (post v0.5)

**Objectif :** solder les résidus de productization de la ligne v0.4, sans toucher à la surface produit.

- **Ajout OTel** au package `observability` : auto-instrumentation HTTP/Octokit, spans métier explicites, métriques business (cf. ADR-019, révise ADR-006).
- Endpoint `/metrics` exposé (latence, coût, volume de review).
- Signature des images Docker via cosign keyless (OIDC GitHub) + attestation SLSA niveau 3.
- Logs utiles en incident, sans payload webhook brut ni contenu sensible.

### v0.7 — Compliance mapping expansion + CWE prompt (livré)

**Objectif :** étendre la couverture compliance et fiabiliser l'enrichissement CWE issu du LLM.

- Mappings compliance ajoutés par lots CWE : auth (CWE-307, CWE-521), crypto Tier-2 (CWE-327, CWE-916), resilience/logging (CWE-674, CWE-754, CWE-778, CWE-223), credential et information exposure (CWE-256, CWE-522, CWE-359, CWE-209), cleartext et weak-hash (CWE-312, CWE-319, CWE-313, CWE-328), CWE-532.
- Prompt de review enrichi : le LLM fournit un identifiant CWE (ex. `CWE-287`) et un score de confiance (0–1) sur les findings security/bug.
- Gate d'enrichissement compliance : les références ne sont émises que si finding security/bug + CWE présent + confiance ≥ 0.7 ; seuil `COMPLIANCE_MIN_CONFIDENCE` dans `@sovri/core`, allowlist explicite de catégories.

### v0.8 — Community stable : vérification compliance hors-ligne

**Objectif :** outiller la vérification hors-ligne du Compliance Trail posé en v0.3 et activer un audit trail Community en opt-in.

- CLI `sovri verify <trail.jsonl>` (package `@sovri/cli`) : vérification hors-ligne de la hash chain et des signatures Ed25519, sans dépendance réseau.
- Audit trail Community activable en opt-in : writer JSONL + signer, au-delà de la fondation exposée en API en v0.3.
- Moteur d'ingestion SARIF câblé dans le pipeline de review (`reviewPullRequest` : ingest → merge dédupliqué → walkthrough + ligne Checks `license-scan`). La feature productisée — fetch de l'artefact SARIF depuis le CI + élimination des faux-positifs par le LLM — reste GA en v1.0 (cf. §5.5).

### v0.9 — Scaffold Cloud (post Go/No-Go)

**Objectif :** poser le squelette propriétaire `apps/cloud-api` après la décision Go (fin v0.4), isolé pour ne pas alourdir v1.0.

- Bootstrap `apps/cloud-api/` (privé) : structure, header `Proprietary — Sovri SAS`, manifeste `workspace:*`, frontière de licence vérifiée par CI (ADR-010)
- Bootstrap `apps/site/` (private/local): React + Vite implementation based on the landing-page mockup as visual reference, plus draft legal routes for `/privacy`, `/terms` or `/cgu`, `/dpa`, and `/subprocessors`
- Cloud auth spike in `apps/cloud-api`: Better Auth first candidate, passwordless email, GitHub OAuth, Google OAuth, GitLab OAuth/OIDC, tenant organization membership, and NestJS/Fastify integration
- Premier appelant réel du writer d'audit trail interne (`@sovri/compliance`)
- Multi-tenancy basique (squelette) + Cloud Beta identity foundation. Enterprise SSO is OIDC/SAML; direct LDAP is excluded from public Cloud.

### v1.0 — Community stable + Cloud Beta (8–12 semaines)

**Objectif :** 3-5 clients pilotes signés sur Cloud Beta, Community en GA.

- SARIF ingestion (Semgrep, Trivy, Gitleaks)
- `apps/cloud-api/` (privé) : du scaffold v0.9 au Cloud Beta opérable
- Multi-tenancy basique côté Cloud
- Passwordless email, GitHub OAuth, and Google OAuth sign-in côté Cloud
- GitLab OAuth/OIDC sign-in if the v0.9 spike validates the provider path
- Controlled tenant-scoped OIDC/SAML SSO pilot; generic SSO hardening moves to v1.1
- Audit log structuré côté Cloud
- Dashboard admin minimal côté Cloud
- Deploy Cloud sur OVHcloud Public Cloud (Gravelines)
- Publish reviewed `sovri.eu` legal pages and stable subprocessor registry URL before first Cloud Beta signature

### v1.1 (8–12 semaines)

- GitLab self-hosted support (handler + adapter)
- Cloud GA (sortie de beta)
- Generic tenant-scoped OIDC/SAML SSO (Okta, Microsoft Entra ID, Google Workspace, Keycloak, Authentik, Zitadel)
- 10 clients payants minimum

### v1.5+

- SCIM provisioning
- Single-tenant Dedicated pour très gros clients
- Démarrage ISO 27001
- Context Engine v1 (RAG basique, cf. PRD section 12)

---

## 12. Ce qui n'est PAS dans v0.1 (rappel)

Liste des tentations qu'il faut **explicitement refuser** pour respecter le walking skeleton :

- Base de données (PostgreSQL, SQLite, etc.) — stateless en v0.1
- Cache (Redis, etc.)
- Queue (BullMQ, etc.)
- Frontend (React, etc.)
- API REST côté bot (autre que `/health` et le webhook)
- Auth utilisateur (le webhook signe via HMAC, suffisant)
- Multi-tenancy
- SSO
- Billing
- Dashboard
- **OTel traces/metrics — reporté à v0.6, seul Pino est en v0.1**
- Métriques business (DORA, etc.)
- Génération de code, docstrings, tests
- IDE plugin, Slack bot
- Multi-repo context (au-delà du repo de la PR)
- Auto-merge
- Custom LLM, fine-tuning
- RAG (même basique)

---

## 13. Architecture Decision Records (ADR)

Les décisions structurantes du projet sont documentées comme ADR (Architecture Decision Records) dans le dossier `docs/adr/`, suivant le format proposé par Michael Nygard. Voir `docs/adr/README.md` pour l'index complet et les conventions.

Chaque ADR documente le **contexte**, la **décision**, la **justification**, les **conséquences**, et les **alternatives écartées**. Un ADR une fois accepté n'est plus modifié — si la décision évolue, on crée un nouvel ADR qui supersede l'ancien.

### Index des ADR référencés depuis ce document

| N°                                                             | Titre                                                          | Référencé en section            |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| [001](./adr/001-runtime-typescript.md)                         | Node.js LTS + TypeScript strict                                | §2 toolchain                    |
| [002](./adr/002-monorepo-pnpm-turborepo.md)                    | Monorepo pnpm + Turborepo                                      | §2, §3 structure                |
| [003](./adr/003-esm-only.md)                                   | ESM uniquement, pas de CommonJS                                | §2 toolchain                    |
| [004](./adr/004-probot-framework.md)                           | Probot comme framework GitHub App                              | §2, §5 community-bot            |
| [005](./adr/005-zod-runtime-validation.md)                     | Zod 4 pour validation runtime                                  | §2, §6 contrats                 |
| [006](./adr/006-pino-then-otel.md)                             | Pino dès v0.1, OpenTelemetry à partir de v0.6 (révisé ADR-019) | §2, §4.6, §10                   |
| [007](./adr/007-vitest-msw-testing.md)                         | Vitest + MSW pour les tests                                    | §2, §7 tests                    |
| [008](./adr/008-tsup-bundler.md)                               | tsup comme bundler de packages                                 | §2 toolchain                    |
| [009](./adr/009-docker-multistage-ghcr.md)                     | Docker multi-stage + GHCR                                      | §2, §8 déploiement              |
| [010](./adr/010-licence-apache-2.md)                           | Apache 2.0 sur le code Community                               | §1.2 frontière, §9 sécurité     |
| [011](./adr/011-oxlint-oxfmt.md)                               | oxlint + oxfmt pour lint/format TS/JS                          | §2 toolchain, §15 CI, §16 hooks |
| [012](./adr/012-lefthook-ci-gates.md)                          | lefthook + GitHub Actions gates obligatoires                   | §2 toolchain, §15 CI, §16 hooks |
| [013](./adr/013-compliance-trail-as-primary-differentiator.md) | Compliance Trail comme différenciation primaire                | §1, §4.3, §11                   |
| [014](./adr/014-ed25519-hash-chain-audit-trail.md)             | Audit trail JSONL signé Ed25519 avec hash chain                | §4.3, §6, §11                   |

### Ajout d'un nouvel ADR

Quand une décision structurante doit être prise (ou révisée) après la rédaction initiale du document :

1. Créer un nouveau fichier `docs/adr/NNN-titre-en-kebab-case.md` avec le prochain numéro disponible.
2. Suivre le format des ADR existants : statut, date, contexte, décision, justification, conséquences, alternatives écartées.
3. Si l'ADR supersede un ancien, mettre à jour le statut de l'ancien à `Superseded by ADR-NNN`.
4. Mettre à jour `docs/adr/README.md` (index).
5. Si l'ADR est référencé depuis `ARCHI.md`, mettre à jour la table ci-dessus.

## 14. Risques techniques et mitigation

| Risque                                      | Probabilité | Impact   | Mitigation                                                                              |
| ------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------- |
| Dépendance npm compromise (mini-shai-hulud) | Élevée      | Critique | Section 9 : pinning, audit, SBOM, ignore-scripts                                        |
| Latence LLM > 60s sur grosses PRs           | Moyenne     | Modéré   | Chunking du diff, timeout configurable, mode async v0.5                                 |
| Réponse LLM hors schéma                     | Moyenne     | Modéré   | Validation Zod + retry avec prompt correctif                                            |
| Breaking change Probot/Octokit              | Faible      | Modéré   | Pinning version, tests d'intégration MSW                                                |
| Coût LLM explose en early adoption gratuite | Élevée      | Élevé    | Community est BYOK donc pas notre problème ; Cloud gère via tiering                     |
| OTel collector indisponible                 | Moyenne     | Faible   | Mode no-op si endpoint absent, jamais blocking                                          |
| Fork hostile de la Community                | Faible      | Modéré   | Cadence rapide + marque + relations clients (cf. PRD)                                   |
| Webhook GitHub perdu (réseau, downtime)     | Moyenne     | Faible   | GitHub retry les webhooks 3 fois ; commande `@sovri-bot review` permet retrigger manuel |

---

## 15. Pipeline CI/CD

La CI Sovri est un **prérequis non négociable**, pas un nice-to-have. Pour la cible Enterprise (banques, santé, défense), chaque gate documente une garantie auditable. Toute PR qui désactive un gate doit être justifiée par un ADR — pas par un commentaire de commit.

### 15.1 Principes directeurs

1. **Aucun bypass possible.** Branch protection rules GitHub bloquent le merge sans CI verte. `--no-verify` côté local est documenté comme interdit (`CLAUDE.md`, `CONTRIBUTING.md`).
2. **Fail-fast par job, fail-isolated par matrix.** Le job `rust-checks`-équivalent (`backend-checks`) s'arrête au premier `oxlint` failed ; mais la matrice Linux/macOS/Windows continue même si un OS échoue (`fail-fast: false`).
3. **Pas de secret en clair dans un step.** Tous les secrets sont injectés via `secrets:` GitHub. Aucun `echo $TOKEN`, aucun `env:` en clair dans le YAML.
4. **Reproductibilité.** SHA pinning des actions tierces (pas de `@v4` sans commit hash en commentaire). Versions des outils explicites (pas de `latest`).
5. **Artifacts persistants pour audit.** Coverage, SBOM, logs E2E uploadés systématiquement, conservés 90 jours minimum.

### 15.2 Workflows GitHub Actions

```
.github/workflows/
├── ci.yml                  Push main + PR : lint, typecheck, tests, audit, build matrix, scans
├── release.yml             Tag v* : build Docker multi-arch + sign cosign + publish GHCR
├── codeql.yml              SAST GitHub Advanced Security (gratuit pour OSS)
├── dependency-review.yml   Diff des dependencies en PR
├── secrets-scan.yml        TruffleHog / Gitleaks sur l'historique
└── codspeed.yml            (Optionnel v0.5+) Benchmarks continus
```

### 15.3 `ci.yml` — Pipeline détaillée

Le fichier complet est documenté en annexe `docs/annex-ci.md` (à créer en v0.1). Structure des jobs :

#### Job 1 : `backend-checks` (Linux uniquement)

Vérifie le code TypeScript des packages et apps.

```yaml
jobs:
  backend-checks:
    name: TS — oxlint + oxfmt + tsc + vitest
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc" # Node 24 pinning
          cache: pnpm
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm exec oxlint . --max-warnings=0
      - run: pnpm exec oxfmt --check .
      - run: pnpm exec tsc -b
      - run: pnpm turbo build --filter='./packages/*' --filter='./apps/*'
      - run: pnpm exec vitest run --coverage --reporter=verbose
      - name: Coverage gate — packages/core ≥ 90 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/core 90
      - name: Coverage gate — packages/review-engine ≥ 85 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/review-engine 85
      - name: Coverage gate — packages/config ≥ 85 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/config 85
      - name: Coverage gate — apps/community-bot ≥ 70 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json apps/community-bot 70
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ts-coverage
          path: coverage/
```

#### Job 2 : `knip`

Détecte exports, fichiers et deps inutilisés.

```yaml
knip:
  name: Knip — unused exports/files/deps
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version-file: ".nvmrc", cache: pnpm }
    - run: pnpm install --frozen-lockfile --ignore-scripts
    - run: pnpm exec knip --reporter compact
```

#### Job 3 : `supply-chain`

Audit dépendances + détection licences incompatibles + SBOM en artifact.

```yaml
supply-chain:
  name: Supply chain — audit + licenses + SBOM
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version-file: ".nvmrc", cache: pnpm }
    - run: pnpm install --frozen-lockfile --ignore-scripts
    - name: pnpm audit (high+critical fail)
      run: pnpm audit --audit-level=high --ignore-registry-errors
    - name: License whitelist check
      run: node scripts/check-licenses.mjs
    - name: pnpm dedupe --check
      run: pnpm dedupe --check
    - name: Install syft
      run: |
        curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh \
          | sh -s -- -b /usr/local/bin
    - name: Generate SBOM (CycloneDX)
      run: syft scan dir:. -o cyclonedx-json=sbom.cdx.json
    - uses: actions/upload-artifact@v4
      with:
        name: sbom
        path: sbom.cdx.json
```

#### Job 4 : `secrets-scan`

Détection des fichiers et patterns sensibles dans le repo et le diff.

```yaml
  secrets-scan:
    name: Secrets scan
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Reject secret files
        run: |
          SECRET_FILES=$(
            git ls-files \
              | grep -iE '\.(env|env\..+|pem|key|p12|pfx|secret|creds|aws|netrc)$|\.(env|secrets)/|^\.npmrc$|^\.pypirc$' \
              | grep -ivE '(^|/)\.env(\.[^/]+)?\.example$' \
              || true
          )
          if [ -n "$SECRET_FILES" ]; then
            echo "::error::Secret files in repo:" && echo "$SECRET_FILES" && exit 1
          fi
      - name: Reject API key patterns in diff
        run: |
          PATTERNS='AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20}'
          MATCHES=$(git grep -nE "$PATTERNS" -- ':(exclude)pnpm-lock.yaml' ':(exclude)package.json' || true)
          if [ -n "$MATCHES" ]; then
            echo "::error::API key pattern detected:" && echo "$MATCHES" | head -10 && exit 1
          fi
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

#### Job 5 : `forbidden-tools`

Refuse les outils interdits par les ADRs (npm, yarn, ESLint, Prettier, Biome).

```yaml
forbidden-tools:
  name: Forbidden tools
  runs-on: ubuntu-latest
  timeout-minutes: 3
  steps:
    - uses: actions/checkout@v4
    - name: Reject package-lock.json / yarn.lock / bun.lockb
      run: |
        if [ -f package-lock.json ] || [ -f yarn.lock ] || [ -f bun.lockb ]; then
          echo "::error::Forbidden lockfile detected. Sovri uses pnpm only." && exit 1
        fi
    - name: Reject ESLint / Prettier / Biome configs
      run: |
        FORBIDDEN=$(ls -1 .eslintrc* biome.json* .prettierrc* .prettier.* 2>/dev/null || true)
        if [ -n "$FORBIDDEN" ]; then
          echo "::error::Forbidden lint/format configs:" && echo "$FORBIDDEN" && exit 1
        fi
    - name: Reject @ts-ignore / @ts-expect-error / oxlint-disable / any
      run: |
        BAD=$(git grep -nE '@ts-ignore|@ts-expect-error|oxlint-disable|: any\b|as any\b' \
          -- '*.ts' '*.tsx' ':(exclude)*.test.ts' ':(exclude)*.spec.ts' | head -20 || true)
        if [ -n "$BAD" ]; then
          echo "::error::Error suppression / any usage detected:" && echo "$BAD" && exit 1
        fi
    - name: Reject CommonJS (require / module.exports)
      run: |
        BAD=$(git grep -nE 'require\(|module\.exports' -- '*.ts' '*.tsx' \
          ':(exclude)*.config.*' ':(exclude)*.test.ts' | head -20 || true)
        if [ -n "$BAD" ]; then
          echo "::error::CommonJS detected (ADR-003 ESM only):" && echo "$BAD" && exit 1
        fi
```

#### Job 6 : `forbidden-imports`

Vérifie la frontière Community / Cloud (ADR-010) : aucun import de `apps/cloud-api/` ne doit apparaître dans `packages/` ou `apps/community-bot/`.

```yaml
forbidden-imports:
  name: Community/Cloud boundary
  runs-on: ubuntu-latest
  timeout-minutes: 3
  steps:
    - uses: actions/checkout@v4
    - name: Reject Cloud imports from Community/packages
      run: |
        BAD=$(grep -rnE "from ['\"]@sovri/cloud" packages/ apps/community-bot/ 2>/dev/null || true)
        BAD2=$(grep -rnE "from ['\"]\\.\\./.*cloud-api" packages/ apps/community-bot/ 2>/dev/null || true)
        if [ -n "$BAD" ] || [ -n "$BAD2" ]; then
          echo "::error::Cloud import in public surface (ADR-010 boundary breach):"
          [ -n "$BAD" ] && echo "$BAD"
          [ -n "$BAD2" ] && echo "$BAD2"
          exit 1
        fi
```

#### Job 7 : `build-docker`

Build matrix multi-arch (linux/amd64, linux/arm64) avec Buildx. Pousse uniquement sur release ; en PR, seul le build est validé.

```yaml
build-docker:
  name: Docker build (community-bot)
  needs: [backend-checks, supply-chain, secrets-scan, forbidden-tools, forbidden-imports]
  runs-on: ubuntu-latest
  timeout-minutes: 20
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4
    - uses: docker/setup-qemu-action@v3
    - uses: docker/setup-buildx-action@v3
    - name: Build (no push in PR)
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/community-bot/Dockerfile
        platforms: linux/amd64,linux/arm64
        push: false
        load: false
        cache-from: type=gha
        cache-to: type=gha,mode=max
        tags: sovri/community-bot:ci-${{ github.sha }}
    - name: Trivy scan image
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: sovri/community-bot:ci-${{ github.sha }}
        format: sarif
        output: trivy-results.sarif
        severity: HIGH,CRITICAL
        exit-code: 1
    - uses: github/codeql-action/upload-sarif@v3
      if: always()
      with: { sarif_file: trivy-results.sarif }
```

#### Job 8 : `changelog-check` (PR uniquement)

Refuse les PRs qui modifient `.ts`/`.tsx` sans entrée `CHANGELOG.md`.

```yaml
changelog-check:
  name: CHANGELOG updated
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  timeout-minutes: 2
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - name: Verify CHANGELOG.md updated when code changes
      run: |
        BASE="${{ github.event.pull_request.base.sha }}"
        HEAD="${{ github.event.pull_request.head.sha }}"
        CODE_CHANGED=$(git diff --name-only "$BASE" "$HEAD" | grep -E '\.(ts|tsx)$' || true)
        CHANGELOG_CHANGED=$(git diff --name-only "$BASE" "$HEAD" | grep -x 'CHANGELOG.md' || true)
        if [ -n "$CODE_CHANGED" ] && [ -z "$CHANGELOG_CHANGED" ]; then
          echo "::error::Code changed without a CHANGELOG.md entry"
          exit 1
        fi
```

### 15.4 `release.yml` — Publication multi-arch signée

Déclencheur : `push` d'un tag `v*` (`v0.1.0`, `v0.1.1`, …). Workflow :

1. **`verify-tag`** : vérifie que la version du tag correspond à `packages/*/package.json`, `apps/community-bot/package.json`, et à une section `## [VERSION]` dans `CHANGELOG.md`.
2. **`build-and-push`** :
   - Build Docker multi-arch (`linux/amd64`, `linux/arm64`) via Buildx
   - Push vers `ghcr.io/sovri/community-bot:vX.Y.Z`, `:vX.Y`, `:vX`, `:latest`
   - Signature cosign keyless via OIDC GitHub : `cosign sign ghcr.io/sovri/community-bot:vX.Y.Z`
   - Attestation SLSA niveau 3 via `slsa-framework/slsa-github-generator`
3. **`sbom`** : génération SBOM CycloneDX via syft, signature cosign, attachement à la GitHub Release
4. **`publish-npm`** : publication des packages `@sovri/*` sur npm avec provenance (`npm publish --provenance`) — uniquement les packages Apache 2.0 (`apps/cloud-api` exclu par construction : pas listé dans `pnpm-workspace.yaml` côté publication)
5. **`gh-release`** : crée la GitHub Release avec changelog extrait, joint SBOM + attestation SLSA

### 15.5 `codeql.yml` — SAST

GitHub Advanced Security (gratuit pour les repos OSS publics). Configuration minimale :

```yaml
name: CodeQL
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  schedule: [{ cron: "0 6 * * 1" }] # hebdo lundi 6h UTC
jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions: { actions: read, contents: read, security-events: write }
    strategy: { matrix: { language: [javascript] } }
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended,security-and-quality
      - uses: github/codeql-action/analyze@v3
```

### 15.6 `dependency-review.yml`

```yaml
name: Dependency Review
on: { pull_request: { branches: [main] } }
permissions: { contents: read }
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
          allow-licenses: Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, BlueOak-1.0.0
          deny-licenses: AGPL-1.0-only, AGPL-1.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later, GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-only, GPL-3.0-or-later, LGPL-2.0-only, LGPL-2.0-or-later, LGPL-2.1-only, LGPL-2.1-or-later, LGPL-3.0-only, LGPL-3.0-or-later
```

### 15.7 Branch protection rules (GitHub UI ou Terraform)

Sur `main` :

- Pull request requise (1 reviewer minimum, 2 pour les modifications de `packages/*` ou `apps/cloud-api/`)
- Statuts CI obligatoires : `backend-checks`, `knip`, `supply-chain`, `secrets-scan`, `forbidden-tools`, `forbidden-imports`, `build-docker`, `changelog-check`, `CodeQL`, `Dependency Review`
- Linear history obligatoire (rebase or squash, no merge commits)
- Signed commits requis
- Force push interdit
- Suppression de branche interdite
- Dismiss stale reviews on push
- Require conversation resolution before merging

### 15.8 Performance et coûts CI

| Étape                                   | Durée cible  | Notes                                                     |
| --------------------------------------- | ------------ | --------------------------------------------------------- |
| `backend-checks`                        | < 5 min      | Turbo cache distant via Vercel Remote Cache (gratuit OSS) |
| `knip`                                  | < 1 min      | —                                                         |
| `supply-chain`                          | < 3 min      | `pnpm audit` rapide, SBOM ~30s                            |
| `secrets-scan`                          | < 1 min      | —                                                         |
| `forbidden-tools` + `forbidden-imports` | < 30 s       | grep statique                                             |
| `build-docker`                          | < 10 min     | Cache GHA actif                                           |
| **Total PR**                            | **< 15 min** | Pipeline lit fail-fast sur le premier échec critique      |

CI gratuite sur les repos OSS publics GitHub. Cloud peut héberger sa propre runner sur un projet privé séparé (v1.0+) ou utiliser des runners GitHub privés.

---

## 16. Git hooks (lefthook)

ADR-012. Les hooks pre-commit / pre-push sont **obligatoires en local** ; `--no-verify` est interdit (`CLAUDE.md`). Ils dupliquent les gates CI en exécution locale rapide pour éviter le ping-pong CI.

### 16.1 `lefthook.yml`

```yaml
# lefthook.yml — Sovri Git hooks
# Docs: https://github.com/evilmartians/lefthook
# Install: pnpm exec lefthook install (or ./scripts/install-hooks.sh)
#
# If a hook blocks without a valid reason: fix the code, NEVER --no-verify.

pre-commit:
  parallel: true
  commands:
    ts-lint:
      glob: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
      run: pnpm exec oxlint --no-error-on-unmatched-pattern {staged_files}
      skip: [merge, rebase]
      fail_text: "oxlint errors. Run: pnpm exec oxlint --fix . (no oxlint-disable)"

    ts-format:
      glob: "**/*.{ts,tsx,js,jsx,mjs,cjs,css,json,md,yaml,yml}"
      run: pnpm exec oxfmt --check --no-error-on-unmatched-pattern {staged_files}
      skip: [merge, rebase]
      fail_text: "Format violation. Run: pnpm exec oxfmt ."

    ts-typecheck:
      glob: "**/*.{ts,tsx}"
      run: pnpm exec tsc -b --noEmit
      skip: [merge, rebase]
      fail_text: "tsc -b fails. Fix type errors before commit (no @ts-ignore)."

    no-secrets:
      run: ./scripts/no-secrets.sh
      fail_text: "Secret file or API key pattern detected. Remove before commit."

    no-manual-deps:
      glob: "{package.json,pnpm-workspace.yaml}"
      run: ./scripts/no-manual-deps.sh
      fail_text: "Manual dependency editing forbidden. Use: pnpm add / pnpm update / pnpm remove."

    no-forbidden-tools:
      run: ./scripts/no-forbidden-tools.sh
      fail_text: "Forbidden lockfile (package-lock.json, yarn.lock, bun.lockb) or lint config (ESLint, Prettier, Biome) detected."

    boundary-community-cloud:
      glob: "{packages/**/*.{ts,tsx},apps/community-bot/**/*.{ts,tsx}}"
      run: ./scripts/check-boundary.sh
      skip: [merge, rebase]
      fail_text: "Import from apps/cloud-api/ in public surface (ADR-010 breach)."

    changelog-updated:
      run: |
        if git diff --cached --name-only | grep -qE '\.(ts|tsx)$'; then
          if ! git diff --cached --name-only | grep -q '^CHANGELOG.md$'; then
            echo "Code modified without CHANGELOG.md entry"
            echo "Add a line to the [Unreleased] section"
            exit 1
          fi
        fi
      skip: [merge, rebase]
      fail_text: "CHANGELOG.md must be updated when code changes."

pre-push:
  parallel: true
  commands:
    ts-test:
      run: pnpm exec vitest run --passWithNoTests --reporter=default
      fail_text: "Vitest tests fail. No push until everything is green."

    ts-typecheck:
      run: pnpm exec tsc -b
      fail_text: "TypeScript type-check fails."

    audit:
      run: pnpm audit --audit-level=high --ignore-registry-errors
      fail_text: "pnpm audit detected a high or critical vulnerability."

    dedupe:
      run: pnpm dedupe --check
      fail_text: "pnpm dedupe --check failed. Run: pnpm dedupe and commit pnpm-lock.yaml."

    knip:
      run: pnpm exec knip --reporter compact
      fail_text: "knip detected unused exports/files/deps. Remove them or add explicit ignore in knip.json with rationale."

    build:
      run: pnpm turbo build --filter='./packages/*'
      fail_text: "Package build fails. Fix it before push."
```

### 16.2 `scripts/install-hooks.sh`

```bash
#!/usr/bin/env bash
# Sovri onboarding installer: git hooks + required dev tooling
# Usage: ./scripts/install-hooks.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Checking required tools"

require() {
  local name="$1" install_hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "MISSING: $name" && echo "  Install: $install_hint" && return 1
  fi
  echo "OK: $name ($(command -v "$name"))"
}

missing=0
require git "https://git-scm.com/downloads" || missing=1
require node "https://nodejs.org (use the version in .nvmrc)" || missing=1
require pnpm "corepack enable && corepack prepare pnpm@10 --activate" || missing=1

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "WARNING: Node $NODE_MAJOR detected, Sovri requires Node 24 LTS (.nvmrc)"
fi

if [ "$missing" -eq 1 ]; then
  echo "" && echo "Missing tools. Install them then re-run this script." && exit 1
fi

echo "" && echo "==> Installing dependencies (pnpm)"
pnpm install --frozen-lockfile --ignore-scripts

echo "" && echo "==> Installing lefthook hooks"
pnpm exec lefthook install

echo "" && echo "==> Verifying hooks installation"
ls -la .git/hooks/ | grep -E '(pre-commit|pre-push)' || {
  echo "ERROR: hooks not installed in .git/hooks/" && exit 1
}

echo "" && echo "==> Ready."
echo "    Pre-commit + pre-push active."
echo "    Commits without hook (--no-verify) are FORBIDDEN — fix the cause instead."
```

### 16.3 `scripts/no-secrets.sh`

```bash
#!/usr/bin/env bash
# Reject staged files likely to contain secrets.
# Invoked at pre-commit via lefthook.yml.
set -euo pipefail

# Secret-file patterns. The directory alternative is anchored to either repo
# root or a path component boundary so that `docs/secrets/overview.md` (no
# leading dot) is not flagged, while `.aws/credentials` and `apps/foo/.env`
# still are.
SECRET_PATTERNS='\.(env|env\..+|pem|key|p12|pfx|secret|creds|aws|netrc)$|(^|/)\.(env|secrets|aws)/|(^|/)\.(npmrc|pypirc)$'

STAGED=$(git diff --cached --diff-filter=d --name-only)
[ -z "$STAGED" ] && exit 0

# Filename check. `.env.example` (and `.env.<suffix>.example`) is the only
# template family whitelisted.
SECRET_FILES=$(
  printf '%s\n' "$STAGED" \
    | grep -iE "$SECRET_PATTERNS" \
    | grep -ivE '(^|/)\.env(\.[^/]+)?\.example$' \
    || true
)

if [ -n "$SECRET_FILES" ]; then
  echo "BLOCKED: files possibly containing secrets staged:"
  printf '%s\n' "$SECRET_FILES" | sed 's/^/  - /'
  echo ""
  echo "If intentional, add the file to .gitignore and use a .example variant instead."
  exit 1
fi

# Content check: grep known API key patterns in the staged diff.
# Exclude every `package.json` and `pnpm-lock.yaml` across the monorepo —
# they routinely contain long hex / sha-256 / integrity strings that collide
# with `sk-[A-Za-z0-9_-]{32,}` and similar patterns. Mirrors the CI
# `secrets-scan` job in §15.3.
# The grep is case-sensitive on purpose: the seven prefixes are canonical
# case (`AKIA`, `AIza`, `sk-ant-`, etc.), so `-iE` would create false
# positives on random uppercase/lowercase identifiers.
CONTENT_LEAK=$(git diff --cached -U0 \
    -- ':(exclude,glob)**/pnpm-lock.yaml' ':(exclude,glob)**/package.json' \
  | grep -E '^\+' \
  | grep -vE '^\+\+\+ ' \
  | grep -E \
      -e 'AKIA[0-9A-Z]{16}' \
      -e 'sk-ant-[A-Za-z0-9_-]{20,}' \
      -e 'sk-[A-Za-z0-9_-]{32,}' \
      -e 'ghp_[A-Za-z0-9]{36}' \
      -e 'github_pat_[A-Za-z0-9_]{82}' \
      -e 'glpat-[A-Za-z0-9_-]{20}' \
      -e 'AIza[0-9A-Za-z_-]{35}' \
  || true)

if [ -n "$CONTENT_LEAK" ]; then
  echo "BLOCKED: API key pattern detected in diff:"
  printf '%s\n' "$CONTENT_LEAK" | head -5
  echo ""
  echo "Remove the key and revoke it immediately if it has been committed even locally."
  exit 1
fi

exit 0
```

### 16.4 `scripts/no-manual-deps.sh`

```bash
#!/usr/bin/env bash
# Reject manual edits to package.json without a synced pnpm-lock.yaml.
# Forces use of `pnpm add`, `pnpm update`, `pnpm remove`.
# Invoked at pre-commit via lefthook.yml.
set -euo pipefail

STAGED=$(git diff --cached --name-only)
[ -z "$STAGED" ] && exit 0

# If any package.json is staged, require pnpm-lock.yaml staged too whenever any
# of the four dependency blocks (`dependencies`, `devDependencies`,
# `peerDependencies`, `optionalDependencies`) differ between HEAD and the index.
# Edits to other fields (`scripts`, `name`, `version`, ...) pass through.
if echo "$STAGED" | grep -qE '(^|/)package\.json$'; then
  PKG_DEP_CHANGED=$(node -e '
    const cp = require("child_process");
    const files = cp.execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" })
      .split("\n").filter(f => f === "package.json" || f.endsWith("/package.json"));
    const readDeps = (ref, file) => {
      try {
        const raw = cp.execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const pkg = JSON.parse(raw);
        return {
          dependencies: pkg.dependencies || {},
          devDependencies: pkg.devDependencies || {},
          peerDependencies: pkg.peerDependencies || {},
          optionalDependencies: pkg.optionalDependencies || {},
        };
      } catch { return { dependencies: {}, devDependencies: {}, peerDependencies: {}, optionalDependencies: {} }; }
    };
    const canon = (deps) => JSON.stringify(Object.fromEntries(
      Object.entries(deps).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort())])
    ));
    let changed = false;
    for (const file of files) {
      const head = canon(readDeps("HEAD", file));
      const idx  = canon(readDeps("", file));
      if (head !== idx) { changed = true; break; }
    }
    process.stdout.write(changed ? "yes" : "no");
  ' 2>/dev/null || echo "yes")

  if [ "$PKG_DEP_CHANGED" = "yes" ]; then
    if ! echo "$STAGED" | grep -qE '(^|/)pnpm-lock\.yaml$'; then
      echo "BLOCKED: package.json dependency block changed without an updated pnpm-lock.yaml."
      echo ""
      echo "Correct procedure:"
      echo "  pnpm add <package>            # runtime dependency"
      echo "  pnpm add -D <package>         # devDependency"
      echo "  pnpm update <package>         # bump existing dep"
      echo "  pnpm remove <package>         # delete a dep"
      echo ""
      echo "These update pnpm-lock.yaml automatically. Stage both files together."
      echo "npm install / yarn add / bun add forbidden — pnpm only."
      exit 1
    fi
  fi

  # Reject npm/yarn/bun lock files staged alongside package.json edits.
  # Standalone foreign-lockfile commits are caught by scripts/no-forbidden-tools.sh.
  if echo "$STAGED" | grep -qE '(^|/)(package-lock\.json|yarn\.lock|bun\.lockb)$'; then
    echo "BLOCKED: package-lock.json, yarn.lock, or bun.lockb detected."
    echo "Sovri uses pnpm exclusively. Remove this lock file and use pnpm-lock.yaml."
    exit 1
  fi
fi

exit 0
```

### 16.5 `scripts/no-forbidden-tools.sh`

```bash
#!/usr/bin/env bash
# Reject forbidden lockfiles and lint/format configs in the staging area.
set -euo pipefail

STAGED=$(git diff --cached --name-only)
[ -z "$STAGED" ] && exit 0

FORBIDDEN_LOCKS=$(echo "$STAGED" | grep -E '^(package-lock\.json|yarn\.lock|bun\.lockb)$' || true)
if [ -n "$FORBIDDEN_LOCKS" ]; then
  echo "BLOCKED: Forbidden lockfile staged:" && echo "$FORBIDDEN_LOCKS" && exit 1
fi

FORBIDDEN_CONFIGS=$(echo "$STAGED" | grep -E '(\.eslintrc.*|biome\.json.*|\.prettierrc.*|\.prettier\..*)' || true)
if [ -n "$FORBIDDEN_CONFIGS" ]; then
  echo "BLOCKED: Forbidden lint/format config staged:"
  echo "$FORBIDDEN_CONFIGS"
  echo "Sovri uses oxlint + oxfmt only (ADR-011)."
  exit 1
fi

exit 0
```

### 16.6 `scripts/check-boundary.sh`

```bash
#!/usr/bin/env bash
# Verify no import from apps/cloud-api/ leaks into packages/ or apps/community-bot/.
# Enforces ADR-010 Community/Cloud boundary.
set -euo pipefail

STAGED=$(git diff --cached --diff-filter=d --name-only \
  | grep -E '^(packages/|apps/community-bot/).*\.(ts|tsx)$' || true)
[ -z "$STAGED" ] && exit 0

BAD=""
while IFS= read -r file; do
  [ -f "$file" ] || continue
  if grep -nE "from ['\"](\\@sovri/cloud|.*cloud-api)" "$file"; then
    BAD="$BAD\n$file"
  fi
done <<< "$STAGED"

if [ -n "$BAD" ]; then
  echo "BLOCKED: Cloud import in public surface (ADR-010 boundary breach):"
  echo -e "$BAD"
  echo ""
  echo "packages/ and apps/community-bot/ MUST NOT import from apps/cloud-api/."
  exit 1
fi

exit 0
```

### 16.7 Justification de la pré-push lourde

`pre-push` exécute tests + typecheck + audit + knip + build. Ça prend ~30 s à 2 min en cache chaud. La justification :

- **Cible Enterprise** : un push qui passerait localement mais casserait la CI consomme du temps reviewer + bloque la chaîne d'approbation
- **Coût asymétrique** : un échec de CI sur main bloque l'équipe entière le temps d'un revert ; un échec de pre-push bloque uniquement l'auteur
- **Cache chaud** : `tsc -b`, Turbo, Vitest cachent agressivement, les runs successifs sont rapides
- **Échappatoire documentée** : pour les cas urgents (hotfix prod), une procédure dérogatoire est documentée dans `CONTRIBUTING.md` — elle requiert l'accord d'un mainteneur et la création d'un ticket post-mortem

### 16.8 Lefthook vs alternatives

| Outil                   | Pourquoi rejeté                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **husky**               | Pas de parallélisation native, hooks shell artisanaux, configuration éparpillée dans `.husky/`                                                 |
| **simple-git-hooks**    | Pas de scoping glob, pas de parallélisation, ne supporte pas `{staged_files}` injection                                                        |
| **pre-commit (Python)** | Excellent outil, mais ajoute une dépendance Python à un projet Node-only — friction onboarding                                                 |
| **lefthook**            | **Choisi.** Binaire unique en Go, parallélisation native, scoping glob, `{staged_files}` injection, communauté active, config YAML déclarative |

---

## 17. Glossaire technique

- **BYOK** — Bring Your Own Key. Le client fournit sa propre clé API LLM ; on ne facture pas l'usage LLM.
- **SARIF** — Static Analysis Results Interchange Format (OASIS standard). Format JSON d'export des findings des outils SAST.
- **OTLP** — OpenTelemetry Protocol. Protocole standard de transport des traces/metrics/logs.
- **ADR** — Architecture Decision Record. Document court (5-10 lignes) traçant une décision et son contexte.
- **HMAC** — Hash-based Message Authentication Code. Mécanisme utilisé par GitHub pour signer les webhooks et permettre au receveur de vérifier l'authenticité.
- **GHCR** — GitHub Container Registry. Registry Docker hébergé par GitHub, gratuit pour OSS.
- **SBOM** — Software Bill of Materials. Inventaire des composants d'un logiciel, format CycloneDX ou SPDX.

---

_Fin du document ARCHI.md v1.0. À versionner dans `docs/ARCHI.md` du repo Sovri. Toute modification structurante doit être tracée par un nouvel ADR ou révision d'un ADR existant._
