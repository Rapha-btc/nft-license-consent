# stxer mainnet-fork verification

`license-consent.clar` deployed against the **real** mainnet `bitcoin-pepe`
collection and driven through its full lifecycle on a Stacks mainnet fork
(stxer). Every step is asserted.

- **Result: 37 / 37 passed**
- **Simulation:** https://stxer.xyz/simulations/mainnet/861a3608c0d136f6650b339d043f1245
- **Run it yourself:** `npm run verify:mainnet` (see [verify-mainnet.mjs](./verify-mainnet.mjs))

## Why a mainnet fork (not just clarinet)

The unit tests (`npm test`, 35 green) run against a *mock* collection. Three
things can only be proven against the real chain, and this harness proves them:

1. **The `<artist-source>` trait actually dispatches against real `bitcoin-pepe`.**
   Our trait declares `get-artist-address` returning `(response principal uint)`,
   but the real collection returns `(response principal none)`. The `none`
   (NoType) error unifies with `uint`, so trait conformance holds and
   `sync-artist-from-collection` works. A mock that matched the trait exactly
   would have hidden this.
2. **The real on-chain artist wallet signs the real document.**
   `SM2J5VCY4DCFX6VZYDANHMXA3VN9DMWYCEK7Y8D93` (read live from the collection's
   `get-artist-address`) signs the SHA-256 of the actual PDF. The on-chain
   signature *is* the consent - no wet signature in the document is required.
3. **`is-current-license` verifies the exact document bytes on-chain.**

## The document

| | |
|---|---|
| File | `Bitcoin-Pepe-Marie-License-Amendment.pdf` (299,338 bytes) |
| `license-hash` | `0x7653fa09eb5bc7dc257319feb2715376a2d1707e7769b639cfb2e2e8547e18e6` (= `sha256(pdf)`) |
| Signer | `SM2J5VCY4DCFX6VZYDANHMXA3VN9DMWYCEK7Y8D93` (bitcoin-pepe's on-chain artist) |

A verifier re-hashes the PDF themselves and compares to the on-chain
`license-hash` via `is-current-license`. The contract only checks the hash is
32 bytes (the shape of a SHA-256 digest); binding to the exact PDF bytes is the
verifier's own hash comparison.

## What was exercised (all against real bitcoin-pepe)

| Steps | Area |
|---|---|
| 0 | Deploy `license-consent` (Clarity 5), OWNER = deployer |
| 1-3 | Trait dispatch + trustless `sync-artist-from-collection` |
| 4-6 | Propose guards: no-artist (u101), bad-hash-length (u106) |
| 7-10 | Sign guards (u102 not-artist, u109 hash-mismatch, u107 no-proposal) then **Marie signs the PDF hash** |
| 11-14 | Signed license == exact PDF; `is-current-license` true/false; double-sign blocked (u108) |
| 15-20 | License change to v2; v1 stays immutably readable; stale hash no longer current |
| 21-24 | Reject flow; a rejected proposal cannot be signed (u108) |
| 25-27 | `claim-artist` self-registration by the on-chain artist; stranger blocked (u102) |
| 28-33 | Owner/manager guards (u111, u100), standard-principal-as-collection (u103), manager may only register itself |
| 34-36 | Admin-locked registration cannot be overwritten by sync or claim (u110) |

## Notes

- `STACKS_API` defaults to the juice box full Stacks API (dodges Hiro 429s).
  Override with `STACKS_API=<url> npm run verify:mainnet` if unreachable.
- stxer forks mainnet state, so any principal can be used as a sender without a
  signature; the harness sends txs as the real artist, the owner, a requester,
  and a rights-less stranger to exercise every gate.
