# Sovri — PRD v1

**Périmètre :** Plateforme de revue de Pull Requests assistée par IA, positionnée sur le marché des entreprises EU francophones et germanophones soumises à des contraintes de souveraineté, de RGPD et d'AI Act. Distribution duale : édition self-host open-source (Community) et offre SaaS managée hébergée en Europe (Cloud).

**Statut :** Draft fonctionnel — hypothèse business non validée par prospection client (à faire en parallèle).

**Auteur :** Mathieu

**Version :** 1.0

**Étymologie du nom :** néologisme construit sur « souverain » et « véri[fié] ». Plante la promesse produit dans le nom même : la souveraineté du code et la vérification rigoureuse de chaque PR.

---

## 0. Note de cadrage

Sovri vise un segment de marché précis : **les entreprises EU régulées qui ne peuvent pas adopter CodeRabbit ou Qodo** pour des raisons de souveraineté, de RGPD, ou de clauses contractuelles avec leurs propres clients (banque, santé, défense, secteur public, opérateurs critiques). Pour ce segment, l'offre actuelle du marché AI code review est inadéquate : tous les acteurs majeurs sont SaaS US-centric et ne passent pas une revue DPO/RSSI sans dérogation.

Le PRD s'organise autour de trois choix structurants :

1. **Positionnement marché** : entreprises EU régulées 50–500 développeurs, pas le solo dev OSS qui ne paie pas, ni les startups tech-first qui adoptent CodeRabbit sans frottement.
2. **Distribution duale** : édition Community open-source self-host gratuite (aimant à adoption et preuve de souveraineté) + édition Cloud SaaS managée EU payante (revenu).
3. **Périmètre fonctionnel étroit** : un bot de review de PR, rien de plus. Pas de SAST propre, pas de DORA metrics, pas d'IDE, pas de génération de code. La section 2 (non-objectifs) doit être relue à chaque tentation d'ajouter une feature.

**Avertissement explicite :** l'hypothèse « les entreprises EU régulées veulent un CodeRabbit conforme RGPD et sont prêtes à payer pour » n'est **pas validée** par des conversations client à la date de rédaction. Ce PRD doit être considéré comme une base de travail conditionnée à une validation terrain de 5 à 10 entretiens DSI / Tech Lead / RSSI. Si cette validation échoue, le PRD est invalide et le projet doit être revu en mode OSS pur ou pivot services.

---

## 1. Vision et problème

### 1.1 Le marché tel qu'il est

CodeRabbit, Qodo et CodeAnt dominent le marché US/global du AI code review. CodeRabbit a passé les 40 M$ d'ARR en avril 2026 (×8 en un an), 8 000+ clients, 88 M$ levés. Qodo a 50 M$ levés, ~100 employés. Ces acteurs convergent tous vers le même modèle : SaaS centralisé hébergé sur AWS US, LLM imposé (typiquement Claude via Bedrock), facturation per-seat.

Ce modèle est **incompatible avec un sous-ensemble identifiable du marché européen** :

- **Banques et assurances** soumises à DORA (Digital Operational Resilience Act, en vigueur depuis janvier 2025), qui exigent un contrôle strict des prestataires tiers traitant du code et un droit d'audit.
- **Santé** soumise au RGPD et aux exigences HDS (Hébergeur de Données de Santé) pour tout code touchant à des systèmes contenant des données patients.
- **Secteur public et opérateurs d'importance vitale** (OIV) sous NIS2, avec exigences SecNumCloud à terme pour les briques sensibles.
- **Défense et industries duales** soumises au contrôle export et à la directive NIS2, avec interdiction de fait de faire transiter du code par des juridictions extra-EU.
- **Sous-traitants** de ces donneurs d'ordre, qui héritent des clauses contractuelles de leurs clients (DPAs, clauses Schrems II, certification ISO 27001 avec exigence de localisation EU).

Pour ce segment, adopter CodeRabbit ou Qodo demande soit une dérogation du DPO/RSSI difficile à obtenir, soit le contournement de l'outil (ce qui se produit en pratique). Le besoin d'AI code review existe ; l'offre conforme n'existe pas.

### 1.2 Vision

**Sovri est la plateforme de AI code review conçue pour les entreprises EU sous contrainte de souveraineté.** Elle se décline en deux éditions complémentaires :

- **Sovri Community** — distribution open-source, image Docker self-host, BYOK, gratuite. Sert d'aimant à adoption et de preuve de souveraineté ultime (« le code ne sort jamais de chez vous, vérifiable »).
- **Sovri Cloud** — offre SaaS hébergée en Europe (provider à confirmer : OVHcloud, Scaleway, Outscale), opérée par nous, qui ajoute SSO, multi-tenancy, audit log, support, et la conformité contractuelle dont les acheteurs entreprise ont besoin pour signer.

Les deux éditions partagent le même moteur de review. Ce qui les distingue, c'est l'hébergement, l'ergonomie d'onboarding, et les fonctionnalités enterprise.

### 1.3 Promesse en une phrase

> La plateforme de AI code review conforme RGPD, hébergée en Europe, avec le LLM de votre choix.

### 1.4 Le pari sous-jacent

Trois hypothèses portent cette vision. Si l'une tombe, le PRD doit être révisé :

1. **Hypothèse marché** : il existe en EU francophone et germanophone au moins 50–200 entreprises 10–500 développeurs qui veulent du AI code review mais sont bloquées par les contraintes de conformité sur CodeRabbit/Qodo. — _À valider en prospection._
2. **Hypothèse défensivité** : CodeRabbit et Qodo ne lanceront pas une édition EU souveraine dans les 18 mois, parce que ça impliquerait une réarchitecture coûteuse de leur stack centralisé. — _Surveillance trimestrielle de leurs annonces._
3. **Hypothèse acheteur** : les DSI/RSSI EU régulés sont prêts à payer un premium (3–5×) pour une solution conforme par rapport au prix de CodeRabbit. — _À valider en prospection._

