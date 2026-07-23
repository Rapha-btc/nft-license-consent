;; Minimal stand-in for a smart-wallet / safe acting AS the artist principal.
;; When an owner calls sign-through, this contract is the immediate caller of
;; license-consent, so from the registry's view contract-caller = this contract.
;; Registering this contract's principal as the artist lets it sign.
(define-public (sign-through
    (nft-contract principal)
    (proposal-id uint)
    (license-hash (buff 32))
  )
  (contract-call? .license-consent sign-license nft-contract proposal-id license-hash)
)

(define-public (reject-through
    (nft-contract principal)
    (proposal-id uint)
  )
  (contract-call? .license-consent reject-proposal nft-contract proposal-id)
)
