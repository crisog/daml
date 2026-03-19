# AGENTS Instructions

These instructions apply to this repository unless the user explicitly overrides them.

## Product and audience

- This docs site is a public onboarding guide for new Canton/Daml developers.
- Prefer practical, beginner-friendly explanations.
- Assume readers may come from imperative languages (e.g., Python, JavaScript, Go).

## Writing style

- Use an educative tone: clear, direct, and example-driven.
- Avoid unnecessary jargon and "insider" shorthand.
- Keep sections focused on one outcome.
- Do not use em dashes. Use commas, periods, colons, or parentheses instead.
- When introducing Daml concepts, build incrementally. Introduce one idea at a time before showing the full code block.

## Content structure

- Keep `Getting Started` (index.mdx) focused on environment setup only: prerequisites, installing `dpm`, PATH setup, version checks and core commands.
- Put contract authoring and testing in separate pages from Getting Started.
- When a doc page shows code in pieces, also include a single complete copyable block at the end.

## Code examples

- Every code snippet shown in docs must have a matching, compilable Daml project under `examples/`.
- Run `dpm build && dpm test` in the relevant `examples/` subdirectory to verify correctness before finalizing docs changes.

## Tooling language policy

- Use `dpm` commands in docs and examples.
- Do not include deprecated command migration content unless explicitly requested.
- Do not mention deprecated tooling unless explicitly requested.

## Mermaid usage policy

- Use Mermaid only when it adds real explanatory value.
- Avoid diagrams that only restate simple sequential steps already obvious from headings.
- Prefer diagrams for state transitions, authorization flow, and multi-party interactions.

## Daml syntax highlighting

- Daml syntax highlighting is configured in `source.config.ts` using the grammar from `external/daml/sdk/compiler/daml-extension/syntaxes/daml.json`.
- Use the `daml` language tag in fenced code blocks.

## Runtime workflow constraints

- If the user says they are actively running `npm run dev`, do not run build/dev commands unless asked.
- Prefer file edits only, and let the user validate changes live.

## Project-specific notes

- Keep site branding as `DAML Guide`.
- If external Canton/SDK docs are needed for reference, read from `external/daml/sdk/docs/`.
- If external DPM docs are needed for reference, read from `external/dpm/`.
