;; Minimal Gamma-template surface for testing sync-artist-from-collection.
;; Mirrors bitcoin-pepe's artist-address var + getter/setter gating.
(define-constant DEPLOYER tx-sender)

(define-data-var artist-address principal tx-sender)

(define-public (set-artist-address (address principal))
  (begin
    (asserts!
      (or
        (is-eq tx-sender (var-get artist-address))
        (is-eq tx-sender DEPLOYER)
      )
      (err u105)
    )
    (ok (var-set artist-address address))
  )
)

(define-read-only (get-artist-address)
  (ok (var-get artist-address))
)
