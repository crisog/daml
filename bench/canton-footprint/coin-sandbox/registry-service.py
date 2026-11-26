#!/usr/bin/env python3
"""Serves the token standard's registry API (CIP-56) for a Canton Coin registry
on a Canton sandbox, with no Splice app.

On the Canton Network, Scan serves this API. A wallet calls it to get the
contract that starts a transfer and the contracts that a transfer must
disclose. This service reads those contracts from the Ledger API of the
participant that hosts the DSO party.

It serves the two calls of a transfer that the receiver accepts:
  POST /registry/transfer-instruction/v1/transfer-factory
  POST /registry/transfer-instruction/v1/<transfer-instruction>/choice-contexts/accept
It does not serve transfers with a preapproval, allocations, or metadata.

Usage: registry-service.py <ledger-json-api-url> <dso-party> <port>
"""
import json
import re
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RULES = "#splice-amulet:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules"
CONFIG_STATE = "#splice-amulet:Splice.ExternalPartyConfigState:ExternalPartyConfigState"
TRANSFER_INSTRUCTION = "#splice-amulet:Splice.AmuletTransferInstruction:AmuletTransferInstruction"
LOCKED_AMULET = "#splice-amulet:Splice.Amulet:LockedAmulet"
CONFIG_STATE_CONTEXT_KEY = "external-party-config-state"
TRANSFER_FACTORY_PATH = "/registry/transfer-instruction/v1/transfer-factory"
ACCEPT_CONTEXT_PATH = re.compile(r"^/registry/transfer-instruction/v1/([^/]+)/choice-contexts/accept$")
LEDGER_TIMEOUT_S = 60


class NotFound(Exception):
    pass


class Ledger:
    def __init__(self, base_url, dso):
        self.base_url = base_url.rstrip("/")
        self.dso = dso

    def call(self, method, path, body=None):
        request = urllib.request.Request(
            self.base_url + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=LEDGER_TIMEOUT_S) as response:
            return json.loads(response.read())

    def active(self, template):
        """The active contracts of a template that the DSO party sees, each with
        the blob that a transaction needs to disclose it."""
        offset = self.call("GET", "/v2/state/ledger-end")["offset"]
        template_filter = {"TemplateFilter": {"value": {"templateId": template, "includeCreatedEventBlob": True}}}
        entries = self.call("POST", "/v2/state/active-contracts", {
            "eventFormat": {
                "filtersByParty": {self.dso: {"cumulative": [{"identifierFilter": template_filter}]}},
                "verbose": False,
            },
            "activeAtOffset": offset,
        })
        return [entry["contractEntry"]["JsActiveContract"] for entry in entries]

    def one(self, template, contract_id):
        for contract in self.active(template):
            if contract["createdEvent"]["contractId"] == contract_id:
                return contract
        raise NotFound(f"no active {template} with id {contract_id}")


def disclosed(contract):
    event = contract["createdEvent"]
    return {
        "templateId": event["templateId"],
        "contractId": event["contractId"],
        "createdEventBlob": event["createdEventBlob"],
        "synchronizerId": contract["synchronizerId"],
    }


def config_state_context(ledger, more_disclosed):
    """The choice context of Canton Coin: the newest configuration state, and
    the contracts that the choice must disclose."""
    states = ledger.active(CONFIG_STATE)
    if not states:
        raise NotFound("the registry has no ExternalPartyConfigState")
    newest = max(states, key=lambda state: state["createdEvent"]["createArgument"]["targetArchiveAfter"])
    context_value = {"tag": "AV_ContractId", "value": newest["createdEvent"]["contractId"]}
    return {
        "choiceContextData": {"values": {CONFIG_STATE_CONTEXT_KEY: context_value}},
        "disclosedContracts": [disclosed(contract) for contract in [newest, *more_disclosed]],
    }


def transfer_factory(ledger, request):
    transfer = request["choiceArguments"]["transfer"]
    rules = ledger.active(RULES)
    if len(rules) != 1:
        raise NotFound(f"expected one ExternalPartyAmuletRules, found {len(rules)}")
    return {
        "factoryId": rules[0]["createdEvent"]["contractId"],
        "transferKind": "self" if transfer["sender"] == transfer["receiver"] else "offer",
        "choiceContext": config_state_context(ledger, rules),
    }


def accept_context(ledger, instruction_id):
    instruction = ledger.one(TRANSFER_INSTRUCTION, instruction_id)
    # The receiver cannot see the locked holding, so the choice discloses it.
    locked = ledger.one(LOCKED_AMULET, instruction["createdEvent"]["createArgument"]["lockedAmulet"])
    return config_state_context(ledger, [locked])


class Handler(BaseHTTPRequestHandler):
    ledger = None

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            request = json.loads(body or b"{}")
            accept = ACCEPT_CONTEXT_PATH.match(self.path)
            if self.path == TRANSFER_FACTORY_PATH:
                self.reply(200, transfer_factory(self.ledger, request))
            elif accept:
                self.reply(200, accept_context(self.ledger, accept.group(1)))
            else:
                self.reply(404, {"error": f"this registry does not serve {self.path}"})
        except NotFound as missing:
            self.reply(404, {"error": str(missing)})
        except (KeyError, ValueError) as invalid:
            self.reply(400, {"error": f"invalid request: {invalid!r}"})

    def reply(self, status, payload):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))


def main():
    ledger_url, dso, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
    Handler.ledger = Ledger(ledger_url, dso)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
