;; license-consent
;; On-chain consent registry for NFT collection license changes.
;;
;; Two roles:
;; - Requester: whoever mandates the document (community, marketplace, dev)
;;   proposes the exact license doc (hash + uri + name) for a collection.
;; - Signer: the verified artist wallet signs a specific pending proposal,
;;   re-asserting its hash. The signed doc is exactly the mandated doc.
;;
;; Identity flow (off-chain): the artist's wallet is credibly linked to a
;; public identity, e.g. an X post from their known handle naming the wallet
;; (or a signed message). The registry admin verifies that evidence and
;; registers the artist wallet for the collection, storing the handle and
;; the evidence URI on-chain alongside it.
;;
;; Each signature becomes a new immutable license version - a change of
;; license is simply the next signed version. Old versions stay readable.

(define-constant OWNER tx-sender)

(define-constant STATUS_PENDING u0)
(define-constant STATUS_SIGNED u1)
(define-constant STATUS_REJECTED u2)

(define-constant ERR_NOT_OWNER (err u100))
(define-constant ERR_NO_ARTIST (err u101))
(define-constant ERR_NOT_ARTIST (err u102))
(define-constant ERR_NOT_NFT_CONTRACT (err u103))
(define-constant ERR_ARTIST_NOT_STANDARD (err u104))
(define-constant ERR_NOT_DIRECT_CALL (err u105))
(define-constant ERR_BAD_HASH (err u106))
(define-constant ERR_NO_PROPOSAL (err u107))
(define-constant ERR_NOT_PENDING (err u108))
(define-constant ERR_HASH_MISMATCH (err u109))

;; nft collection contract -> verified artist wallet + identity evidence
(define-map artists
  principal
  {
    artist: principal,
    x-handle: (string-ascii 64),
    evidence-uri: (string-ascii 256),
    set-at: uint,
  }
)

;; license documents proposed for signature, per collection
(define-map proposals
  { nft-contract: principal, proposal-id: uint }
  {
    license-hash: (buff 32),
    license-uri: (string-ascii 256),
    license-name: (string-ascii 64),
    proposed-by: principal,
    proposed-at: uint,
    status: uint,
  }
)

;; nft collection contract -> number of proposals ever made
(define-map proposal-count principal uint)

;; nft collection contract -> number of signed license versions
(define-map license-count principal uint)

;; every signed license version, immutable once written
(define-map licenses
  { nft-contract: principal, version: uint }
  {
    license-hash: (buff 32),
    license-uri: (string-ascii 256),
    license-name: (string-ascii 64),
    proposal-id: uint,
    proposed-by: principal,
    signed-by: principal,
    signed-at-stacks: uint,
    signed-at-burn: uint,
  }
)

(define-private (is-contract-principal (p principal))
  (match (principal-destruct? p)
    parts (is-some (get name parts))
    parts (is-some (get name parts))
  )
)

;; Admin registers (or rotates) the verified artist wallet for a collection.
;; evidence-uri points at the public wallet<->identity proof (e.g. tweet URL).
(define-public (set-artist
    (nft-contract principal)
    (artist principal)
    (x-handle (string-ascii 64))
    (evidence-uri (string-ascii 256))
  )
  (begin
    (asserts! (is-eq contract-caller OWNER) ERR_NOT_OWNER)
    (asserts! (is-contract-principal nft-contract) ERR_NOT_NFT_CONTRACT)
    (asserts! (not (is-contract-principal artist)) ERR_ARTIST_NOT_STANDARD)
    (map-set artists nft-contract {
      artist: artist,
      x-handle: x-handle,
      evidence-uri: evidence-uri,
      set-at: stacks-block-height,
    })
    (print {
      a: "set-artist",
      nft-contract: nft-contract,
      artist: artist,
      x-handle: x-handle,
      evidence-uri: evidence-uri,
    })
    (ok true)
  )
)

;; Requester proposes a license document for the artist to sign.
;; license-hash is the sha256 of the exact document bytes. Permissionless:
;; only what the artist actually signs carries weight.
(define-public (propose-license
    (nft-contract principal)
    (license-hash (buff 32))
    (license-uri (string-ascii 256))
    (license-name (string-ascii 64))
  )
  (let ((proposal-id (+ (default-to u0 (map-get? proposal-count nft-contract)) u1)))
    (asserts! (is-some (map-get? artists nft-contract)) ERR_NO_ARTIST)
    (asserts! (is-eq (len license-hash) u32) ERR_BAD_HASH)
    (map-set proposal-count nft-contract proposal-id)
    (map-set proposals {
      nft-contract: nft-contract,
      proposal-id: proposal-id,
    } {
      license-hash: license-hash,
      license-uri: license-uri,
      license-name: license-name,
      proposed-by: tx-sender,
      proposed-at: stacks-block-height,
      status: STATUS_PENDING,
    })
    (print {
      a: "propose-license",
      nft-contract: nft-contract,
      proposal-id: proposal-id,
      license-hash: license-hash,
      license-uri: license-uri,
      license-name: license-name,
      proposed-by: tx-sender,
    })
    (ok proposal-id)
  )
)

