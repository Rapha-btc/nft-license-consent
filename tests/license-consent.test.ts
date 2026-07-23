import { describe, expect, it } from "vitest";
import { Cl, cvToJSON } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!; // OWNER (set at deploy via tx-sender)
const artist = accounts.get("wallet_1")!;
const requester = accounts.get("wallet_2")!;
const newArtist = accounts.get("wallet_3")!;

const C = "license-consent";

// any contract principal works as the "nft collection" key; reuse our own
const nftContract = Cl.contractPrincipal(deployer, C);

const HASH_V1 = new Uint8Array(32).fill(1);
const HASH_V2 = new Uint8Array(32).fill(2);
const X_HANDLE = "Mandarinemarie_";
const EVIDENCE = "https://x.com/Mandarinemarie_/status/123";
const LICENSE_URI = "ipfs://bafy-license-doc-v1";
const LICENSE_NAME = "CC BY-NC 4.0";

const mockCollection = Cl.contractPrincipal(deployer, "mock-gamma-collection");

function registerArtist(wallet: string = artist, lock = false) {
  return simnet.callPublicFn(
    C,
    "set-artist",
    [
      nftContract,
      Cl.principal(wallet),
      Cl.stringAscii(X_HANDLE),
      Cl.stringAscii(EVIDENCE),
      Cl.bool(lock),
    ],
    deployer
  );
}

function proposeLicense(
  hash: Uint8Array = HASH_V1,
  uri: string = LICENSE_URI,
  name: string = LICENSE_NAME,
  sender: string = requester
) {
  return simnet.callPublicFn(
    C,
    "propose-license",
    [nftContract, Cl.buffer(hash), Cl.stringAscii(uri), Cl.stringAscii(name)],
    sender
  );
}

function signLicense(
  sender: string,
  proposalId: number = 1,
  hash: Uint8Array = HASH_V1
) {
  return simnet.callPublicFn(
    C,
    "sign-license",
    [nftContract, Cl.uint(proposalId), Cl.buffer(hash)],
    sender
  );
}

describe("set-artist", function () {
  it("owner registers an artist for a collection", function () {
    const { result } = registerArtist();
    expect(result).toBeOk(Cl.bool(true));

    const stored = simnet.callReadOnlyFn(C, "get-artist", [nftContract], deployer);
    const json = cvToJSON(stored.result);
    expect(json.value.value.artist.value).toBe(artist);
    expect(json.value.value["x-handle"].value).toBe(X_HANDLE);
    expect(json.value.value["evidence-uri"].value).toBe(EVIDENCE);
  });

  it("rejects non-owner", function () {
    const { result } = simnet.callPublicFn(
      C,
      "set-artist",
      [nftContract, Cl.principal(artist), Cl.stringAscii(X_HANDLE), Cl.stringAscii(EVIDENCE), Cl.bool(false)],
      requester
    );
    expect(result).toBeErr(Cl.uint(100));
  });

  it("rejects a standard principal as the nft collection", function () {
    const { result } = simnet.callPublicFn(
      C,
      "set-artist",
      [Cl.principal(requester), Cl.principal(artist), Cl.stringAscii(X_HANDLE), Cl.stringAscii(EVIDENCE), Cl.bool(false)],
      deployer
    );
    expect(result).toBeErr(Cl.uint(103));
  });

  it("rejects a contract principal as the artist wallet", function () {
    const { result } = simnet.callPublicFn(
      C,
      "set-artist",
      [nftContract, nftContract, Cl.stringAscii(X_HANDLE), Cl.stringAscii(EVIDENCE), Cl.bool(false)],
      deployer
    );
    expect(result).toBeErr(Cl.uint(104));
  });
});

