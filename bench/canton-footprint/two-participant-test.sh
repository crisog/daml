#!/usr/bin/env bash
# One test, two participants. Alice, on the first participant, creates a contract
# addressed to Bob. Bob, on the second participant, responds to it.
# Run it against `bin/canton sandbox --multi-sync`. It needs curl and jq.
set -euo pipefail

FIRST=localhost:6864  # JSON Ledger API of the participant named "sandbox"
SECOND=localhost:7864 # JSON Ledger API of the participant named "pebblebox"
PING='#canton-builtin-admin-workflow-ping:Canton.Internal.Ping:Ping'

api() { curl --silent --fail-with-body --header 'Content-Type: application/json' "$@"; }

# Both participants are connected to synchronizer-1. Read its id.
SYNC=$(api $FIRST/v2/state/connected-synchronizers |
  jq -r '.connectedSynchronizers[] | select(.synchronizerAlias == "synchronizer-1").synchronizerId')

# Alice is hosted on the first participant, and Bob on the second.
new_party() { # new_party <participant> <name>
  jq -n --arg name "$2" --arg sync "$SYNC" \
    '{partyIdHint: $name, identityProviderId: "", synchronizerId: $sync}' |
    api --data @- "$1/v2/parties" | jq -r .partyDetails.party
}
ALICE=$(new_party $FIRST alice)
BOB=$(new_party $SECOND bob)
echo "Alice: $ALICE"
echo "Bob:   $BOB"
sleep 2 # each participant learns of the other's party through the synchronizer

# Alice creates a Ping for Bob. The command goes to her participant only.
jq -n --arg ping "$PING" --arg alice "$ALICE" --arg bob "$BOB" '{
  commands: [{CreateCommand: {templateId: $ping,
    createArguments: {id: "hello", initiator: $alice, responder: $bob}}}],
  commandId: "create-hello", userId: "demo", actAs: [$alice]}' |
  api --data @- $FIRST/v2/commands/submit-and-wait >/dev/null
echo "Alice created a Ping on $FIRST"

# Prints the ids of the contracts that a party can see on a participant.
contracts() { # contracts <participant> <party>
  local offset
  offset=$(api "$1/v2/state/ledger-end" | jq .offset)
  jq -n --arg party "$2" --argjson offset "$offset" \
    '{activeAtOffset: $offset, eventFormat: {filtersByParty: {($party): {}}}}' |
    api --data @- "$1/v2/state/active-contracts" |
    jq -r '.[].contractEntry.JsActiveContract.createdEvent.contractId'
}

# Bob's participant holds the same contract, and nobody sent it there by hand.
CONTRACT=$(contracts $SECOND "$BOB")
echo "Bob sees it on $SECOND: ${CONTRACT:0:24}..."

# Bob responds on his own participant, which archives the Ping for both.
jq -n --arg ping "$PING" --arg contract "$CONTRACT" --arg bob "$BOB" '{
  commands: [{ExerciseCommand: {templateId: $ping, contractId: $contract,
    choice: "Respond", choiceArgument: {}}}],
  commandId: "respond-hello", userId: "demo", actAs: [$bob]}' |
  api --data @- $SECOND/v2/commands/submit-and-wait >/dev/null
echo "Bob responded on $SECOND"

sleep 1
echo "Contracts Alice still sees on $FIRST: $(contracts $FIRST "$ALICE" | grep -c . || true)"
