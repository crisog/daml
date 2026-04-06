# Daml Playground

An interactive playground and documentation site for learning Daml and Canton. Write smart contracts in the browser, deploy them to a Canton sandbox, and explore the results in real time.

Live at [daml.run](https://daml.run).

## How it works

The site pairs an interactive playground with a documentation guide. You write Daml contracts in a browser-based editor, deploy them to a Canton sandbox running behind the scenes, then create parties, submit commands, and exercise choices to see how the ledger responds. The docs walk through the same concepts you're experimenting with, building from basic contract modeling through authorization and multi-party workflows.

## Why

Canton's learning curve is steep and the existing documentation assumes too much context. This project gives new developers a fast feedback loop: edit code, deploy, see what happens. The docs build on that by explaining the concepts behind what you just did.

## Sandbox limitations

The playground runs on a Canton sandbox, which is a simplified environment for learning. It differs from a production Canton network in a few important ways:

- **Single node**: One participant connected to one synchronizer. Production networks run many of each across independent organizations.
- **In-memory**: All data lives in memory and is lost when the process stops. There is no persistent storage.
- **No distributed topology**: Features like multi-participant workflows, cross-synchronizer transactions, and decentralized namespace management are not available.
- **Not for performance testing**: The sandbox is not tuned for throughput or latency. It is designed for correctness, not scale.

The sandbox is good for learning Daml's contract model, authorization rules, and choice mechanics. It is not a representation of how Canton behaves in production.
