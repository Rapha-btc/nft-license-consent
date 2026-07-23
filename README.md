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

1. **Identify the artist wallet.** Three paths, matched to what the
   collection exposes on-chain:
   - **Trustless sync (collections that name their artist on-chain).** The
     collection already exposes `get-artist-address` (the wallet receiving
     mint + royalty payouts). Anyone calls `sync-artist-from-collection`
     and the registry mirrors it (bare, no handle). Example: `bitcoin-pepe`.
   - **Self-claim (same collections, richer).** The artist the collection
     names calls `claim-artist(collection, x-handle, evidence-uri)`
     themselves - no admin - proving control by being the caller that
     matches `get-artist-address`, and attaching their own handle +
     evidence.
   - **Admin-curated (collections with NO on-chain artist reference).**
     Nothing on-chain says who the artist is, so a vouching principal
     registers them: the artist posts their Stacks address from their known
     identity (e.g. a tweet from `@their_handle` - pseudonymous, no doxxing),
     and `set-artist(nft-contract, artist, x-handle, evidence-uri, lock)` is
     called after checking it. `lock: true` protects the curated entry from
     being overwritten by a later sync/claim. `set-artist` is callable by
     `OWNER` (may register any artist) or by a per-collection manager that
     `OWNER` designates via `set-collection-manager` - a manager may only
     register ITSELF as the artist. Intended flow: a backend logs the artist
     in with X (proves the handle) and has them sign a wallet message (proves
     the address), stores the `@handle <-> SP...` link, then as `OWNER`
     designates that wallet with `set-collection-manager`; the artist's own
     wallet then calls `set-artist` to complete the consent on-chain.

   The artist wallet may be an **EOA or a contract** (a smart wallet / safe).
   Signing is gated on `contract-caller == artist`, so a safe signs by being
   the immediate caller; a plain wallet signs with a direct tx.
2. **Propose the license (on-chain, requester).** The requester calls
   `propose-license(nft-contract, license-hash, license-uri, license-name)`.
   `license-hash` is the sha256 of the exact license document bytes.
3. **Sign (on-chain, artist).** The artist calls
   `sign-license(nft-contract, proposal-id, license-hash)` from their wallet
   - their client re-hashes the document, so the provided hash must match the
   proposal. The transaction itself IS the signature: the artist's key
   authorizes a payload containing the document hash. Each signature becomes
   an immutable new license version. The artist can also `reject-proposal`.
   The signer may be an EOA or a contract (smart wallet / safe); the gate is
   `contract-caller == artist`.
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

- `set-artist(nft-contract principal, artist principal, x-handle (string-ascii 64), evidence-uri (string-ascii 256), lock bool)` - callable by OWNER or the collection's designated manager; OWNER registers any artist; a delegated manager may register only itself. For collections with no on-chain artist reference. Rejects non-contract collections. Artist may be an EOA or a contract. `lock: true` blocks sync/claim overwrites.
- `set-collection-manager(nft-contract principal, manager principal)` / `remove-collection-manager(nft-contract principal)` - owner only; delegates (or revokes) the set-artist right for one collection to `manager`.
- `sync-artist-from-collection(collection <artist-source>)` - permissionless; mirrors the wallet the collection reports via `get-artist-address`. Fails on admin-locked registrations (u110).
- `claim-artist(collection <artist-source>, x-handle (string-ascii 64), evidence-uri (string-ascii 256))` - the on-chain artist self-registers (caller must equal `get-artist-address`), attaching handle + evidence. No admin. Fails on admin-locked registrations (u110).
- `propose-license(nft-contract principal, license-hash (buff 32), license-uri (string-ascii 256), license-name (string-ascii 64))` - permissionless (only what the artist signs carries weight); requires a registered artist. Returns the proposal id.
- `sign-license(nft-contract principal, proposal-id uint, license-hash (buff 32))` - gated on `contract-caller == artist` (EOA or contract), hash must match the proposal. Returns the new version number.
- `reject-proposal(nft-contract principal, proposal-id uint)` - artist only; closes a pending proposal.

Read-only:

- `get-artist(nft-contract)` - registration record or none
- `get-collection-manager(nft-contract)` - the delegated manager principal or none
- `get-proposal-count(nft-contract)` / `get-proposal(nft-contract, id)` - proposal queue (status: 0 pending, 1 signed, 2 rejected)
- `get-license-count(nft-contract)` - number of signed versions
- `get-license(nft-contract, version)` - a specific signed version
- `get-current-license(nft-contract)` - latest signed version
- `is-current-license(nft-contract, document-hash)` - true if the hash matches the latest signed license

Errors: u100 not-owner, u101 no-artist-registered, u102 not-the-artist,
u103 collection-not-a-contract, u106 bad-hash-length, u107 no-such-proposal,
u108 proposal-not-pending, u109 hash-mismatch, u110 registration-locked,
u111 not-authorized (set-artist caller is neither owner nor the collection's
manager). (u104/u105 retired: the artist may be a contract, so a
standard-principal and direct-EOA-call requirement no longer apply.)

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
npm test              # 35 unit tests (clarinet-sdk / vitest)
npm run verify:mainnet  # stxer mainnet-fork against the REAL bitcoin-pepe
```

Clarity 5, tested with @stacks/clarinet-sdk (vitest). 35 tests.

### Mainnet-fork verification

`npm run verify:mainnet` deploys the contract on a Stacks mainnet fork (stxer)
and drives the full lifecycle against the **real** `bitcoin-pepe` collection -
the real on-chain artist wallet signs the SHA-256 of an actual license PDF.
This proves what the mocked unit tests cannot: the `<artist-source>` trait
dispatches against the real collection (whose `get-artist-address` returns
`(response principal none)` vs the trait's `(response principal uint)`), and
`is-current-license` verifies exact document bytes on-chain.

**37 / 37 passed** - see [simulations/RESULTS-mainnet.md](simulations/RESULTS-mainnet.md)
and the run: https://stxer.xyz/simulations/mainnet/861a3608c0d136f6650b339d043f1245

## Example

Collection: `SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe`
