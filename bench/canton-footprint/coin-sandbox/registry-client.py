#!/usr/bin/env python3
"""Moves Canton Coin between two parties as a wallet does it with the token
standard (CIP-56): it gets the transfer factory and the choice contexts from a
registry over HTTP, and it submits the two choices to the JSON Ledger API of
each party's participant. It uses no Daml Script and no Splice app.

Usage: registry-client.py <registry-url> <sender-ledger-url> <receiver-ledger-url>
                          <dso> <sender> <receiver> <transfers>

Prints one tab-separated row:
  transfers, accepted, total_ms, median_ms, slowest_ms, sender_change, receiver_change
Exits with 0 only when the receiver accepted each transfer, the receiver's
balance grew by the sum of the transfers, and the sender's balance fell by
that sum or more.
"""
import datetime
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from decimal import Decimal

HOLDING = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding"
TRANSFER_FACTORY = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory"
TRANSFER_INSTRUCTION = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction"
INSTRUMENT = "Amulet"
USER = "registry-client"
TRANSFER_AMOUNT = Decimal("1.0")
REQUEST_TIMEOUT_S = 120
VISIBLE_DEADLINE_S = 60
OFFER_LIFETIME = datetime.timedelta(hours=1)
# The ledger rejects a request time that is later than its own clock.
REQUEST_TIME_MARGIN = datetime.timedelta(seconds=5)


def call(method, url, body=None):
    request = urllib.request.Request(
        url,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:600]
        raise SystemExit(f"{method} {url} returned {error.code}: {detail}") from error


class Party:
    """A party and the JSON Ledger API of the participant that hosts it."""

    def __init__(self, party, ledger_url):
        self.party = party
        self.ledger_url = ledger_url.rstrip("/")

    def views(self, interface):
        """Contract id and interface view of each active contract of the party."""
        offset = call("GET", f"{self.ledger_url}/v2/state/ledger-end")["offset"]
        interface_filter = {"InterfaceFilter": {"value": {
            "interfaceId": interface, "includeInterfaceView": True, "includeCreatedEventBlob": False}}}
        entries = call("POST", f"{self.ledger_url}/v2/state/active-contracts", {
            "eventFormat": {
                "filtersByParty": {self.party: {"cumulative": [{"identifierFilter": interface_filter}]}},
                "verbose": False,
            },
            "activeAtOffset": offset,
        })
        events = [entry["contractEntry"]["JsActiveContract"]["createdEvent"] for entry in entries]
        return [(event["contractId"], event["interfaceViews"][0]["viewValue"]) for event in events]

    def unlocked_holdings(self):
        return [(contract_id, view) for contract_id, view in self.views(HOLDING)
                if view["owner"] == self.party and view.get("lock") is None]

    def balance(self):
        return sum((Decimal(view["amount"]) for _, view in self.unlocked_holdings()), Decimal(0))

    def exercise(self, interface, contract_id, choice, argument, disclosed_contracts):
        call("POST", f"{self.ledger_url}/v2/commands/submit-and-wait", {
            "commands": [{"ExerciseCommand": {
                "templateId": interface,
                "contractId": contract_id,
                "choice": choice,
                "choiceArgument": argument,
            }}],
            "commandId": f"registry-client-{uuid.uuid4()}",
            "userId": USER,
            "actAs": [self.party],
            "readAs": [],
            "disclosedContracts": disclosed_contracts,
            "synchronizerId": disclosed_contracts[0]["synchronizerId"],
        })


def timestamp(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def transfer_once(registry_url, dso, sender, receiver):
    now = datetime.datetime.now(datetime.timezone.utc)
    known = {contract_id for contract_id, _ in receiver.views(TRANSFER_INSTRUCTION)}
    argument = {
        "expectedAdmin": dso,
        "transfer": {
            "sender": sender.party,
            "receiver": receiver.party,
            "amount": str(TRANSFER_AMOUNT),
            "instrumentId": {"admin": dso, "id": INSTRUMENT},
            "requestedAt": timestamp(now - REQUEST_TIME_MARGIN),
            "executeBefore": timestamp(now + OFFER_LIFETIME),
            "inputHoldingCids": [contract_id for contract_id, _ in sender.unlocked_holdings()],
            "meta": {"values": {}},
        },
        "extraArgs": {"context": {"values": {}}, "meta": {"values": {}}},
    }
    factory = call("POST", f"{registry_url}/registry/transfer-instruction/v1/transfer-factory",
                   {"choiceArguments": argument, "excludeDebugFields": True})
    argument["extraArgs"]["context"] = factory["choiceContext"]["choiceContextData"]
    sender.exercise(TRANSFER_FACTORY, factory["factoryId"], "TransferFactory_Transfer", argument,
                    factory["choiceContext"]["disclosedContracts"])

    deadline = time.monotonic() + VISIBLE_DEADLINE_S
    while True:
        offered = [contract_id for contract_id, _ in receiver.views(TRANSFER_INSTRUCTION) if contract_id not in known]
        if offered:
            break
        if time.monotonic() >= deadline:
            raise SystemExit(f"the receiver did not see the transfer in {VISIBLE_DEADLINE_S} s")
        time.sleep(0.2)
    instruction_id = offered[0]
    context = call("POST", f"{registry_url}/registry/transfer-instruction/v1/{instruction_id}/choice-contexts/accept",
                   {"meta": {}, "excludeDebugFields": True})
    receiver.exercise(TRANSFER_INSTRUCTION, instruction_id, "TransferInstruction_Accept",
                      {"extraArgs": {"context": context["choiceContextData"], "meta": {"values": {}}}},
                      context["disclosedContracts"])


def main():
    registry_url = sys.argv[1].rstrip("/")
    dso = sys.argv[4]
    sender = Party(sys.argv[5], sys.argv[2])
    receiver = Party(sys.argv[6], sys.argv[3])
    transfers = int(sys.argv[7])

    sender_before = sender.balance()
    receiver_before = receiver.balance()
    durations_ms = []
    started = time.monotonic()
    for _ in range(transfers):
        transfer_started = time.monotonic()
        transfer_once(registry_url, dso, sender, receiver)
        durations_ms.append((time.monotonic() - transfer_started) * 1000)
    total_ms = (time.monotonic() - started) * 1000

    sender_change = sender.balance() - sender_before
    receiver_change = receiver.balance() - receiver_before
    print("\t".join(str(value) for value in (
        transfers, len(durations_ms), round(total_ms), round(statistics.median(durations_ms)),
        round(max(durations_ms)), sender_change, receiver_change,
    )))
    sent = TRANSFER_AMOUNT * transfers
    if receiver_change != sent:
        raise SystemExit(f"the receiver's balance grew by {receiver_change}, expected {sent}")
    if sender_change > -sent:
        raise SystemExit(f"the sender's balance changed by {sender_change}, expected -{sent} or less")


if __name__ == "__main__":
    main()
