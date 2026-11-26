#!/usr/bin/env python3
"""Moves Canton Coin between two parties on a running LocalNet.

By default the sender is the wallet user of the app-user validator, and the
receiver is the wallet user of the app-provider validator, on a second
participant. Each transfer uses the token standard (CIP-56) through the wallet
API: the sender creates a transfer instruction, and the receiver accepts it.

Usage: localnet-transfer-test.py <localnet-dir> <transfers> [sender] [receiver]
  localnet-dir  the cluster/compose/localnet directory of the Splice release
  transfers     the number of transfers, one after the other
  sender        app-user (default) | app-provider | sv: the validator of the sender
  receiver      app-provider (default) | app-user | sv: the validator of the
                receiver. When it is the sender's validator, the receiver is a
                second wallet user that this script registers on that validator.

Prints one tab-separated row:
  transfers, accepted, total_ms, median_ms, slowest_ms, sender_change, receiver_change
Exits with 0 only when the receiver accepted each transfer, the receiver's
balance grew by the sum of the transfers, and the sender's balance fell by
that sum or more.
"""
import json
import pathlib
import statistics
import sys
import time
import uuid
from decimal import Decimal

from localnet_wallet import wallet

SECOND_USER = "transfer-test-receiver"
TRANSFER_AMOUNT = Decimal("1.0")
# The sender pays for the transfers and for their fees from this amount.
FAUCET_AMOUNT_PER_TRANSFER = Decimal("2.0")
# A holding loses a small fee in each round, so the receiver's balance can be
# this much below the sum of the transfers.
HOLDING_FEE_ALLOWANCE = Decimal("0.01")
VISIBLE_DEADLINE_S = 60
OFFER_LIFETIME_S = 600


def wait_until_visible(receiver, contract_id):
    deadline = time.monotonic() + VISIBLE_DEADLINE_S
    pause_s = 0.1
    while contract_id not in receiver.open_transfer_ids():
        if time.monotonic() >= deadline:
            raise SystemExit(f"the receiver did not see transfer {contract_id[:16]} in {VISIBLE_DEADLINE_S} s")
        time.sleep(pause_s)
        pause_s = min(pause_s * 2, 2.0)


def transfer_once(sender, receiver, receiver_party, run_id, index):
    created = sender.call("POST", "/v0/wallet/token-standard/transfers", {
        "receiver_party_id": receiver_party,
        "amount": str(TRANSFER_AMOUNT),
        "description": f"footprint test transfer {index}",
        "expires_at": int((time.time() + OFFER_LIFETIME_S) * 1_000_000),
        "tracking_id": f"{run_id}-{index}",
    })
    output = created["output"]
    if "receiver_holding_cids" in output:
        return
    contract_id = output.get("transfer_instruction_cid")
    if contract_id is None:
        raise SystemExit(f"transfer {index}: the wallet reported a failed transfer: {json.dumps(created)[:300]}")
    wait_until_visible(receiver, contract_id)
    accepted = receiver.call("POST", f"/v0/wallet/token-standard/transfers/{contract_id}/accept", {})
    if "receiver_holding_cids" not in accepted["output"]:
        raise SystemExit(f"transfer {index}: the accept did not complete: {json.dumps(accepted)[:300]}")


def main():
    localnet_dir = pathlib.Path(sys.argv[1])
    transfers = int(sys.argv[2])
    sender_role = sys.argv[3] if len(sys.argv) > 3 else "app-user"
    receiver_role = sys.argv[4] if len(sys.argv) > 4 else "app-provider"
    sender = wallet(localnet_dir, sender_role)
    receiver = wallet(localnet_dir, receiver_role, SECOND_USER if receiver_role == sender_role else None)
    receiver_party = receiver.party()
    sender.party()

    sender.call("POST", "/v0/wallet/tap", {"amount": str(FAUCET_AMOUNT_PER_TRANSFER * transfers)})
    sender_before = sender.balance()
    receiver_before = receiver.balance()

    run_id = uuid.uuid4().hex[:12]
    durations_ms = []
    started = time.monotonic()
    for index in range(1, transfers + 1):
        transfer_started = time.monotonic()
        transfer_once(sender, receiver, receiver_party, run_id, index)
        durations_ms.append((time.monotonic() - transfer_started) * 1000)
    total_ms = (time.monotonic() - started) * 1000

    sender_change = sender.balance() - sender_before
    receiver_change = receiver.balance() - receiver_before
    print("\t".join(str(value) for value in (
        transfers, len(durations_ms), round(total_ms), round(statistics.median(durations_ms)),
        round(max(durations_ms)), sender_change, receiver_change,
    )))
    sent = TRANSFER_AMOUNT * transfers
    if receiver_change < sent - HOLDING_FEE_ALLOWANCE:
        raise SystemExit(f"the receiver's balance grew by {receiver_change}, expected {sent}")
    if sender_change > -sent:
        raise SystemExit(f"the sender's balance changed by {sender_change}, expected -{sent} or less")


if __name__ == "__main__":
    main()
