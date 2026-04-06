export type Example = {
  name: string
  description: string
  source: string
}

export const EXAMPLES: Example[] = [
  {
    name: 'Payment Obligation',
    description: 'Signatories, controllers, and archiving',
    source: `module Main where

template PaymentObligation
  with
    debtor : Party
    creditor : Party
    amount : Decimal
  where
    ensure amount > 0.0

    signatory debtor, creditor

    nonconsuming choice Pay : ()
      controller debtor
      do
        archive self
`,
  },
  {
    name: 'Contact Book',
    description: 'Consuming vs. nonconsuming choices, UTXO updates',
    source: `module Main where

template Contact
  with
    owner : Party
    name : Text
    telephone : Text
    address : Text
  where
    signatory owner

    choice UpdateTelephone : ContractId Contact
      with
        newTelephone : Text
      controller owner
      do
        create this with telephone = newTelephone

    choice UpdateAddress : ContractId Contact
      with
        newAddress : Text
      controller owner
      do
        create this with address = newAddress

    nonconsuming choice GetContact : (Text, Text, Text)
      controller owner
      do
        return (name, telephone, address)
`,
  },
  {
    name: 'Authorization',
    description: 'Observers, multi-signatory, and visibility rules',
    source: `module Main where

template Invoice
  with
    issuer : Party
    client : Party
    auditor : Party
    amount : Decimal
    description : Text
  where
    ensure amount > 0.0

    signatory issuer, client
    observer auditor

    choice MarkPaid : ()
      controller client
      do
        pure ()

    nonconsuming choice AddNote : ContractId InvoiceNote
      with
        note : Text
      controller auditor
      do
        create InvoiceNote
          with
            invoice = self
            author = auditor
            note

template InvoiceNote
  with
    invoice : ContractId Invoice
    author : Party
    note : Text
  where
    signatory author
`,
  },
  {
    name: 'Asset Transfer',
    description: 'Propose-accept pattern and ownership transfer',
    source: `module Main where

template Asset
  with
    issuer : Party
    owner : Party
    description : Text
    quantity : Decimal
  where
    ensure quantity > 0.0

    signatory issuer, owner

    choice ProposeTransfer : ContractId TransferProposal
      with
        newOwner : Party
      controller owner
      do
        create TransferProposal
          with
            asset = this
            newOwner

template TransferProposal
  with
    asset : Asset
    newOwner : Party
  where
    signatory (signatory asset)
    observer newOwner

    choice Accept : ContractId Asset
      controller newOwner
      do
        create asset with owner = newOwner

    choice Reject : ContractId Asset
      controller newOwner
      do
        create asset

    choice Cancel : ContractId Asset
      controller asset.owner
      do
        create asset
`,
  },
]