;; The verified artist signs a pending proposal, re-asserting the document
;; hash (their client re-hashes the doc, so consent binds to exact bytes).
;; Must be called directly from the artist wallet (no contract in between).
(define-public (sign-license
    (nft-contract principal)
    (proposal-id uint)
    (license-hash (buff 32))
  )
  (let (
      (registration (unwrap! (map-get? artists nft-contract) ERR_NO_ARTIST))
      (key { nft-contract: nft-contract, proposal-id: proposal-id })
      (proposal (unwrap! (map-get? proposals key) ERR_NO_PROPOSAL))
      (version (+ (default-to u0 (map-get? license-count nft-contract)) u1))
    )
    (asserts! (is-eq tx-sender contract-caller) ERR_NOT_DIRECT_CALL)
    (asserts! (is-eq tx-sender (get artist registration)) ERR_NOT_ARTIST)
    (asserts! (is-eq (get status proposal) STATUS_PENDING) ERR_NOT_PENDING)
    (asserts! (is-eq license-hash (get license-hash proposal)) ERR_HASH_MISMATCH)
    (map-set proposals key (merge proposal { status: STATUS_SIGNED }))
    (map-set license-count nft-contract version)
    (map-set licenses {
      nft-contract: nft-contract,
      version: version,
    } {
      license-hash: (get license-hash proposal),
      license-uri: (get license-uri proposal),
      license-name: (get license-name proposal),
      proposal-id: proposal-id,
      proposed-by: (get proposed-by proposal),
      signed-by: tx-sender,
      signed-at-stacks: stacks-block-height,
      signed-at-burn: burn-block-height,
    })
    (print {
      a: "sign-license",
      nft-contract: nft-contract,
      proposal-id: proposal-id,
      version: version,
      license-hash: (get license-hash proposal),
      license-uri: (get license-uri proposal),
      license-name: (get license-name proposal),
      artist: tx-sender,
    })
    (ok version)
  )
)

;; The artist declines a pending proposal.
(define-public (reject-proposal
    (nft-contract principal)
    (proposal-id uint)
  )
  (let (
      (registration (unwrap! (map-get? artists nft-contract) ERR_NO_ARTIST))
      (key { nft-contract: nft-contract, proposal-id: proposal-id })
      (proposal (unwrap! (map-get? proposals key) ERR_NO_PROPOSAL))
    )
    (asserts! (is-eq tx-sender contract-caller) ERR_NOT_DIRECT_CALL)
    (asserts! (is-eq tx-sender (get artist registration)) ERR_NOT_ARTIST)
    (asserts! (is-eq (get status proposal) STATUS_PENDING) ERR_NOT_PENDING)
    (map-set proposals key (merge proposal { status: STATUS_REJECTED }))
    (print {
      a: "reject-proposal",
      nft-contract: nft-contract,
      proposal-id: proposal-id,
      artist: tx-sender,
    })
    (ok true)
  )
)

(define-read-only (get-artist (nft-contract principal))
  (map-get? artists nft-contract)
)

(define-read-only (get-proposal-count (nft-contract principal))
  (default-to u0 (map-get? proposal-count nft-contract))
)

(define-read-only (get-proposal
    (nft-contract principal)
    (proposal-id uint)
  )
  (map-get? proposals {
    nft-contract: nft-contract,
    proposal-id: proposal-id,
  })
)

(define-read-only (get-license-count (nft-contract principal))
  (default-to u0 (map-get? license-count nft-contract))
)

(define-read-only (get-license
    (nft-contract principal)
    (version uint)
  )
  (map-get? licenses {
    nft-contract: nft-contract,
    version: version,
  })
)

(define-read-only (get-current-license (nft-contract principal))
  (map-get? licenses {
    nft-contract: nft-contract,
    version: (get-license-count nft-contract),
  })
)

;; Verifier helper: does this document hash match the currently signed license?
(define-read-only (is-current-license
    (nft-contract principal)
    (document-hash (buff 32))
  )
  (match (get-current-license nft-contract)
    current (is-eq (get license-hash current) document-hash)
    false
  )
)
