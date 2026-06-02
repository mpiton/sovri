// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export type ParsedCommand =
  | { readonly kind: "re-review" }
  | { readonly kind: "dismiss"; readonly findingId: string }
  | { readonly kind: "resolve"; readonly findingId: string }
  | { readonly kind: "unknown"; readonly raw: string }
  | { readonly kind: "no-mention" };

const MentionPattern = /^@sovri-bot(?:\s+(.*))?$/iu;
const FindingIdPattern = /^[A-Za-z0-9-]{1,64}$/u;

export function parseCommand(body: string): ParsedCommand {
  let firstUnknown: { readonly kind: "unknown"; readonly raw: string } | undefined;

  for (const line of body.split(/\r?\n/u)) {
    const mentionMatch = MentionPattern.exec(line);
    if (mentionMatch === null) {
      continue;
    }
    const rawCommand = mentionMatch[1]?.trimEnd() ?? "";

    if (rawCommand === "re-review") {
      return { kind: "re-review" };
    }

    const tokens = rawCommand.split(/\s+/u);
    const command = tokens[0];
    const findingId = tokens[1];
    if (tokens.length === 2 && findingId !== undefined && FindingIdPattern.test(findingId)) {
      if (command === "dismiss" || command === "resolve") {
        return { kind: command, findingId };
      }
    }

    firstUnknown ??= { kind: "unknown", raw: rawCommand };
  }

  return firstUnknown ?? { kind: "no-mention" };
}
