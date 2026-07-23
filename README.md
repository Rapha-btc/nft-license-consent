# nft-license-consent

On-chain consent registry for NFT collection license changes. Built for the
case where a pseudonymous artist needs to sign off on a license change
without doxxing: identity is established by a public wallet linkage, consent
is an on-chain hash commitment from that wallet.

Two roles, DocuSign style:

- **Requester** - whoever mandates the document (community, marketplace,
  dev) proposes the exact license doc for a collection.
- **Signer** - the verified artist wallet signs a specific pending
  proposal, re-asserting its hash. What gets signed is exactly what was
  mandated, byte for byte.

## How it works

1. **Link wallet to identity (off-chain, public).** The artist posts their
   Stacks address from their known identity, e.g. a tweet from
   `@their_handle`. No doxxing needed - pseudonymous handle + wallet is the
   identity.
2. **Register the artist (on-chain, admin).** The registry owner calls
   `set-artist(nft-contract, artist, x-handle, evidence-uri)` after checking
   the evidence. The evidence URI (tweet URL) is stored on-chain with the
   registration.
3. **Propose the license (on-chain, requester).** The requester calls
   `propose-license(nft-contract, license-hash, license-uri, license-name)`.
   `license-hash` is the sha256 of the exact license document bytes.
4. **Sign (on-chain, artist).** The artist calls
   `sign-license(nft-contract, proposal-id, license-hash)` directly from
   their wallet - their client re-hashes the document, so the provided hash
   must match the proposal. The transaction itself IS the signature: the
   artist's key signs the payload containing the document hash. Each
   signature becomes an immutable new license version. The artist can also
   `reject-proposal`.
5. **Verify (anyone, especially the requester).** Hash the document you
   hold and call `is-current-license(nft-contract, hash)` - true means the
   registered artist signed exactly this document and it is the latest
   version.

The evidence bundle for any dispute: the license document itself, its
sha256, the sign-license tx ID (a signature by the artist's key over that
hash), and the public post linking wallet to artist (referenced on-chain
via `evidence-uri`).

## Contract API

Public:

- `set-artist(nft-contract principal, artist principal, x-handle (string-ascii 64), evidence-uri (string-ascii 256))` - owner only; registers or rotates the verified artist wallet for a collection. Rejects non-contract collections and contract-principal artists.
- `propose-license(nft-contract principal, license-hash (buff 32), license-uri (string-ascii 256), license-name (string-ascii 64))` - permissionless (only what the artist signs carries weight); requires a registered artist. Returns the proposal id.
- `sign-license(nft-contract principal, proposal-id uint, license-hash (buff 32))` - artist only, direct call only (tx-sender must equal contract-caller), hash must match the proposal. Returns the new version number.
- `reject-proposal(nft-contract principal, proposal-id uint)` - artist only; closes a pending proposal.

Read-only:

- `get-artist(nft-contract)` - registration record or none
- `get-proposal-count(nft-contract)` / `get-proposal(nft-contract, id)` - proposal queue (status: 0 pending, 1 signed, 2 rejected)
- `get-license-count(nft-contract)` - number of signed versions
- `get-license(nft-contract, version)` - a specific signed version
- `get-current-license(nft-contract)` - latest signed version
- `is-current-license(nft-contract, document-hash)` - true if the hash matches the latest signed license

Errors: u100 not-owner, u101 no-artist-registered, u102 not-the-artist,
u103 collection-not-a-contract, u104 artist-not-a-standard-principal,
u105 not-a-direct-call, u106 bad-hash-length, u107 no-such-proposal,
u108 proposal-not-pending, u109 hash-mismatch.

## Dev

```
clarinet check
npm install
npm test
```

Clarity 5, tested with @stacks/clarinet-sdk (vitest). 18 tests.

## Example

Collection: `SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe`