describe("sync-artist-from-collection", function () {
  function syncArtist(sender: string = requester) {
    return simnet.callPublicFn(C, "sync-artist-from-collection", [mockCollection], sender);
  }

  it("anyone registers the collection's on-chain artist-address", function () {
    // point the mock collection at the artist wallet (deployer is initial)
    simnet.callPublicFn(
      "mock-gamma-collection",
      "set-artist-address",
      [Cl.principal(artist)],
      deployer
    );

    const { result } = syncArtist();
    expect(result).toBeOk(Cl.principal(artist));

    const stored = simnet.callReadOnlyFn(C, "get-artist", [mockCollection], deployer);
    const json = cvToJSON(stored.result);
    expect(json.value.value.artist.value).toBe(artist);
    expect(json.value.value["evidence-uri"].value).toBe("collection:get-artist-address");
    expect(json.value.value.locked.value).toBe(false);

    // the synced artist can sign proposals
    simnet.callPublicFn(
      C,
      "propose-license",
      [mockCollection, Cl.buffer(HASH_V1), Cl.stringAscii(LICENSE_URI), Cl.stringAscii(LICENSE_NAME)],
      requester
    );
    const signed = simnet.callPublicFn(
      C,
      "sign-license",
      [mockCollection, Cl.uint(1), Cl.buffer(HASH_V1)],
      artist
    );
    expect(signed.result).toBeOk(Cl.uint(1));
  });

  it("re-sync follows an artist-address rotation on the collection", function () {
    syncArtist();
    simnet.callPublicFn(
      "mock-gamma-collection",
      "set-artist-address",
      [Cl.principal(newArtist)],
      deployer
    );
    const { result } = syncArtist();
    expect(result).toBeOk(Cl.principal(newArtist));
  });

  it("cannot overwrite an admin-locked registration", function () {
    simnet.callPublicFn(
      C,
      "set-artist",
      [mockCollection, Cl.principal(artist), Cl.stringAscii(X_HANDLE), Cl.stringAscii(EVIDENCE), Cl.bool(true)],
      deployer
    );
    const { result } = syncArtist();
    expect(result).toBeErr(Cl.uint(110));
  });

  it("overwrites an unlocked admin registration (collection is authoritative)", function () {
    simnet.callPublicFn(
      C,
      "set-artist",
      [mockCollection, Cl.principal(newArtist), Cl.stringAscii(X_HANDLE), Cl.stringAscii(EVIDENCE), Cl.bool(false)],
      deployer
    );
    const { result } = syncArtist();
    // mock's artist-address is still its deployer here
    expect(result).toBeOk(Cl.principal(deployer));
  });
});

describe("propose-license", function () {
  it("rejects proposals for an unregistered collection", function () {
    const { result } = proposeLicense();
    expect(result).toBeErr(Cl.uint(101));
  });

  it("anyone can propose once an artist is registered; ids increment", function () {
    registerArtist();
    expect(proposeLicense().result).toBeOk(Cl.uint(1));
    expect(proposeLicense(HASH_V2).result).toBeOk(Cl.uint(2));

    const count = simnet.callReadOnlyFn(C, "get-proposal-count", [nftContract], deployer);
    expect(count.result).toBeUint(2);

    const stored = simnet.callReadOnlyFn(
      C,
      "get-proposal",
      [nftContract, Cl.uint(1)],
      deployer
    );
    const json = cvToJSON(stored.result);
    expect(json.value.value["proposed-by"].value).toBe(requester);
    expect(json.value.value.status.value).toBe("0"); // pending
  });

  it("rejects a hash shorter than 32 bytes", function () {
    registerArtist();
    const { result } = proposeLicense(new Uint8Array(31).fill(1));
    expect(result).toBeErr(Cl.uint(106));
  });
});