> **Statut au 2026-06-09 (cap Go/No-Go fin v0.4)** : hypothèses 1 (marché) et 3 (acheteur) **validées** en prospection (≥3 signaux d'achat). Hypothèse 2 (défensivité) maintenue ; veille trimestrielle réactivée. Aucune hypothèse tombée → pas de révision du PRD déclenchée. Engagement Cloud : **Go**.

---

## 2. Non-objectifs (explicites, v2)

**À ne PAS faire en v1, même si la tentation est forte.** Ces non-objectifs sont rediscutés à chaque version majeure du PRD ; en cours de version ils ne bougent pas.

- **Pas de moteur SAST/secrets/IaC propre.** Sovri n'embarque pas Semgrep, Trivy, ou Gitleaks. En revanche, **Sovri peut consommer du SARIF en entrée** (v1.0) pour intégrer les findings de ces outils dans le walkthrough de review. Cette nuance par rapport à v1 est essentielle pour la cible entreprise.
- **Pas de DORA metrics ni de dashboard analytics produit en v1.0.** Réservé v2.0. Le SaaS managé aura un dashboard d'administration (utilisateurs, repos, coûts), pas un dashboard de métriques d'ingénierie.
- **Pas d'extension IDE, pas d'agent Slack en v1.** Reportés à v1.2+. La surface de revue v1 reste le bot GitHub (puis GitLab en v1.1).
- **Pas de Bitbucket, pas d'Azure DevOps.** GitHub en v1.0, GitLab self-hosted en v1.1. Les autres plateformes sont post v1.5 minimum.
- **Pas de génération de code, de docstrings, ou de tests.** Sovri _review_, il n'écrit pas.
- **Pas d'Issue Planner ni de sync Jira/Linear en v1.** CodeRabbit s'y est étendu ; ce n'est pas la bataille à mener.
- **Pas de génération d'architecture diagrams ni de sequence diagrams.** Coût en tokens élevé, valeur produit faible.
- **Pas de multi-repo context profond ni de code graph cross-repo.** Le périmètre de review v1 est le diff + les fichiers touchés + les fichiers immédiatement liés.
- **Pas de LLM propriétaire Sovri.** Décision définitive et documentée dans la section 12. Sovri reste agnostique du modèle.
- **Pas d'auto-merge ni de quality gate bloquant en v1.** Les décisions de merge restent humaines.
- **Pas de certification SOC 2, ISO 27001, ou SecNumCloud en v1.0.** Roadmap à v1.5+ selon traction commerciale. Mentionnés comme « en préparation » uniquement après démarrage formel du processus.

---

## 3. Utilisateur cible

### 3.1 Persona principal : le RSSI / Tech Lead d'entreprise EU régulée

**Profil.** Tech Lead, Head of Engineering, ou RSSI d'une entreprise de 50–500 développeurs, basée en France, Belgique, Suisse, Luxembourg, Allemagne, Autriche, ou Pays-Bas. Secteur : finance, assurance, santé, défense, secteur public, opérateurs critiques, ESN avec clients régulés.

**Contraintes structurantes.**

- Le code source ne peut pas transiter hors de l'UE sans clauses contractuelles strictes et accord du DPO.
- Tout outil traitant du code doit passer une revue sécurité (parfois 3–9 mois) avant adoption.
- Un audit annuel doit pouvoir prouver qui a accès à quoi, quand, et avec quelles données.
- Les sous-traitants imposent leurs propres exigences contractuelles (clauses ISO 27001, droit d'audit, localisation des données).

**Ce qu'il veut.**

- Une solution AI code review équivalente à CodeRabbit en qualité.
- Hébergement EU vérifiable contractuellement.
- Contrôle total sur le LLM utilisé (Mistral hébergé en France, Claude via AWS Europe avec DPA, ou modèle on-prem).
- Audit log, SSO, RBAC, support commercial avec interlocuteur identifié.
- Capacité à passer une revue sécurité interne sans dérogation.

**Ce qu'il ne veut pas.**

- Devoir se justifier auprès de son DPO sur les transferts hors UE.
- Un outil qui exige des clauses Schrems II en plus de son DPA.
- Une dépendance à un seul LLM imposé.

### 3.2 Persona secondaire : l'équipe DevSecOps d'ETI

**Profil.** Équipe DevSecOps de 3–10 personnes dans une ETI 200–2000 employés (industrie, retail, télécom, énergie) qui a une production logicielle interne mais qui n'est pas une boîte tech pure. Souvent sous GitLab self-hosted.

**Ce qu'il veut.** Améliorer la qualité des reviews internes sans devoir négocier 6 mois avec le juridique pour adopter un outil US.

### 3.3 Persona « adopteur Community »

**Profil.** Développeur seul ou petite équipe (1–10) qui utilise l'édition Community gratuite pour son besoin perso ou pour découvrir l'outil. Ce persona n'est **pas une cible commerciale**, mais il est essentiel à deux titres :

1. **Bouche-à-oreille** : il devient prescripteur dans son entreprise quand il y rejoint un poste.
2. **Maturation produit** : c'est lui qui remontera les bugs et les manques de l'OSS, gratuitement.

Le persona Community ne paie jamais. Toute tentative de monétiser ce segment est une erreur stratégique.

### 3.4 Non-cibles

- **Grosses orgs US** (Fortune 500 US, hyperscalers, GAFAM) — terrain de CodeRabbit Enterprise, marché perdu d'avance.
- **Startups EU early-stage tech-first** qui n'ont pas de contrainte de conformité — pour elles, CodeRabbit free tier ou Pro à 24 €/mois suffit largement.
- **Mainteneurs OSS solo** sans budget — adoptent la version Community, n'achètent rien.
- **Équipes qui veulent un produit zéro-config** — Sovri reste un outil avec configuration (`.sovri.yml`, SSO, RBAC), pas un click-and-forget.

---

## 4. Différenciation

### 4.0 Note critique : différenciation primaire = Compliance Trail

Sovri ne se vend **pas** sur l'hébergement EU ni sur le BYOK. Ces deux propriétés sont **commodifiées** :

- **L'hébergement EU** est trivialement obtenu en self-hostant n'importe quel bot OSS sur OVHcloud ou Scaleway. PR-Agent (Apache 2.0, 15k stars sur GitHub, donné à la communauté en avril 2026) est l'exemple le plus visible.
- **Le BYOK** est lui aussi commodifié : PR-Agent supporte 100+ providers LLM via LiteLLM (Mistral, Anthropic, Ollama, OpenAI, OpenRouter, Bedrock, etc.). CodeRabbit et Qodo s'ouvrent progressivement à la même flexibilité.

Le différenciateur réel de Sovri tient en trois mots : **Compliance Trail**. C'est-à-dire l'union de trois capacités absentes chez tous les concurrents identifiés (CodeRabbit, Qodo, CodeAnt, PR-Agent) :

1. **Compliance mapping** : chaque finding est annoté avec des références normatives potentielles (CWE, OWASP, GDPR, ISO 27001:2022, DORA, NIS2, AI Act, CRA).
2. **Audit trail signé** : chaque review peut produire un log append-only signé Ed25519, vérifiable hors-ligne, conçu pour servir directement en preuve d'audit ACPR / CNIL / ANSSI / BaFin / BSI.
3. **Organisational learning** : Sovri apprendra des décisions accept/reject prises par les développeurs et adaptera progressivement ses findings aux conventions internes de l'organisation, tout en maintenant un mode « audit strict » qui ré-applique systématiquement les règles standards.

L'hébergement EU et le BYOK restent des **prérequis** de Sovri, pas des arguments de vente.

### 4.1 Compliance Trail — détail des trois capacités

#### 4.1.1 Compliance Mapping (foundation v0.3, produit v1.0)

Chaque finding produit par Sovri est annoté d'un bloc structuré qui identifie les **références compliance potentielles** dans les principaux référentiels applicables à la cible EU régulée. Exemple de finding :

```
🟡 Major: Hardcoded credentials detected
File: src/db.ts, line 42
The connection string contains a hardcoded password.

📋 Potential compliance references
├─ CWE-798: Use of Hard-coded Credentials
├─ OWASP Top 10: A07:2021 Identification and Authentication Failures
├─ GDPR: applicable si données personnelles concernées (Art. 32 sécurité du traitement)
├─ ISO 27001:2022: contrôle A.5.17 (Authentication information)
├─ DORA: Art. 9 ICT risk management (gestion des accès)
└─ NIS2: Annex I §2.e (cryptography & access control)

🔍 Audit Reference: SOVRI-AC-AB12-CD34
```

**Principe directeur :** Sovri ne prétend pas être un cabinet de conformité. Le mapping est construit comme un **guide d'audit assistant**, pas comme un verdict juridique. Un finding annoté « DORA Art. 9 » doit être interprété par un RSSI ou un DPO ; il ne remplace pas l'expertise humaine. Le libellé produit doit parler de **références potentielles**, jamais de « violations compliance » automatiques.

Le modèle reste séparé entre le scan projet et la review de PR :

- project compliance scans evaluate Framework -> Control -> Rule -> Evidence.
- project compliance scan produces ComplianceGap output.
- PR review may project relevant compliance gaps into pull request output.

Le mapping est maintenu comme des fichiers JSON versionnés dans `packages/compliance`, avec **un fichier par CWE**. Ces fichiers sont validés par Zod, importés au build, et ne dépendent d'aucun appel API externe. Chaque entrée contient le titre CWE, l'URL MITRE, une liste courte d'impacts, puis les références par framework avec `identifier`, `description`, `source_url`, `applicability`, et `condition`.

V0.3 pose les fondations suivantes :

- Le LLM produit au plus un identifiant CWE. Il ne produit pas directement les références réglementaires.
- L'enrichissement CWE → frameworks est déterministe, depuis la table JSON locale.
- Couverture initiale : CWE Top 25 2025 + CWE-798, car le cas « hardcoded credentials » est central dans le positionnement.
- Identifiants canoniques : `CWE`, `OWASP-TOP10-2021`, `ISO27001-2022`, `GDPR`, `DORA`, `NIS2`, `AI-ACT`, `CRA`.
- `HDS` et `PCI-DSS` ne sont pas exposés en v0.3.
- Une référence `applicable_if` doit toujours porter une condition explicite.
- Aucune référence générée automatiquement n'est marquée `confirmed`. Ce niveau est réservé à une intervention humaine explicite future.
- Un CWE valide mais non mappé ne bloque pas la review : le finding est enrichi avec `compliance_references: []`, puis retiré de la sortie PR par le gate compliance-only avec un compteur de drop loggé.

#### 4.1.2 Audit Trail (foundation v0.3, produit v1.0)

Chaque review peut produire un fichier `audit-trail.jsonl` au format append-only. En v0.3, l'audit trail est une capacité foundation activée par injection d'un sink dans le review engine ; il n'est pas activé par défaut dans le bot Community.

Le modèle V0.3 distingue deux niveaux :

- `AuditTrailLogicalEvent` : événement non signé, porté par `{ ts, event, ...payload }`, émis par le review engine ou par un wrapper Cloud.
- `SignedAuditTrailEntry` : entrée JSONL signée produite par le writer, qui ajoute `previous_hash`, `entry_hash` et `signature`.

Le review engine émet uniquement `review.started`, `llm.called`, `finding.created`, `review.completed` et `review.failed` via `ReviewPullRequestOptions.auditTrailSink`. Il n'émet jamais `trail.started`, car cet événement appartient au composant qui possède la clé Ed25519, le `trail_id` et la clé publique. En V0.3, ce composant est un wrapper Cloud ou un test harness explicitement construit autour du writer.

Les 7 types d'événements V0.3 sont : `trail.started`, `review.started`, `llm.called`, `finding.created`, `review.completed`, `review.failed` et `correction`. L'événement `correction` sert uniquement à corriger une métadonnée d'audit a posteriori ; il ne représente pas un lifecycle produit `accept` / `dismiss`, qui reste reporté avec l'Organisational Learning.

Format de référence :

```jsonl
{"ts":"2026-05-26T14:32:00Z","event":"trail.started","trail_id":"...","public_key":"...","previous_hash":null,"entry_hash":"sha256:...","signature":"ed25519:..."}
{"ts":"2026-05-26T14:32:01Z","event":"review.started","pr_id":42,"commit_sha":"abc...","llm_provider":"mistral","llm_model":"mistral-large-2-2411","previous_hash":"sha256:...","entry_hash":"sha256:...","signature":"ed25519:..."}
{"ts":"2026-05-26T14:32:18Z","event":"llm.called","prompt_hash":"sha256:7f3a...","tokens_in":4521,"tokens_out":892,"previous_hash":"sha256:...","entry_hash":"sha256:...","signature":"ed25519:..."}
{"ts":"2026-05-26T14:32:18Z","event":"finding.created","audit_reference":"SOVRI-AC-AB12-CD34","severity":"major","cwe":"CWE-798","compliance_references":["GDPR-Art32","ISO27001-A.5.17","DORA-Art9"],"previous_hash":"sha256:...","entry_hash":"sha256:...","signature":"ed25519:..."}
{"ts":"2026-05-26T14:32:20Z","event":"review.completed","previous_hash":"sha256:...","entry_hash":"sha256:...","signature":"ed25519:..."}
```

Garanties techniques :

- **Append-only tamper-evident** : pas de mécanisme de modification rétroactive dans l'API publique, et chaque entrée inclut le hash de l'entrée précédente pour détecter modification, suppression, ou réordonnancement.
- **Signature Ed25519** : chaque entrée est signée avec une clé de l'organisation injectée explicitement. La signature utilise `node:crypto` natif, sans dépendance crypto externe.
- **Hash canonique** : le `entry_hash` est calculé sur l'événement logique plus `previous_hash`, en excluant seulement `entry_hash` et `signature`.
- **Vérifiabilité hors-ligne** : une API de vérification permet à un auditeur externe de vérifier l'intégrité sans dépendance réseau. Le CLI `sovri verify` est livré en v0.8 (cf. §7.9).
- **Payload prudent** : le trail contient IDs, timestamps, provider/model, token usage, CWE, références compliance, hashes de prompt/diff ; jamais le prompt brut, le diff brut, le body complet d'un finding, un token, ou un payload webhook brut.
- **Format ouvert** : JSONL standard, lisible sans Sovri, ingérable dans n'importe quel SIEM (Splunk, ELK, QRadar, Sentinel).

Objectif business : un RSSI banque qui reçoit une demande de l'ACPR (ou un hospital DSI qui reçoit une demande de la CNIL) doit pouvoir produire le trail en 10 minutes, sans dépendre d'un export SaaS US potentiellement bloqué par la juridiction. C'est la **preuve d'audit prête à l'emploi**, pas un journal d'application.

#### 4.1.3 Organisational Learning (Cloud v1.0+, Community v1.5+)

Sovri stocke chaque décision accept/dismiss prise par les développeurs avec la raison fournie :

```jsonl
{"finding_id":"AC-AB12-CD34","decision":"dismissed","reason":"Fixture de test","user":"...","ts":"..."}
{"finding_id":"BD-EF56-GH78","decision":"fixed","commit_sha":"...","ts":"..."}
```

Au bout de N PRs (typiquement 50–100), le système identifie :

- Les **patterns systématiquement dismissés** → réduit la priorité dans les futures reviews.
- Le **vocabulaire métier** de l'équipe → améliore la contextualisation du LLM via injection few-shot.
- Les **conventions internes** spécifiques → adapte les modes de review.

**Garde-fou non-négociable** : un mode « audit strict » force la ré-application de toutes les règles standards quelle que soit l'historique des dismiss. En v0.3, ce garde-fou existe seulement comme flag `strictAudit: false` par défaut dans l'API du review engine. Il n'a aucun effet observable tant que l'Organisational Learning n'est pas implémenté.

En v0.3, l'Organisational Learning reste un placeholder documentaire uniquement : pas de stockage, pas d'interface runtime, pas de comportement produit.

Cette capacité crée un **switching cost vertueux** pour les clients Cloud : plus la base d'apprentissage grandit, plus la migration vers un autre outil coûte cher en re-tuning. C'est le principal argument de défensibilité commerciale post-v1.0.

### 4.2 Positionnement face aux acteurs principaux

| Axe                                             | CodeRabbit    | Qodo          | PR-Agent (OSS)    | CodeAnt   | **Sovri Community** | **Sovri Cloud**    |
| ----------------------------------------------- | ------------- | ------------- | ----------------- | --------- | ------------------- | ------------------ |
| **Compliance Mapping (CWE→GDPR/ISO/DORA/NIS2)** | ❌            | ❌            | ❌                | ❌        | ✅ foundation v0.3  | ✅ foundation v0.3 |
| **Audit Trail signé Ed25519**                   | ❌            | ❌            | ❌                | ❌        | ✅ foundation v0.3  | ✅ foundation v0.3 |
| **Organisational learning**                     | ⚠️ partiel    | ⚠️ partiel    | ❌                | ❌        | ✅ v1.5             | ✅ v1.0+           |
| Hébergement EU                                  | ❌ AWS US     | ❌ US/IL      | ✅ chez le client | ❌ AWS US | ✅ chez le client   | ✅ OVHcloud        |
| RGPD by design                                  | Partiel       | Partiel       | ✅ self-host      | Partiel   | ✅ self-host        | ✅ DPA EU          |
| LLM au choix (BYOK)                             | ⚠️ limité     | ⚠️ limité     | ✅ via LiteLLM    | ⚠️ limité | ✅ tout LLM         | ✅ tout LLM EU     |
| Self-host gratuit                               | ❌            | ❌            | ✅ Apache 2.0     | Partiel   | ✅ Apache 2.0       | N/A                |
| SaaS managé                                     | ✅            | ✅            | ❌                | ✅        | N/A                 | ✅ EU only         |
| SSO/SAML                                        | ✅ enterprise | ✅ enterprise | ❌                | ✅        | ❌ (v2+)            | ✅ v1.0            |
| Consommation SARIF                              | ❌            | ❌            | ⚠️ partielle      | ⚠️        | ✅ v1.0             | ✅ v1.0            |
| GitHub                                          | ✅            | ✅            | ✅                | ✅        | ✅ v1.0             | ✅ v1.0            |
| GitLab self-hosted                              | ✅            | ✅            | ✅                | ✅        | ✅ v1.1             | ✅ v1.1            |
| Multi-repo / code graph                         | ✅            | ✅            | ❌                | ✅        | ❌ (post v2)        | ❌ (post v2)       |

Les **3 premières lignes** sont les vraies différenciations. Le reste est de la parité fonctionnelle ou de la commodité.

### 4.3 Ce que Sovri gagne avec Compliance Trail

- **Argument commercial concret face à un RSSI** : un finding Sovri est **immédiatement exploitable** comme preuve dans un dossier d'audit. Un finding PR-Agent ou Qodo demande un travail manuel de mapping par le DPO. À 10 minutes par finding sur 200 findings/mois, c'est ~33 heures d'expertise économisées par an, soit 4 000 € à 8 000 € selon le tarif du DPO.
- **Argument de conformité AI Act** : l'audit trail signé répond directement à l'**Art. 12 du AI Act** (traçabilité automatique des systèmes IA à haut risque) et à l'**Art. 26 §6** (tenue de logs). Aucun concurrent ne le revendique aujourd'hui.
- **Argument de conformité DORA** : pour les acteurs financiers EU, **DORA Art. 9 (gestion des risques ICT)** impose la documentation des contrôles techniques. Le compliance mapping de Sovri fournit cette documentation de manière automatisée.
- **Lock-in vertueux** : la base d'apprentissage organisationnel devient un actif propre au client, transférable mais coûteux à recréer ailleurs.

### 4.4 Ce que Sovri perd (assumé)

- **Breadth fonctionnelle** : pas d'IDE, pas de CLI, pas de Slack en v1. CodeRabbit et Qodo ont ces surfaces.
- **Multi-repo context** : pas de code graph cross-repo en v1. Qodo a investi plusieurs années dessus.
- **Marketing US-first** : on ne fera jamais le bruit que CodeRabbit fait sur Twitter/X. Notre canal est ailleurs (réseaux pro EU, événements OSS EU, contenus FR/DE).
- **Anciennete OSS** : PR-Agent a 15k stars et 2+ ans d'existence. Sovri Community n'a pas cette traction historique et ne l'aura jamais ; on attaque un segment différent (entreprises régulées vs early adopters tech).

### 4.5 Défensivité

Le **vrai** moat de Sovri est la combinaison de quatre éléments :

1. **Le mapping compliance lui-même.** Construire un mapping CWE → RGPD/ISO/DORA/NIS2 qui survit à une review d'expert externe (avocat IT, DPO senior, RSSI ACPR-grade) demande un effort cumulatif estimé à 3–6 mois de travail full-time. C'est jetable pour CodeRabbit/Qodo qui ne sont pas alignés sur la cible EU, mais réplicable. Probabilité de réplication par PR-Agent : faible (pas d'incitation commerciale).
2. **Le format de l'audit trail.** Un fois adopté par 5–10 clients régulés, le format jsonl signé Ed25519 de Sovri peut devenir un standard de facto dans le segment. C'est ce qui s'est passé avec SARIF (Microsoft) ou avec SBOM CycloneDX (OWASP).
3. **La base d'apprentissage organisationnel.** Chaque client Cloud accumule sa propre base, qui devient l'actif principal qu'il ne veut pas perdre. C'est le même mécanisme de switching cost que GitLab, Notion, ou Linear.
4. **L'expertise réglementaire EU.** Le commercial qui parle français/allemand et connaît les contraintes ACPR / BaFin / CNIL / ANSSI / BSI vendra mieux qu'un account exec américain. C'est de la spécialisation, pas de la technique.

CodeRabbit ou Qodo pourraient théoriquement copier ces capacités, mais cela demanderait 12–18 mois d'ingénierie et casserait leur positionnement SaaS US-centric. Probabilité de réaction agressive avant Sovri v1.5 : faible.

---

## 5. Périmètre fonctionnel

### 5.1 Workflow principal (inchangé par rapport à v1)

Le bot reçoit un webhook GitHub à chaque PR, récupère le diff et les fichiers touchés, appelle le LLM configuré, et poste des commentaires inline + un walkthrough en tête de PR. À chaque nouveau push, la review est incrémentale. L'utilisateur peut interagir avec `@sovri-bot` dans les commentaires pour relancer, dismisser, ou questionner les findings.

Pour le détail du workflow, voir l'annexe A.

### 5.2 Provider LLM (BYOK enrichi pour le marché EU)

L'interface unique de provider est conservée. Les adapters supportés en v1 :

| Provider                  | Mode                               | Notes                                                                                                                               |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Mistral La Plateforme** | API officielle                     | Hébergement France. `mistral-large-latest`, `codestral-latest`. **Provider recommandé par défaut pour les clients sous DORA/NIS2.** |
| Anthropic                 | API officielle + Bedrock Frankfurt | Documentation explicite des options EU.                                                                                             |
| OpenAI                    | API officielle + Azure OpenAI EU   | Documentation des options EU avec sous-processeur EU déclaré.                                                                       |
| Google Gemini             | API Vertex EU                      | `gemini-2.5-pro`, `gemini-2.5-flash` via région europe-west\*.                                                                      |
| OpenAI-compatible         | URL endpoint custom                | Couvre Ollama, vLLM, llama.cpp, LM Studio. C'est le mode 100 % on-prem.                                                             |

Modification clé par rapport à v1 : **Mistral devient le provider mis en avant dans la documentation et l'UI**, parce que c'est l'option qui passe le plus facilement une revue sécurité française et qui répond au critère « hébergement EU + société EU » sans clauses additionnelles.

### 5.3 Edition Community (OSS, self-host)

Fonctionnalités v0.3 foundation :

- Package `@sovri/compliance` public Apache 2.0.
- Enrichissement déterministe des findings avec `compliance_references` depuis les fichiers JSON CWE locaux.
- `audit_reference` stable au format `SOVRI-XX-HHHH-HHHH` sur chaque finding produit par Sovri.
- API d'audit trail signée Ed25519 avec sink mémoire et file writer, activable par injection.
- API de vérification hors-ligne du trail. Le CLI public est reporté.
- Flag `strictAudit` exposé dans l'API review engine, sans effet observable en v0.3.
- Placeholder documentaire pour l'Organisational Learning, sans code runtime.

Fonctionnalités v1.0 :

- Tout le workflow review (5.1).
- Tous les providers LLM (5.2).
- Walkthrough, inline comments, suggestions committables, chat conversationnel.
- Custom rules en natural language (`.sovri.yml`).
- Modes de review (full, bugs-only, strict, minimal).
- Filtres ignore (paths, labels, titles).
- Consommation SARIF en entrée.
- Limits coût et tokens.
- Logs JSON, endpoint `/metrics` Prometheus.
- Docker Compose et déploiement documenté.

**Non inclus en Community v0.3** :

- CLI `sovri verify`.
- Appel API externe pour récupérer le mapping compliance.
- Organisational Learning runtime.
- Stockage persistant de décisions accept/dismiss.

**Non inclus en Community v1.0** (réservé Cloud ou post-v1.0 selon traction) :

- SSO/SAML.
- Multi-tenancy.
- Dashboard d'administration web.
- Onboarding wizard.

**Licence :** Apache 2.0 (décision verrouillée, cf. sections 10 et 11). Pas de licence à clauses commerciales restrictives (BSL, AGPL strict) en v1.0 — la priorité est l'adoption, pas la protection.

### 5.4 Edition Cloud (SaaS managé EU)

Surcouche au-dessus du moteur Community. Fonctionnalités spécifiques :

#### 5.4.1 Onboarding et installation

- Wizard web qui guide l'utilisateur dans la création de la GitHub App, la connexion à un provider LLM, et le test de la première review.
- Provisioning automatique d'une instance dédiée (single-tenant) ou partagée (multi-tenant) selon le plan.
- Délai cible entre inscription et première PR reviewée : **moins de 15 minutes**.

#### 5.4.2 SSO/SAML et identité

- Default Cloud sign-in methods: passwordless email (magic link or OTP), GitHub OAuth, and Google OAuth.
- GitLab sign-in is a target through OAuth/OIDC, including self-hosted GitLab where the provider supports the required endpoints. It must be validated by an implementation spike before the auth library is locked.
- Enterprise SSO uses tenant-scoped OIDC/SAML providers such as Google Workspace, Microsoft Entra ID, Okta, Keycloak, Authentik, or Zitadel.
- Customer LDAP/Active Directory must be brokered through an enterprise IdP that exposes OIDC or SAML. Direct LDAP binds are out of scope for public Sovri Cloud; they may be reconsidered only for a dedicated/self-hosted enterprise deployment.
- Better Auth is the first candidate for the Cloud auth spike, not a locked product dependency. The spike must prove NestJS/Fastify integration, passwordless-only operation, GitHub/Google OAuth, GitLab OAuth/OIDC, tenant-scoped SSO, session cookie handling, account linking, and organization membership enforcement.
- SCIM pour le provisioning automatique des utilisateurs (cible v1.5).
- RBAC à trois niveaux : Admin, Reviewer, Viewer.

#### 5.4.3 Audit log

- Log structuré de toutes les actions sensibles : connexion, changement de config, dismiss de finding, partage de credentials, accès aux logs.
- Rétention configurable (90 jours minimum, jusqu'à 7 ans pour les plans Enterprise).
- Export CSV/JSON et endpoint d'extraction pour intégration SIEM.

#### 5.4.4 Multi-tenancy et isolation

- Une instance Cloud sert plusieurs clients, mais les données sont isolées au niveau base et au niveau réseau.
- Pour les clients qui exigent du single-tenant (et le paient), une option « Dedicated » avec instance et base dédiées.
- Les clés API LLM des clients sont chiffrées au repos avec une clé spécifique au tenant.

#### 5.4.5 Dashboard d'administration

- Liste des repos connectés, statut des reviews, consommation de tokens cumulée par utilisateur et par repo.
- Gestion centralisée des règles `.sovri.yml` au niveau organisation (override possible au niveau repo).
- Vue des coûts LLM facturés au client (puisqu'il est en BYOK, c'est lui qui paie son provider — on lui donne juste la visibilité).
- **Pas de dashboard de métriques d'ingénierie en v1.0** (DORA, throughput, etc.). Reporté v2.0.

#### 5.4.6 Support

- Support technique inclus selon le plan : email standard, Slack/Teams partagé pour les plans supérieurs, account manager dédié pour Enterprise.
- SLA contractuel sur disponibilité et temps de réponse selon le plan.

### 5.5 Consommation SARIF en entrée

L'argument conformité pour la cible entreprise se renforce significativement si Sovri sait **agréger les findings d'outils SAST déjà en place** dans le walkthrough de review. Plutôt que de réécrire un moteur SAST, Sovri consomme du SARIF (Static Analysis Results Interchange Format) en entrée.

Concrètement :

- Un job CI du client exécute Semgrep, Trivy, Gitleaks, ou tout outil SARIF-compatible, et publie le rapport SARIF en artefact de la PR.
- Sovri détecte la présence du rapport, le parse, et **intègre les findings dans le walkthrough** avec un encart séparé clairement étiqueté (« Findings statiques importés depuis Semgrep »).
- Le LLM est sollicité pour **éliminer les faux positifs** en croisant le finding SARIF avec le contexte du diff. Cas typique : Semgrep remonte une SQL injection que Sovri peut classer en faux positif parce qu'il voit que le paramètre est validé deux fonctions plus haut.

Cette feature transforme Sovri en couche d'**orchestration de qualité** plutôt qu'en simple LLM wrapper. C'est un argument de vente fort sur le marché entreprise.

### 5.6 Compliance et certifications

Documentation publique dès v1.0 :

- **DPA EU** (Data Processing Agreement) standard, signable sans renégociation, conforme aux clauses contractuelles types de la Commission européenne.
- **Registre des sous-processeurs** publié et mis à jour (hébergeur, providers LLM acceptés, services tiers du SaaS).
- **Politique de localisation des données** : toutes les données du tenant Cloud restent dans des régions EU (Frankfurt, Paris, Amsterdam, ou similaire).
- **Politique de chiffrement** : TLS 1.3 en transit, AES-256 au repos pour les données client et les credentials.

Roadmap certifications (déclaration de cap, sans engagement de date) :

- **ISO 27001** : démarrage du processus visé fin v1.0, certification visée v1.5.
- **SOC 2 Type II** : démarrage v1.5, achèvement v2.0.
- **SecNumCloud** : envisagé uniquement si traction client le justifie. Coût et délai (18–24 mois minimum) prohibitifs sans clients ancres.
- **HDS (Hébergeur de Données de Santé)** : envisagé si un client santé devient ancre.

### 5.7 Configuration repo : `.sovri.yml` (inchangé v1)

Le fichier `.sovri.yml` à la racine du repo gère les préférences (LLM utilisé, mode de review, règles, ignores, limits). Voir annexe A pour le schéma complet.

Un mécanisme d'**override organisationnel** existe côté Cloud : un fichier `sovri-org.yml` géré dans le dashboard admin force certaines règles sur tous les repos de l'organisation (par exemple, « le LLM doit être Mistral », « la rétention des reviews est de 90 jours », « les findings SARIF de Semgrep sont obligatoirement importés »).

### 5.8 Configuration instance (Community)

Variables d'environnement Docker pour les clés API, port, log level, et autres paramètres opérationnels. Voir annexe A pour le détail.

---

## 6. Exigences non-fonctionnelles

### 6.1 Performance

- **Latence cible Community et Cloud** : premier commentaire posté sur la PR < 60 s après le webhook pour une PR < 500 lignes modifiées avec un modèle rapide.
- **Latence acceptable** : < 5 min pour une PR < 2000 lignes avec un modèle profond.
- Au-delà de 2000 lignes, mode `chunked` (v1.1+).

### 6.2 Fiabilité (Cloud)

- SLA contractuel de disponibilité selon le plan : 99.5 % (Teams) à 99.9 % (Enterprise).
- Retry exponentiel sur les erreurs LLM (3 tentatives).
- Monitoring 24/7 (à coût raisonnable — Better Stack ou équivalent, pas une équipe de SRE).
- Backup quotidien des bases de données client avec rétention 30 jours, test de restauration trimestriel.

### 6.3 Sécurité

Exigences sur les deux éditions :

- Validation systématique des signatures webhook GitHub/GitLab.
- Token d'accès aux Git apps scopé au minimum nécessaire.
- Aucun logging de secret ni de code source en clair.
- Chiffrement en transit (TLS 1.3) et au repos (AES-256).
- Hébergement EU exclusivement (Cloud).

Exigences supplémentaires Cloud :

- Isolation réseau entre tenants.
- Chiffrement des credentials client avec clé spécifique au tenant (KMS).
- Politique de rotation des secrets internes (clés signature webhooks, secrets de session) : trimestrielle.
- Pentests externes annuels après v1.0.

### 6.4 Déploiement

**Community :**

- Image Docker officielle, Docker Compose example, déploiement documenté en moins de 30 min.

**Cloud :**

- Hébergement chez un cloud provider EU (OVHcloud, Scaleway, Outscale, ou Hetzner FR/DE).
- Architecture multi-AZ pour les plans Pro et Enterprise.
- Pas de Kubernetes en v1.0 (overkill). Docker Compose + supervisor ou systemd, jusqu'à preuve du contraire.

### 6.5 Observabilité

Logs JSON, endpoints `/health`, `/metrics` (Prometheus), `/version`. Inchangé v1.

Pour Cloud, dashboard interne d'opération basé sur Grafana + Prometheus, pour suivi par l'opérateur (Mathieu) de la santé de la plateforme.

### 6.6 Langages supportés

- Validation AST des suggestions committables : JS, TS, Python, Rust, Go.
- Pour les autres langages : validation par cohérence syntaxique.
- Pas de limite sur les langages reviewables — le LLM gère.

---

## 7. Roadmap

### 7.1 v0.1 — Walking skeleton Community (6–8 semaines)

Bot GitHub fonctionnel de bout en bout sur un repo de test. Chaque feature reste minimale, l'objectif est de prouver le flow complet :

- GitHub App + webhook handler `pull_request.opened` et `pull_request.synchronize`.
- Provider Anthropic uniquement (le plus simple à brancher pour démarrer).
- Récupération du diff, prompt unique simple, parsing de la réponse en findings.
- Walkthrough en tête de PR (sans tableau, juste un résumé).
- Inline comments sans suggestions committables.
- Pas de chat, pas de re-review.
- Pas de `.sovri.yml` — config tout en variables d'environnement.
- Image Docker publiée.

**Critère de sortie** : le bot review une PR de Mathieu sur un repo personnel pendant 1 semaine sans bug bloquant.

### 7.2 v0.2 — Scaffold du package compliance

Jalon court qui pose la fondation `@sovri/compliance` avant le pivot Compliance Trail de v0.3, et durcit le marquage `dismiss` :

- Scaffold `@sovri/compliance` (metadata ESM, build tsup, seuils Vitest).
- Schéma d'entrée de mapping compliance validé par Zod + loader statique du mapping CWE, données initiales CWE-798.
- Documentation de référence publique `.sovri.yml`.
- Marquage `dismiss-finding` restreint aux commentaires émis par le bot, avec tests de régression.

**Critère de sortie** : `@sovri/compliance` publié en Apache 2.0, mapping CWE-798 chargé sans appel réseau, et le bot ne traite un `dismiss` que s'il provient d'un commentaire bot.

### 7.3 v0.3 — Compliance Trail foundation

V0.3 ne cherche pas à livrer toute la promesse Compliance Trail en production. Elle pose les contrats publics et la base technique propre avant d'étendre les surfaces produit.

- Création de `@sovri/compliance` en Apache 2.0.
- Mapping compliance stocké en JSON versionné, un fichier par CWE, validé par Zod et importé au build.
- Couverture initiale : CWE Top 25 2025 + CWE-798.
- Enrichissement déterministe après parsing LLM : le LLM fournit au plus `cwe`, Sovri ajoute `compliance_references`.
- Rendu des `Potential compliance references` dans le walkthrough uniquement ; les inline comments restent centrés sur le finding.
- `Finding` étendu avec `compliance_references` et `audit_reference`.
- `audit_reference` visible dans le walkthrough et porté discrètement dans les inline comments.
- Review engine nettoyé pour que tous les entrypoints retournent un `Review` core enrichi.
- Audit trail activable par `ReviewPullRequestOptions.auditTrailSink`, avec événements logiques séparés des entrées signées.
- Sink mémoire public pour les intégrations et tests ; signer Ed25519 et file writer JSONL fournis comme fondation interne V0.3.
- Vérification offline exposée en API, pas encore en CLI.
- ADR 013 et 014 acceptés.
- `CONTEXT.md` mis à jour avec le vocabulaire Compliance Trail.

**Critère de sortie** : le bot produit un walkthrough enrichi par mapping local, aucun appel réseau n'est nécessaire pour les références compliance, et les APIs audit sont testées sans être activées par défaut en production Community.

### 7.4 v0.4 — Resolve workflow and release hardening (completed)

Sprint livré le 2026-06-02. V0.4 ne cherche pas encore à être la release Community self-host complète ; elle stabilise le workflow de review déjà présent pour préparer l'ouverture de Community aux early adopters self-host.

- Commande `@sovri-bot resolve <findingId>` routée depuis les issue comments.
- Handler resolve dédié, limité à l'auteur de la PR.
- Résolution du thread actif/non résolu correspondant au finding, même si un ancien thread résolu porte le même marker.
- Réactions `+1` idempotentes pour accuser réception des commandes sans spammer GitHub.
- Threads résolus exclus de la réconciliation des findings actifs.
- Diagnostics de review failure enrichis par stage, provider/model, usage tokens et identifiants techniques non sensibles.
- Redaction des fragments ressemblant à des secrets dans les logs d'échec.
- Helpers GitHub partagés entre handlers de commandes pour éviter les divergences de parsing repo, markers et erreurs `already_exists`.
- Release gate v0.4.0 validée : tag Git, image Community multi-arch GHCR, SBOM CycloneDX et GitHub Release.

**Critère de sortie** : un auteur de PR peut traiter un finding via `resolve` sans masquer le finding, sans dupliquer les réactions, et sans exposer de payload sensible en cas d'échec.

### 7.5 v0.4 — Community BYOK complète

La ligne v0.4 complète la productization BYOK qui rend Community utilisable en self-host :

- Tous les providers LLM (Mistral en tête, plus OpenAI et OpenAI-compatible), Anthropic conservé comme baseline.
- `.sovri.yml` complet, modes de review, custom rules NL, filtres.
- Suggestions committables avec validation AST légère.
- Surface de commandes complète (`resolve`, `dismiss`, `re-review`) sur le modèle adapter mince → handler dédié.
- Footer de coût.

Résidus de productization : OTel + endpoint `/metrics` planifiés en v0.6 (cf. §7.7 et ADR-019) ; consommation SARIF planifiée v1.0 (cf. §11).

**Critère de sortie** : Community déployable en autonomie par un dev externe en moins de 45 min, et utilisable sur ≥3 repos publics réels.

**Revue de cap à la sortie de v0.4** : décision Go/No-Go sur trois sujets simultanément :

1. Validation client (résultats de la prospection 5–10 entretiens) — si négatif, on s'arrête là et on tourne en projet OSS pur.
2. Inclusion d'une couche RAG basique en v1.0 (cf. section 12).
3. Engagement formel sur le développement de l'édition Cloud.

### 7.6 v0.5 — Public design implementation (prochain sprint, 2–3 semaines)

Objectif : codifier la direction visuelle validée en un design system réutilisable et l'appliquer à la surface de review produite par le bot, après la productization BYOK livrée en v0.4. La page publique `sovri.eu` est déjà en ligne sur cette direction.

- Design system codifié : tokens couleur/typographie/espacement, palette severity/category, assets de marque (shield, wordmark, sceau EU) en SVG, thème clair/sombre.
- Surface de review du bot alignée sur la direction visuelle : bandeau verdict, badges severity/category, bloc d'évaluation (effort, métriques, distribution de sévérité), inline findings, bloc compliance + provenance, statut Checks — rendus en Markdown GitHub avec un harness de snapshot clair/sombre.
- Shell documentation Community cohérent avec cette direction visuelle.
- Copy public minimal déjà en place : souveraineté EU, self-host, BYOK, Compliance Trail.
- Aucun dashboard produit, onboarding wizard, ni surface Cloud dans ce jalon.

**Critère de sortie** : la surface de review du bot et le site public partagent un design system unique et documenté ; les rendus du bot sont vérifiés par snapshots clair/sombre.

### 7.7 v0.6 — Observability & supply-chain hardening (post v0.5)

Jalon court qui solde les résidus de productization laissés par la ligne v0.4, sans toucher à la surface produit :

- OTel ajouté dans `@sovri/observability` (auto-instrumentation HTTP/Octokit, spans métier explicites, métriques métier) sans casser `createLogger()` — cf. ADR-019 (qui révise le calendrier d'ADR-006).
- Endpoint `/metrics` exposé (latence, coût, volume de review).
- Signature des images Docker via cosign keyless (OIDC GitHub) + attestation SLSA, vérifiable par le client avant déploiement.
- Logs utiles en incident, sans payload webhook brut ni contenu sensible de review.

**Critère de sortie** : une review émet des traces et métriques exploitables, `/metrics` répond, l'image publiée est signée et vérifiable (cosign), et aucun secret ni payload brut n'apparaît dans la télémétrie.

**Hors scope v0.6** : consommation SARIF (reste v1.0), dashboard, surface Cloud.

### 7.8 v0.7 — Extension du mapping compliance + prompt CWE

Élargissement de la couverture compliance et fiabilisation de l'enrichissement CWE :

- Mappings compliance ajoutés par lots CWE : authentification, crypto Tier-2, resilience/logging, credential et information exposure, cleartext et weak-hash, plus CWE-532.
- Le prompt de review demande désormais au LLM un identifiant CWE (ex. `CWE-287`) et un score de confiance (0–1) sur les findings security/bug.
- Gate d'enrichissement : une référence compliance n'est émise que si le finding est security/bug, porte un CWE, et atteint une confiance ≥ 0.7 (`COMPLIANCE_MIN_CONFIDENCE`, allowlist explicite de catégories).

**Critère de sortie** : les findings éligibles portent des références compliance déterministes, et un finding sous le seuil de confiance n'émet aucune référence.

### 7.9 v0.8 — Vérification compliance hors-ligne

Jalon qui outille la vérification hors-ligne du Compliance Trail posé en v0.3 :

- CLI `sovri verify <trail.jsonl>` (`@sovri/cli`) : vérification hors-ligne de la hash chain et des signatures Ed25519, sans dépendance réseau.
- Audit trail Community activable en opt-in (writer JSONL + signer), au-delà de la fondation exposée en API en v0.3.
- Moteur d'ingestion SARIF câblé dans le pipeline de review (`reviewPullRequest` : ingest → merge dédupliqué → walkthrough + ligne Checks). La feature productisée (fetch artefact CI + élimination des faux-positifs LLM) reste planifiée en v1.0 (cf. §5.5 et §7.11).

**Critère de sortie** : un auditeur externe vérifie l'intégrité d'un trail Sovri avec `sovri verify` sans Sovri en ligne, et l'audit trail Community reste désactivé par défaut.

### 7.10 v0.9 — Scaffold Cloud (post Go/No-Go)

Jalon dédié qui pose le squelette propriétaire `apps/cloud-api` après la décision Go (fin v0.4), isolé pour ne pas alourdir v1.0 :

- Bootstrap de l'app propriétaire `apps/cloud-api` (structure, header `Proprietary — Sovri SAS`, manifeste `workspace:*`), frontière de licence vérifiée par CI (ADR-010).
- Bootstrap the local private `apps/site` workspace as a React + Vite static site from the validated landing-page mockup. The site lives under `apps/` like `apps/cloud-api`, but it is excluded from the public OSS publication and owns the `sovri.eu` marketing and legal surface. Next.js is explicitly out of scope.
- Draft the Cloud Beta legal page routes in `apps/site`: `/privacy`, `/terms` or `/cgu`, `/dpa`, and `/subprocessors`. The local legal drafts are working material only until qualified legal review.
- Run the Cloud auth spike in `apps/cloud-api` with Better Auth as the first candidate, validating passwordless email, GitHub, Google, GitLab through OAuth/OIDC, tenant organization membership, and NestJS/Fastify integration.
- Premier appelant réel du writer d'audit trail interne du package `@sovri/compliance`, jusqu'ici sans consommateur côté Cloud.
- Multi-tenancy basique (squelette, 3–5 pilotes) et identity foundation based on passwordless email plus GitHub/Google OAuth. Enterprise SSO remains OIDC/SAML, with generic SAML/OIDC hardening in v1.1.

**Critère de sortie** : `apps/cloud-api` existe, isolé, frontière CI verte ; `apps/site` contient la landing page et les routes légales Cloud Beta en brouillon publiable ; le writer d'audit trail a son premier appelant ; multi-tenancy basique et auth Cloud Beta fonctionnelles ; Better Auth est soit validé, soit remplacé par une alternative documentée. Aucune logique métier de review dans `cloud-api` — tout reste dans `packages/review-engine`.

### 7.11 v1.0 — Community stable + démarrage Cloud Beta (8–12 semaines)

Édition Community livrée comme produit stable :

- Documentation complète, README poli, public site landing page plus legal pages (`/privacy`, `/terms` or `/cgu`, `/dpa`, `/subprocessors`).
- 3–5 deployments réels chez des utilisateurs Community (Mathieu inclus).
- Release process formalisé, semver.

Démarrage de l'édition Cloud Beta, sur le scaffold posé en v0.9 (cf. §7.10) :

- Multi-tenancy basique avec 3–5 clients pilotes (alpha gratuits ou très peu chers).
- Passwordless email, GitHub OAuth, and Google OAuth sign-in available for Cloud Beta.
- GitLab OAuth/OIDC sign-in if the v0.9 auth spike validates the provider path without custom security-sensitive glue.
- Tenant-scoped OIDC/SAML support starts with one controlled pilot provider, then expands to generic SSO in v1.1.
- Audit log structuré.
- Dashboard admin minimal (utilisateurs, repos, coûts).
- Hébergement OVH Cloud, single region.
- DPA EU prêt à signer, public privacy/terms pages reviewed, and subprocessor registry published at a stable `sovri.eu` URL.

**Critère de sortie** : Community v1.0 publiée, 3–5 clients Beta Cloud signés (même gratuits) avec contrat DPA et premiers retours produit.

### 7.12 v1.1 — GitLab self-hosted + Cloud GA (8–12 semaines)

- Support GitLab self-hosted (cible : on-prem chez ETI françaises et allemandes).
- Cloud passe en General Availability avec premier tarif payant officiel.
- Generic tenant-scoped OIDC/SAML SSO (Okta, Microsoft Entra ID, Google Workspace, Keycloak, Authentik, Zitadel).
- Mode `chunked` pour les très grosses PR.
- Renforcement du registre des sous-processeurs et documentation compliance.

**Critère de sortie** : 10 clients Cloud payants ou en signature, ARR contractualisé identifiable.

### 7.13 v1.5 — Renforcement enterprise (6 mois)

- SCIM pour provisioning automatique.
- Single-tenant Dedicated (instance et base dédiées par client).
- Démarrage formel processus ISO 27001.
- Première version multi-region (Frankfurt + Paris).
- Premières actions ciblées partenaires intégrateurs.

### 7.14 Post v1.5 — Pistes non engagées

- ISO 27001 certification finale.
- SOC 2 Type II.
- DORA metrics dashboard.
- Multi-repo context (section 12).
- Support Bitbucket / Azure DevOps si demande client forte.
- HDS si client santé ancre.

---

## 8. Critères de succès

### 8.1 Techniques

- p95 latence webhook → premier commentaire < 90 s sur PR < 500 LOC modifiées avec Haiku/codestral.
- Taux d'échec de review < 1 % sur 100 PR consécutives.
- Zéro fuite de secret dans les logs.
- Zéro plantage du process sur 30 jours.
- Disponibilité Cloud ≥ 99.5 % sur le premier trimestre post-GA.

### 8.2 Produit

- Au moins 3 clients Cloud Beta signés à la sortie de v1.0.
- Au moins 10 clients Cloud payants à la sortie de v1.1.
- 100+ déploiements Community uniques (téléchargements actifs de l'image Docker) à 12 mois.
- NPS Beta > 30 à v1.0, > 50 à v1.1.

### 8.3 Business

- ARR mesurable à v1.1 (objectif : couverture des coûts d'hébergement + outils + LLM proxy interne).
- 24 mois après v1.0, ARR ≥ équivalent salaire Vates actuel (cf. section 13).
- Au moins un partenariat intégrateur signé à 18 mois.

### 8.4 Scope

Le critère ultime : **la section 2 (non-objectifs) n'a pas bougé entre la rédaction du PRD et la release v1.0**. Toute exception est traitée par révision explicite et tracée du PRD, pas par ajout silencieux. C'est la garantie principale contre le pattern historique d'éparpillement qui a fait échouer les projets précédents.

---

## 9. Risques

| Risque                                                                                                                     | Probabilité     | Impact       | Mitigation                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hypothèse marché EU régulé fausse** (personne ne paie pour la conformité)                                                | **Élevée**      | **Critique** | Prospection 5–10 DSI/RSSI **avant ou pendant** v0.1 ; si <3 signaux d'achat, retour modèle OSS pur ou pivot D (services)                                                                                               |
| **Mapping compliance contesté ou imprécis** (un finding annoté « GDPR Art. 32 » est interprété comme un verdict juridique) | **Élevée**      | **Élevé**    | Wording produit en « Potential compliance references », jamais « violation » automatique ; aucune référence auto-confirmed ; chaque entrée JSON cite ses sources officielles publiques                                 |
| **PR-Agent ou Qodo copient Compliance Trail**                                                                              | Faible          | Élevé        | Le code mapping est OSS Apache 2.0 donc copiable, mais le **format de l'audit trail** + la **base d'apprentissage** sont propres à Sovri Cloud ; vitesse d'exécution + relations clients EU > technologie              |
| **Audit Trail rejeté par un auditeur réel** (format non reconnu, signature contestée)                                      | Moyenne         | Élevé        | Format JSONL standard, hash chain, signature Ed25519 via Node crypto natif, vérification offline, documentation détaillée du schéma                                                                                    |
| **AI Act change l'interprétation des obligations de traçabilité**                                                          | Moyenne         | Moyen        | Veille active sur les implementing acts ; flexibilité du format audit trail pour ajouter des champs ; le positionnement de conformité devient un avantage si la réglementation se durcit                               |
| CodeRabbit lance une EU edition dans 12 mois                                                                               | Moyenne         | Élevé        | Veille trimestrielle ; capitaliser sur le head start ; profondeur de localisation (équipe FR/DE) qu'ils ne reproduiront pas                                                                                            |
| Cycle de vente entreprise >9 mois                                                                                          | Élevée          | Élevé        | Édition Community sert de pré-vente ; offre Beta gratuite pour réduire le frein d'achat ; partenariats intégrateurs                                                                                                    |
| Maintenance solo non tenable sur Cloud                                                                                     | Élevée          | Élevé        | Stack volontairement simple (pas de K8s) ; outils de monitoring SaaS (Better Stack) ; freelances ponctuels                                                                                                             |
| Hallucinations LLM créant des findings faux                                                                                | Élevée          | Moyen        | Mode `minimal` recommandé en doc ; commande `dismiss` ; choix d'un modèle profond pour les reviews critiques ; **Compliance mapping marqué comme « applicable si »** pour ne pas créer de faux positifs réglementaires |
| Coût LLM mal anticipé par client                                                                                           | Moyenne         | Moyen        | Dashboard de coût visible ; alertes ; `max_cost_per_pr_usd` en hard limit                                                                                                                                              |
| Dérive de scope vers SAST/multi-plateforme/IDE                                                                             | **Très élevée** | **Critique** | Section 2 + section 8.4 ; relecture mensuelle des non-objectifs                                                                                                                                                        |
| Tentation de construire un LLM interne                                                                                     | **Élevée**      | **Critique** | Section 12 verrouille cette discussion ; coûts $100k+ documentés                                                                                                                                                       |
| Dépendance à un seul provider LLM si Mistral baisse en qualité                                                             | Moyenne         | Élevé        | Architecture BYOK garantit la portabilité ; documentation explicite de 2–3 alternatives EU-friendly                                                                                                                    |
| Certification ISO 27001 plus longue/chère que prévu (18+ mois, 30–60 k€)                                                   | Élevée          | Moyen        | Démarrage tardif (v1.0+) ; provision dans la projection financière ; partenariat avec un cabinet spécialisé                                                                                                            |
| Réglementation EU change (AI Act, NIS2 application)                                                                        | Moyenne         | Moyen        | Veille active ; le positionnement de conformité devient un avantage si la réglementation se durcit                                                                                                                     |

---

## 10. Décisions techniques et opérationnelles (tranchées)

Les 6 questions historiquement ouvertes lors du cadrage ont été tranchées avant rédaction finale du PRD. Elles sont listées ici comme référence de décision, avec leur justification courte. Toute remise en cause ultérieure nécessite une révision explicite du PRD.

1. **Stack runtime** : **Node.js / TypeScript** pour le bot serveur. La vitesse de mise sur marché prime largement, et `@octokit` + `probot` économisent 1 à 2 mois sur la mécanique webhook + auth GitHub App. Le runtime ne change rien à la latence perçue (>95 % du temps de review est en attente du LLM). Rust reste envisageable plus tard pour des services auxiliaires (workers d'embedding, parsing AST) mais pas pour le bot principal.

2. **Format de sortie LLM** : **JSON**. Les LLM modernes (Claude 4+, GPT-5, Mistral Large 2) gèrent le JSON structuré de façon fiable, particulièrement avec le mode `response_format: json_schema`. Validation via Zod (TS) avec retry sur erreur de schéma. Standard universel, intégration triviale avec tous les SDK.

3. **Licence Community** : **Apache 2.0**. Clause brevet explicite plus protectrice que MIT, standard de facto du dev tooling moderne (Kubernetes, Terraform, OpenSearch). Compatible avec un modèle open-core sans contraintes problématiques.

4. **Branding** : **Sovri**. Néologisme construit sur « souverain » et « véri[fié] ». Aligné à 100 % avec la promesse stratégique de souveraineté EU. Vérification de disponibilité technique passée (pas de collision dev tool ni d'entité commerciale homonyme dans le secteur). Domaines à acquérir : `sovri.eu` en priorité, plus `sovri.dev` et `sovri.io` en défensif. Le `.eu` plante le drapeau souveraineté EU dans le nom de domaine lui-même.

5. **Hébergeur Cloud** : **OVHcloud Public Cloud** (régions Gravelines ou Strasbourg) dès le départ. Position de souveraineté française renforcée vis-à-vis des clients régulés français. Surcoût ~2× vs Hetzner accepté en échange du positionnement marché. Option **OVHcloud SecNumCloud** réservée aux clients Enterprise qui le demandent contractuellement (premier client banque ou défense).

6. **Statut juridique** : **Auto-entrepreneur (micro-entreprise) au démarrage**, bascule vers **SASU ou SARL prévue à v1.1** ou dès franchissement du plafond CA micro-entreprise (77 700 € HT/an services en 2026). Limites à connaître : franchise TVA disparaît à ~39 100 € HT/an (services). Sujet **clause de non-concurrence Vates** à clarifier par écrit avant signature du premier client payant — Sovri n'est pas en concurrence directe avec Xen Orchestra, mais la prudence juridique impose une confirmation écrite (manager ou RH).

7. **Direction visuelle** : la direction visuelle explorée pendant le cadrage reste la référence pour la surface publique pré-1.0. Elle est codifiée en design system et appliquée à la surface de review du bot en v0.5, après la productization BYOK livrée en v0.4 et avant v1.0 Beta. La page publique `sovri.eu` est déjà en ligne sur cette direction.

### Questions restant ouvertes pour v0.5+

- **Domaine commercial complet** : faut-il viser `sovri.com` (US-centric mais standard) en plus de `sovri.eu` ? Probablement non en v1, mais à reconsidérer si traction dépasse l'EU.
- **Slogan/baseline** : « La code review IA souveraine pour l'Europe régulée » est un point de départ — à affiner avec retours prospection.

---

## 11. Décisions stratégiques verrouillées

Ces décisions ont été prises au terme du cadrage et ne doivent **pas** être rediscutées sans une révision explicite et tracée du PRD.

- ✅ **Nom produit** : Sovri (étymologie : souverain + vérifié).
- ✅ **Form factor v1** : GitHub App webhook bot, GitLab self-hosted en v1.1.
- ✅ **Différenciation primaire** : Compliance Trail pour entreprises EU régulées.
- ✅ **Différenciation technique secondaire** : Bring Your Own Key, agnostique du LLM.
- ✅ **Cible business primaire** : entreprises EU 50–500 développeurs en secteurs régulés (FR, BE, CH, LU, DE, AT, NL).
- ✅ **Distribution duale** : Community OSS gratuite (Apache 2.0) + Cloud SaaS managé EU payant.
- ✅ **Hébergement Cloud** : OVHcloud Public Cloud, option SecNumCloud sur demande Enterprise.
- ✅ **Stack runtime** : Node.js / TypeScript.
- ✅ **Pas de LLM interne, jamais.** Détaillé en section 12.
- ✅ **Mistral La Plateforme** est le provider LLM recommandé par défaut pour les clients sous contrainte DORA/NIS2.
- ✅ **Mapping compliance V0.3** : JSON local versionné, un fichier par CWE, importé au build, sans appel API externe.
- ✅ **Références compliance automatiques** : jamais `confirmed`; `applicable_if` exige une condition explicite.
- ✅ **Audit Trail V0.3** : `auditTrailSink` injecté, événements logiques séparés des entrées signées, hash chain signée Ed25519 via `node:crypto`, API verifier sans CLI public.
- ✅ **Organisational Learning V0.3** : placeholder documentaire uniquement, aucun runtime.
- ✅ **Consommation SARIF** en v1.0 (intégration findings Semgrep, Trivy, Gitleaks).
- ✅ **Pas de** moteur SAST propre, génération de code, DORA metrics en v1.0, IDE/Slack en v1, multi-repo context en v1, auto-merge.
- ✅ **Hypothèse business non validée à la rédaction**. La validation par prospection (5–10 entretiens DSI/RSSI) est une priorité absolue avant ou pendant v0.1.

---

## 12. Vision long-terme — Context Engine

Trois couches d'enrichissement contextuel sont envisagées au-delà de v1.0, sans engagement de livraison à ce stade. Toute exécution nécessite une révision explicite du PRD.

**Principe directeur :** Sovri reste agnostique du LLM de raisonnement (BYOK). Le « context engine » s'intercale entre le diff et l'appel LLM pour enrichir le contexte, **pas pour remplacer le modèle**. La cible entreprise renforce cette logique : les clients régulés préfèrent un LLM externe traçable (Mistral, Claude EU) à un modèle propriétaire opaque qu'ils ne peuvent pas auditer.

**Les trois couches envisagées :**

1. **Code embeddings + RAG local** (v1.5 envisageable). Indexer le repo client dans une base vectorielle locale via un modèle d'embedding open-source (Qwen2.5-Coder-Embed, nomic-embed-code, Qodo-Embed-1). À chaque review, retrouver les morceaux de code sémantiquement pertinents au-delà du diff strict.

2. **Boucle d'apprentissage per-repo** (v2). Stocker les findings dismissés et les patterns rejetés. Réinjecter en few-shot dans les prompts suivants. Pas de fine-tuning, juste de la mémoire conversationnelle persistée.

3. **Fine-tuning ciblé d'un petit modèle open-source** (v3, très optionnel). Pour les sous-tâches étroites (classification de sévérité, triage rapide) uniquement. Ne remplace jamais le LLM principal BYOK.

**Décisions verrouillées sur ce sujet :**

- ✅ Pas de LLM de raisonnement entraîné from scratch. Coûts compute documentés : $100k à $3M pour des modèles utilisables, $78-192M pour des frontier. Incompatible avec un projet de cette taille et casserait la promesse BYOK.
- ✅ Pas de distillation à partir de Claude/GPT/Gemini (ToS et architecture incompatibles avec la souveraineté revendiquée).
- ✅ Pas de modèle propriétaire Sovri hébergé centralement (casse self-host et souveraineté).
- ✅ Décision Go/No-Go sur le RAG basique (couche 1) à la fin de v0.4, sur la base de données réelles d'usage : taux de dismiss des findings et taille typique des PR. Pas d'intuition, des chiffres.
  - **Résolu au 2026-06-09 : No-Go pour v1.0.** RAG basique reporté à v1.5 (sa cible d'origine). Ré-évaluation conditionnée à l'instrumentation préalable du taux de dismiss des findings et de la taille typique des PR — le bot stateless ne stocke pas encore ces chiffres.

Voir annexe B pour le détail complet.

---

## 13. Business model

### 13.1 Modèle global

**Open core + SaaS managé.** L'édition Community open-source est la pré-vente. L'édition Cloud SaaS managée est le revenu.

Précédents qui valident ce modèle : GitLab (CE/EE), Sentry, PostHog, Mattermost, Plausible Analytics, Umami. Tous bootstrap-friendly, tous compatibles avec une cible entreprise régulée, tous capables d'atteindre 7+ chiffres d'ARR sans VC.

### 13.2 Sources de revenus

**Source primaire : abonnement Cloud SaaS.** Tarification probable par seat (par développeur actif sur PR), avec un plan d'entrée Teams et un plan Enterprise. Pricing exact non fixé dans ce PRD — à valider en prospection, et à ajuster selon ce que la concurrence pratique au moment du lancement. Ordres de grandeur à explorer :

- Plan Teams : tarification compétitive avec CodeRabbit Pro (~24 €/dev/mois), avec premium possible justifié par la conformité.
- Plan Enterprise : significativement plus cher (×2 à ×5), avec SSO, audit, support, et options de single-tenant.
- Plan Dedicated : sur devis, single-tenant et options de localisation spécifiques.

**Source secondaire (v1.1+) : licence Community Pro.** Possibilité d'une licence payante sur l'édition self-host pour les fonctionnalités enterprise (SSO, audit log) sans passer par le Cloud. Pour les clients qui ont une politique stricte « pas de SaaS externe ». À évaluer selon demande.

**Source tertiaire (v1.5+) : services.** Déploiement assisté, intégration custom, formation, audit de configuration. Marge faible mais utile pour grossir les contrats Enterprise.

### 13.3 Go-to-market

**Canaux primaires :**

1. **Bouche-à-oreille technique via la Community OSS.** Des développeurs adoptent Sovri gratuitement, s'en font les ambassadeurs dans leur boîte. Levier essentiel — c'est ce qui permet à l'inbound de fonctionner.
2. **Contenu technique en français et allemand.** Articles sur RGPD et AI code review, DORA et outils de qualité, témoignages clients. SEO B2B, pas SEO consumer.
3. **Outbound LinkedIn ciblé.** Tech Lead / RSSI / Head of Engineering en boîtes 50–500 dev dans les secteurs cibles. Volume bas, ciblage fin, message conformité.
4. **Partenariats intégrateurs et cabinets de conseil sécurité.** Synacktiv, Wavestone, Almond, Lexsi côté France ; KPMG Tech, Capgemini Invent à plus grande échelle. Pour eux, Sovri est un produit à recommander à leurs clients, ce qui leur génère des missions d'intégration.

**Canaux secondaires à v1.5+ :**

5. Conférences ciblées : Cybersécurité (FIC, Assises de la Sécurité), DevSecOps (DevOps D-Day, KubeCon EU), salons sectoriels (banque, santé).
6. Marketplaces spécifiques : GitHub Marketplace (gratuit + payant), Salesforce AppExchange si pertinent.

### 13.4 Économie unitaire

Le BYOK décale la facture LLM hors de notre P&L. Concrètement :

- Le client paie son propre provider LLM (Mistral, Anthropic, etc.) en direct.
- Nous facturons un abonnement d'usage du SaaS : multi-tenancy, SSO, audit, support, hébergement, conformité.
- Coût marginal par client supplémentaire = hébergement (faible, mutualisé) + support (variable, dépend de la taille du client).

Marge brute attendue à terme : 70–85 % (typique SaaS bootstrappé), avec un mix de plans Teams (marge plus faible) et Enterprise (marge plus haute).

### 13.5 Trajectoire visée

L'objectif posé en cadrage est de remplacer le salaire Vates à 12–24 mois. Référence sectorielle pour calibrer la difficulté : un solo founder bootstrap atteignant 5 k€ MRR le fait typiquement en 12–18 mois full-time, ou 24–36 mois part-time, selon les benchmarks publics disponibles.

Pour Mathieu, qui est à temps plein chez Vates, le calendrier 24 mois est dans la moitié optimiste de cette distribution part-time. Atteignable, mais demande :

- Une exécution serrée (pas de scope creep).
- Un canal d'acquisition qui marche (Community + outbound + partenariats).
- 5–10 clients payants à 300–500 €/dev/mois × ~10 dev/client = 3–5 k€ MRR par client (Enterprise) → 1–3 clients Enterprise suffisent pour atteindre l'équivalent salaire.

Cette trajectoire est crédible mais **conditionnée** à la validation de l'hypothèse marché. Si la prospection ne trouve pas de signaux d'achat, l'objectif 24 mois est invalide et le pivot D (services freelance autour de l'OSS) devient la voie réaliste.

### 13.6 Décisions business à trancher avant v1.0 (Cloud Beta)

- Création formelle d'une entité juridique (SARL, SAS, ou auto-entreprise selon situation Vates) — nécessaire pour signer les DPA.
- Choix de la stratégie de domaine et de nom commercial.
- Final website repository/folder strategy: `apps/site` stays in the local monorepo workspace like `apps/cloud-api`, implemented as a React + Vite static site, while remaining excluded from the public OSS publication until a separate publication decision is made.
- Legal publication plan for `sovri.eu`: `/privacy`, `/terms` or `/cgu`, `/dpa`, and `/subprocessors`, with counsel review before the first Cloud Beta signature.
- Cloud auth decision: validate Better Auth by spike or select a fallback before Cloud Beta implementation starts. Passwordless, GitHub, Google, GitLab OAuth/OIDC, tenant-scoped OIDC/SAML, and "no direct LDAP in public Cloud" are the product constraints.
- Décision sur la séparation entre activité Sovri et emploi Vates (en accord avec contrat de travail et clause de non-concurrence éventuelle).
- Premier devis ISO 27001 auprès d'un cabinet spécialisé pour calibrer le coût et le délai.

---

## 14. Plan d'action immédiat V0.5

V0.4 est publiée. La ligne v0.4 a livré le workflow `resolve`, le durcissement des logs d'échec, la mécanique de release et la productization BYOK (tous les providers, `.sovri.yml`, commandes `dismiss`/`re-review`, suggestions committables, footer de coût). La page publique `sovri.eu` est déjà en ligne sur la direction visuelle validée. La prochaine itération est donc v0.5 : codifier cette direction en design system et l'appliquer à la surface de review du bot.

**Étape 1 : codifier le design system.**

- Tokens couleur/typographie/espacement et palette severity/category, validés par Zod.
- Assets de marque (shield, wordmark `Sov[r]i`, sceau EU) exportés en SVG, thème clair/sombre.

**Étape 2 : appliquer la direction visuelle au rendu du bot.**

- Bandeau verdict, badges severity/category, bloc d'évaluation (effort, métriques, distribution de sévérité).
- Refresh des inline findings et du bloc compliance + provenance, statut Checks.
- Rendus en Markdown GitHub (pas de CSS injectable côté GitHub), vérifiés par un harness de snapshot clair/sombre.

**Étape 3 : shell documentation et cohérence.**

- Shell de documentation Community aligné sur la direction visuelle.
- Cohérence entre la surface de review du bot et le site public via un design system unique.

**Résidus de productization** : OTel + endpoint `/metrics` planifiés en v0.6 (cf. §7.7) ; consommation SARIF en v1.0.

**Hors scope V0.5** : Cloud dashboard, multi-tenancy, billing, SSO/SAML, stockage permanent des décisions d'équipe, certification ISO/SOC/HDS.

---

## Annexes

**Annexe A — Workflow détaillé** : description complète du flow webhook, format des commentaires inline, structure du walkthrough, schéma de `.sovri.yml`. Voir document `docs/annex-workflow.md`.

**Annexe B — Context Engine (vision long-terme)** : RAG local, boucle d'apprentissage per-repo, fine-tuning ciblé optionnel. Justifications du refus du LLM interne propriétaire. Voir document `docs/annex-context-engine.md`.

---

_Fin du PRD Sovri V0.3 foundation._
