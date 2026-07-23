(define-constant OWNER tx-sender)

(define-constant STATUS_PENDING u0)
(define-constant STATUS_SIGNED u1)
(define-constant STATUS_REJECTED u2)

(define-constant ERR_NOT_OWNER (err u100))
(define-constant ERR_NO_ARTIST (err u101))
(define-constant ERR_NOT_ARTIST (err u102))
(define-constant ERR_NOT_NFT_CONTRACT (err u103))
(define-constant ERR_BAD_HASH (err u106))
(define-constant ERR_NO_PROPOSAL (err u107))
(define-constant ERR_NOT_PENDING (err u108))
(define-constant ERR_HASH_MISMATCH (err u109))
(define-constant ERR_LOCKED (err u110))
(define-constant ERR_NOT_AUTHORIZED (err u111))

(define-trait artist-source (
  (get-artist-address () (response principal uint))
))

(define-map artists
  principal
  {
    artist: principal,
    x-handle: (string-ascii 64),
    evidence-uri: (string-ascii 256),
    set-at: uint,
    locked: bool,
  }
)

(define-map collection-managers principal principal)

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

(define-map proposal-count principal uint)

(define-map license-count principal uint)

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

(define-public (set-collection-manager
    (nft-contract principal)
    (manager principal)
  )
  (begin
    (asserts! (is-eq contract-caller OWNER) ERR_NOT_OWNER)
    (map-set collection-managers nft-contract manager)
    (print { a: "set-collection-manager", nft-contract: nft-contract, manager: manager })
    (ok true)
  )
)

(define-public (remove-collection-manager (nft-contract principal))
  (begin
    (asserts! (is-eq contract-caller OWNER) ERR_NOT_OWNER)
    (map-delete collection-managers nft-contract)
    (print { a: "remove-collection-manager", nft-contract: nft-contract })
    (ok true)
  )
)

(define-private (is-manager-of (nft-contract principal) (who principal))
  (is-eq (some who) (map-get? collection-managers nft-contract))
)

(define-public (set-artist
    (nft-contract principal)
    (artist principal)
    (x-handle (string-ascii 64))
    (evidence-uri (string-ascii 256))
    (lock bool)
  )
  (begin
    (asserts!
      (or
        (is-eq contract-caller OWNER)
        (and (is-manager-of nft-contract contract-caller) (is-eq artist contract-caller))
      )
      ERR_NOT_AUTHORIZED
    )
    (asserts! (is-contract-principal nft-contract) ERR_NOT_NFT_CONTRACT)
    (map-set artists nft-contract {
      artist: artist,
      x-handle: x-handle,
      evidence-uri: evidence-uri,
      set-at: stacks-block-height,
      locked: lock,
    })
    (print {
      a: "set-artist",
      nft-contract: nft-contract,
      artist: artist,
      x-handle: x-handle,
      evidence-uri: evidence-uri,
      locked: lock,
    })
    (ok true)
  )
)

(define-public (sync-artist-from-collection (collection <artist-source>))
  (let (
      (nft-contract (contract-of collection))
      (artist (try! (contract-call? collection get-artist-address)))
    )
    (asserts! (not (default-to false (get locked (map-get? artists nft-contract))))
      ERR_LOCKED
    )
    (map-set artists nft-contract {
      artist: artist,
      x-handle: "",
      evidence-uri: "collection:get-artist-address",
      set-at: stacks-block-height,
      locked: false,
    })
    (print {
      a: "sync-artist",
      nft-contract: nft-contract,
      artist: artist,
    })
    (ok artist)
  )
)

(define-public (claim-artist
    (collection <artist-source>)
    (x-handle (string-ascii 64))
    (evidence-uri (string-ascii 256))
  )
  (let (
      (nft-contract (contract-of collection))
      (onchain-artist (try! (contract-call? collection get-artist-address)))
    )
    (asserts! (is-eq contract-caller onchain-artist) ERR_NOT_ARTIST)
    (asserts! (not (default-to false (get locked (map-get? artists nft-contract))))
      ERR_LOCKED
    )
    (map-set artists nft-contract {
      artist: onchain-artist,
      x-handle: x-handle,
      evidence-uri: evidence-uri,
      set-at: stacks-block-height,
      locked: false,
    })
    (print {
      a: "claim-artist",
      nft-contract: nft-contract,
      artist: onchain-artist,
      x-handle: x-handle,
      evidence-uri: evidence-uri,
    })
    (ok onchain-artist)
  )
)

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
    (asserts! (is-eq contract-caller (get artist registration)) ERR_NOT_ARTIST)
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
      signed-by: contract-caller,
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
      artist: contract-caller,
    })
    (ok version)
  )
)

(define-public (reject-proposal
    (nft-contract principal)
    (proposal-id uint)
  )
  (let (
      (registration (unwrap! (map-get? artists nft-contract) ERR_NO_ARTIST))
      (key { nft-contract: nft-contract, proposal-id: proposal-id })
      (proposal (unwrap! (map-get? proposals key) ERR_NO_PROPOSAL))
    )
    (asserts! (is-eq contract-caller (get artist registration)) ERR_NOT_ARTIST)
    (asserts! (is-eq (get status proposal) STATUS_PENDING) ERR_NOT_PENDING)
    (map-set proposals key (merge proposal { status: STATUS_REJECTED }))
    (print {
      a: "reject-proposal",
      nft-contract: nft-contract,
      proposal-id: proposal-id,
      artist: contract-caller,
    })
    (ok true)
  )
)

(define-read-only (get-artist (nft-contract principal))
  (map-get? artists nft-contract)
)

(define-read-only (get-collection-manager (nft-contract principal))
  (map-get? collection-managers nft-contract)
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

(define-read-only (is-current-license
    (nft-contract principal)
    (document-hash (buff 32))
  )
  (match (get-current-license nft-contract)
    current (is-eq (get license-hash current) document-hash)
    false
  )
)