describe("sign-license", function () {
  it("rejects a missing proposal", function () {
    registerArtist();
    const { result } = signLicense(artist, 1);
    expect(result).toBeErr(Cl.uint(107));
  });

  it("rejects a non-artist wallet", function () {
    registerArtist();
    proposeLicense();
    const { result } = signLicense(requester);
    expect(result).toBeErr(Cl.uint(102));
  });

  it("rejects a hash that does not match the proposal", function () {
    registerArtist();
    proposeLicense(HASH_V1);
    const { result } = signLicense(artist, 1, HASH_V2);
    expect(result).toBeErr(Cl.uint(109));
  });

  it("artist signs the pending proposal; version 1 readable, proposal marked signed", function () {
    registerArtist();
    proposeLicense();
    const { result } = signLicense(artist);
    expect(result).toBeOk(Cl.uint(1));

    const count = simnet.callReadOnlyFn(C, "get-license-count", [nftContract], deployer);
    expect(count.result).toBeUint(1);

    const current = simnet.callReadOnlyFn(C, "get-current-license", [nftContract], deployer);
    const json = cvToJSON(current.result);
    expect(json.value.value["license-uri"].value).toBe(LICENSE_URI);
    expect(json.value.value["license-name"].value).toBe(LICENSE_NAME);
    expect(json.value.value["signed-by"].value).toBe(artist);
    expect(json.value.value["proposed-by"].value).toBe(requester);
    expect(json.value.value["proposal-id"].value).toBe("1");

    const proposal = simnet.callReadOnlyFn(
      C,
      "get-proposal",
      [nftContract, Cl.uint(1)],
      deployer
    );
    expect(cvToJSON(proposal.result).value.value.status.value).toBe("1"); // signed
  });

  it("rejects double-signing the same proposal", function () {
    registerArtist();
    proposeLicense();
    signLicense(artist);
    const { result } = signLicense(artist);
    expect(result).toBeErr(Cl.uint(108));
  });

  it("a second signed proposal is version 2 and version 1 stays readable", function () {
    registerArtist();
    proposeLicense(HASH_V1, "ipfs://bafy-license-doc-v1", "CC BY-NC 4.0");
    signLicense(artist, 1, HASH_V1);
    proposeLicense(HASH_V2, "ipfs://bafy-license-doc-v2", "CC BY 4.0");
    const { result } = signLicense(artist, 2, HASH_V2);
    expect(result).toBeOk(Cl.uint(2));

    const v1 = simnet.callReadOnlyFn(C, "get-license", [nftContract, Cl.uint(1)], deployer);
    expect(cvToJSON(v1.result).value.value["license-name"].value).toBe("CC BY-NC 4.0");

    const current = simnet.callReadOnlyFn(C, "get-current-license", [nftContract], deployer);
    expect(cvToJSON(current.result).value.value["license-name"].value).toBe("CC BY 4.0");
  });

  it("artist rotation: old artist can no longer sign, new artist can", function () {
    registerArtist();
    proposeLicense();
    registerArtist(newArtist);

    expect(signLicense(artist).result).toBeErr(Cl.uint(102));
    expect(signLicense(newArtist).result).toBeOk(Cl.uint(1));
  });
});

describe("reject-proposal", function () {
  it("artist rejects a pending proposal; it can no longer be signed", function () {
    registerArtist();
    proposeLicense();
    const { result } = simnet.callPublicFn(
      C,
      "reject-proposal",
      [nftContract, Cl.uint(1)],
      artist
    );
    expect(result).toBeOk(Cl.bool(true));

    const proposal = simnet.callReadOnlyFn(
      C,
      "get-proposal",
      [nftContract, Cl.uint(1)],
      deployer
    );
    expect(cvToJSON(proposal.result).value.value.status.value).toBe("2"); // rejected

    expect(signLicense(artist).result).toBeErr(Cl.uint(108));
  });

  it("non-artist cannot reject", function () {
    registerArtist();
    proposeLicense();
    const { result } = simnet.callPublicFn(
      C,
      "reject-proposal",
      [nftContract, Cl.uint(1)],
      requester
    );
    expect(result).toBeErr(Cl.uint(102));
  });
});

describe("is-current-license (requester verification)", function () {
  it("matches only the latest signed hash", function () {
    registerArtist();
    proposeLicense(HASH_V1);
    signLicense(artist, 1, HASH_V1);

    const yes = simnet.callReadOnlyFn(
      C,
      "is-current-license",
      [nftContract, Cl.buffer(HASH_V1)],
      deployer
    );
    expect(yes.result).toBeBool(true);

    proposeLicense(HASH_V2);
    signLicense(artist, 2, HASH_V2);
    const stale = simnet.callReadOnlyFn(
      C,
      "is-current-license",
      [nftContract, Cl.buffer(HASH_V1)],
      deployer
    );
    expect(stale.result).toBeBool(false);
  });

  it("is false for an unregistered collection", function () {
    const { result } = simnet.callReadOnlyFn(
      C,
      "is-current-license",
      [nftContract, Cl.buffer(HASH_V1)],
      deployer
    );
    expect(result).toBeBool(false);
  });
});
