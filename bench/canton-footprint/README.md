# Canton footprint benchmarks

These scripts and results are the evidence for the Canton Guide post about the cost of an end-to-end test on Canton. They measure the start time and the memory of two test networks: the Canton sandbox and the Splice LocalNet.

## What ran

- Canton open-source 3.7.4, on the `eclipse-temurin:21-jdk` image.
- Splice LocalNet 0.10.3.
- boat.dev machines with 4 shared vCPUs and 8 GB, and one machine of our own with 125 GiB.

Each `conditions.txt` file gives the machine, the date and the commands of its runs.

## The three clocks

A start time in the results uses one of three clocks:

- **healthy**: for the sandbox, the ready line in its log. For LocalNet, the moment when all containers report healthy.
- **ready**: the first pass of the health check of LocalNet's `splice` container. The script reads it each second.
- **first transfer**: the end of the first transfer of Canton Coin that passes.

The start times do not include downloads.

## Scripts

| Script | What it does |
| --- | --- |
| `bench.sh` | Measures one sandbox topology in a Docker container with limits: time to ready, memory and live heap |
| `matrix.sh` | Runs phases of `bench.sh` measurements |
| `localnet.sh` | Measures one LocalNet start: time until healthy, and the memory of each container |
| `localnet-transfer-test.py` | Moves Canton Coin between two parties on a LocalNet that runs |
| `localnet-stages.py` | Splits a LocalNet start into stages, from the logs that `localnet.sh` keeps |
| `sandbox-coin.sh` | Moves Canton Coin between two participants of a sandbox, with no Splice app |
| `restart.sh` | Checks whether a sandbox with file storage keeps its ledger after a kill |
| `fresh-host.sh` | Runs the measurements on a machine that has none of the inputs |

The first lines of each script give its usage. The `localnet-*.yaml` files are Docker Compose overrides for LocalNet.

## Results

- `results/boat/` holds the runs on boat.dev. `results/boat/conditions.txt` describes each directory.
- `results/run1/` to `results/run6/` hold the runs on our own machine.

## Figures

`post/figures.mjs` writes the figures of the post:

```bash
node post/figures.mjs post/figures
```
