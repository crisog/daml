# AGENTS Instructions

These instructions apply to this repository unless the user explicitly overrides them.

## Product and audience

- This docs site is a public onboarding guide for new Canton/Daml developers.
- Prefer practical, beginner-friendly explanations.
- Assume readers may come from imperative languages (e.g., Python, JavaScript, Go).

## Writing style

- Use an educative tone: clear, direct, and example-driven.
- Avoid unnecessary jargon and avoid "insider" shorthand.
- Keep sections focused on one outcome.

## Content structure

- Keep `Getting Started` focused on environment setup only:
  - prerequisites
  - installing `dpm`
  - PATH setup
  - version checks and core commands
- Put contract authoring in separate pages (for example, "Creating your first Daml smart contract").

## Tooling language policy

- Use `dpm` commands in docs and examples.
- Do not include deprecated command migration content unless explicitly requested.
- Do not mention deprecated tooling unless explicitly requested.

## Mermaid usage policy

- Use Mermaid only when it adds real explanatory value.
- Avoid diagrams that only restate simple sequential steps already obvious from headings.
- Prefer diagrams for state transitions, authorization flow, and multi-party interactions.

## Runtime workflow constraints

- If the user says they are actively running `npm run dev`, do not run build/dev commands unless asked.
- Prefer file edits only, and let the user validate changes live.

## Project-specific notes

- Keep site branding as `DAML Guide`.
- If external Canton docs are needed, read from `/Users/crisog/Code/Canton/Docs`.
