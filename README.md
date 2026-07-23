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

1. **Identify the artist wallet.** Two paths:
   - **Trustless (Gamma-style collections).** The collection contract
     already names the artist on-chain (`get-artist-address`, the wallet
     receiving mint + royalty payouts). Anyone calls
     `sync-artist-from-collection` and the registry mirrors it. Example:
     `bitcoin-pepe` exposes `artist-address` this way.
   - **Curated (everything else).** The artist posts their Stacks address
     from their known identity, e.g. a tweet from `@their_handle`. No
     doxxing needed - pseudonymous handle + wallet is the identity. The
     registry owner calls `set-artist(nft-contract, artist, x-handle,
     evidence-uri, lock)` after checking the evidence; the tweet URL is
     stored on-chain. `lock: true` protects the curated entry from being
     overwritten by a later sync (useful when the collection's on-chain
     artist-address is stale or lost).
2. **Propose the license (on-chain, requester).** The requester calls
   `propose-license(nft-contract, license-hash, license-uri, license-name)`.
   `license-hash` is the sha256 of the exact license document bytes.
3. **Sign (on-chain, artist).** The artist calls
   `sign-license(nft-contract, proposal-id, license-hash)` directly from
   their wallet - their client re-hashes the document, so the provided hash
   must match the proposal. The transaction itself IS the signature: the
   artist's key signs the payload containing the document hash. Each
   signature becomes an immutable new license version. The artist can also
   `reject-proposal`.
4. **Verify (anyone, especially the requester).** Hash the document you
   hold and call `is-current-license(nft-contract, hash)` - true means the
   registered artist signed exactly this document and it is the latest
   version.

The evidence bundle for any dispute: the license document itself, its
sha256, the sign-license tx ID (a signature by the artist's key over that
hash), and the public post linking wallet to artist (referenced on-chain
via `evidence-uri`).

## Contract API

Public:

- `set-artist(nft-contract principal, artist principal, x-handle (string-ascii 64), evidence-uri (string-ascii 256), lock bool)` - owner only; registers or rotates the verified artist wallet for a collection. Rejects non-contract collections and contract-principal artists. `lock: true` blocks sync overwrites.
- `sync-artist-from-collection(collection <artist-source>)` - permissionless; registers the wallet the collection itself reports via `get-artist-address` (Gamma template). Fails on admin-locked registrations (u110).
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
u108 proposal-not-pending, u109 hash-mismatch, u110 registration-locked.

## Note on Gamma collections

The Gamma launch template already carries `license-uri` / `license-name`
data-vars with setters gated to `artist-address` or the deployer. So for a
collection like `bitcoin-pepe`, the artist can ALSO point the collection
itself at the new license (`set-license-uri` to an ipfs:// CID of the doc).
This registry complements that with what the template lacks: a requester
proposal flow, an exact-bytes hash commitment, an immutable version
history, and a reject option - and it works for collections without
license fields at all.

## Dev

```
clarinet check
npm install
npm test
```

Clarity 5, tested with @stacks/clarinet-sdk (vitest). 22 tests.

## Example

Collection: `SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe`
