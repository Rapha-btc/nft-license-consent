// verify-mainnet.mjs
// SELF-VERIFYING stxer mainnet-fork harness for license-consent.clar
//
// Deploys the registry against the REAL mainnet bitcoin-pepe collection
// (SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe) and drives the
// full consent lifecycle with assertions on every step. The key things this
// proves that clarinet/simnet CANNOT (no real collection, no real artist):
//
//   1. The <artist-source> trait actually dispatches against the REAL
//      bitcoin-pepe, whose get-artist-address returns (response principal none)
//      while our trait declares (response principal uint). If trait conformance
//      failed, sync-artist-from-collection would abort here.
//   2. The REAL on-chain artist wallet (SM2J5..., Marie) signs the REAL PDF
//      hash of Bitcoin-Pepe-Marie-License-Amendment.pdf. The on-chain signature
//      IS the consent - no wet signature in the document is needed.
//   3. is-current-license verifies the exact PDF bytes on-chain.
//
// Run:  npm run verify:mainnet
//
// stxer routes tip-fetch through stacksNodeAPI (the juice box full Stacks API)
// to dodge Hiro 429s. Override with STACKS_API=... if the box is unreachable.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ClarityVersion,
  uintCV, bufferCV, stringAsciiCV, boolCV,
  standardPrincipalCV, contractPrincipalCV,
  deserializeCV, cvToString,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const STACKS_API = process.env.STACKS_API || "http://77.42.3.101/stacks-api";

// ---- principals ----
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"; // OWNER (tx-sender at deploy)
const ARTIST   = "SM2J5VCY4DCFX6VZYDANHMXA3VN9DMWYCEK7Y8D93"; // REAL bitcoin-pepe artist (Marie)
const REQUESTER= "SP3WAAYXPC6WZNEC7SHGR36D32RJPZVXRR1BG0QSY"; // proposes the license doc
const STRANGER = "SP000000000000000000002Q6VF78";             // guard sender, no rights

const PEPE_ADDR = "SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ";
const PEPE_NAME = "bitcoin-pepe";
const PEPE = `${PEPE_ADDR}.${PEPE_NAME}`;
const UNREGISTERED = "SP3JNSEXAZP4BDSHV0DN3M8R3P0MY0EEBQQZX743X.xtrata-v3-2-3"; // a contract w/ no artist

const NAME = "license-consent";
const CID  = `${DEPLOYER}.${NAME}`;

// ---- the REAL document ----
// sha256(Bitcoin-Pepe-Marie-License-Amendment.pdf)
const DOC_HASH  = "0x7653fa09eb5bc7dc257319feb2715376a2d1707e7769b639cfb2e2e8547e18e6";
const DOC_URI   = "https://arweave.net/Bitcoin-Pepe-Marie-License-Amendment";
const DOC_NAME  = "Bitcoin Pepe x Marie License Amendment";
// v2 (a later license change) + v3 (rejected)
const HASH_V2   = "0x" + "22".repeat(32);
const HASH_V3   = "0x" + "33".repeat(32);
const BAD_HASH  = "0x" + "ff".repeat(32);
const SHORT_HASH= "0x" + "ab".repeat(31); // 31 bytes -> ERR_BAD_HASH

const buf = (h) => bufferCV(Buffer.from(h.replace(/^0x/, ""), "hex"));
const pepeCV = contractPrincipalCV(PEPE_ADDR, PEPE_NAME);
const unregCV = contractPrincipalCV(...UNREGISTERED.split(/\.(.+)/));

// ---- builder + assertion plan ----
const plan = [];
const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_API });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(__dirname, "..", "contracts", "license-consent.clar"),
  "utf8",
);

function deploy() {
  b.withSender(DEPLOYER).addContractDeploy({
    contract_name: NAME, source_code: src, clarity_version: ClarityVersion.Clarity5,
  });
  plan.push({ kind: "deploy", label: `deploy ${NAME} (Clarity5) as OWNER=${DEPLOYER}` });
}
function call(label, sender, fn, args, expect) {
  b.withSender(sender).addContractCall({ contract_id: CID, function_name: fn, function_args: args });
  plan.push({ kind: "tx", label, expect });
}
function evalc(label, code, expect, capture) {
  b.addEvalCode(CID, code);
  plan.push({ kind: "eval", label, expect, capture });
}

// =====================================================================
// Scenario against REAL bitcoin-pepe
// =====================================================================
deploy();

// --- sanity: the real collection names Marie on-chain ---
evalc("real bitcoin-pepe get-artist-address == Marie",
  `(contract-call? '${PEPE} get-artist-address)`, `(ok ${ARTIST})`);

// --- TRAIT TEST: trustless sync against the real collection (anyone) ---
call("sync-artist-from-collection(bitcoin-pepe) by stranger -> (ok Marie)  [TRAIT DISPATCH]",
  STRANGER, "sync-artist-from-collection", [pepeCV], `(ok ${ARTIST})`);
evalc("get-artist(pepe): artist==Marie, evidence==collection:get-artist-address, unlocked",
  `(get-artist '${PEPE})`,
  new RegExp(`artist ${ARTIST}.*evidence-uri "collection:get-artist-address".*locked false`));

// --- propose guards ---
call("propose on unregistered collection -> ERR_NO_ARTIST (u101)",
  REQUESTER, "propose-license",
  [unregCV, buf(DOC_HASH), stringAsciiCV(DOC_URI), stringAsciiCV(DOC_NAME)], "(err u101)");
call("propose-license v1 (real PDF hash) -> (ok u1)",
  REQUESTER, "propose-license",
  [pepeCV, buf(DOC_HASH), stringAsciiCV(DOC_URI), stringAsciiCV(DOC_NAME)], "(ok u1)");
call("propose with 31-byte hash -> ERR_BAD_HASH (u106)",
  REQUESTER, "propose-license",
  [pepeCV, buf(SHORT_HASH), stringAsciiCV(DOC_URI), stringAsciiCV(DOC_NAME)], "(err u106)");

// --- sign guards, then the REAL artist signs the REAL PDF hash ---
call("sign by stranger (not artist) -> ERR_NOT_ARTIST (u102)",
  STRANGER, "sign-license", [pepeCV, uintCV(1), buf(DOC_HASH)], "(err u102)");
call("sign by Marie, wrong hash -> ERR_HASH_MISMATCH (u109)",
  ARTIST, "sign-license", [pepeCV, uintCV(1), buf(BAD_HASH)], "(err u109)");
call("sign a missing proposal -> ERR_NO_PROPOSAL (u107)",
  ARTIST, "sign-license", [pepeCV, uintCV(99), buf(DOC_HASH)], "(err u107)");
call("sign-license v1 by Marie (real artist, real PDF hash) -> (ok u1)  [CONSENT]",
  ARTIST, "sign-license", [pepeCV, uintCV(1), buf(DOC_HASH)], "(ok u1)");

// --- the signed license is exactly the PDF, signed by Marie ---
evalc("current license: signed-by Marie, hash==PDF, name matches",
  `(get-current-license '${PEPE})`,
  new RegExp(`license-hash ${DOC_HASH}.*license-name "${DOC_NAME}".*signed-by ${ARTIST}`));
evalc("is-current-license(pepe, PDF hash) == true", `(is-current-license '${PEPE} ${DOC_HASH})`, "true");
evalc("is-current-license(pepe, other hash) == false", `(is-current-license '${PEPE} ${BAD_HASH})`, "false");
call("re-sign the same proposal -> ERR_NOT_PENDING (u108)",
  ARTIST, "sign-license", [pepeCV, uintCV(1), buf(DOC_HASH)], "(err u108)");

// --- a license CHANGE is simply the next signed version ---
call("propose-license v2 -> (ok u2)",
  REQUESTER, "propose-license",
  [pepeCV, buf(HASH_V2), stringAsciiCV("ipfs://amendment-v2"), stringAsciiCV("Amendment v2")], "(ok u2)");
call("sign-license v2 by Marie -> (ok u2)",
  ARTIST, "sign-license", [pepeCV, uintCV(2), buf(HASH_V2)], "(ok u2)");
evalc("license-count == 2", `(get-license-count '${PEPE})`, "u2");
evalc("v1 still readable (immutable history)", `(get-license '${PEPE} u1)`,
  new RegExp(`license-hash ${DOC_HASH}`));
evalc("current is now v2", `(get-current-license '${PEPE})`, new RegExp(`license-hash ${HASH_V2}`));
evalc("old PDF hash is no longer current", `(is-current-license '${PEPE} ${DOC_HASH})`, "false");

// --- reject flow ---
call("propose-license v3 -> (ok u3)",
  REQUESTER, "propose-license",
  [pepeCV, buf(HASH_V3), stringAsciiCV("ipfs://amendment-v3"), stringAsciiCV("Amendment v3")], "(ok u3)");
call("reject v3 by stranger -> ERR_NOT_ARTIST (u102)",
  STRANGER, "reject-proposal", [pepeCV, uintCV(3)], "(err u102)");
call("reject v3 by Marie -> (ok true)", ARTIST, "reject-proposal", [pepeCV, uintCV(3)], "(ok true)");
call("sign a rejected proposal -> ERR_NOT_PENDING (u108)",
  ARTIST, "sign-license", [pepeCV, uintCV(3), buf(HASH_V3)], "(err u108)");

// --- claim-artist: self-registration by the on-chain artist ---
call("claim-artist by stranger (not the on-chain artist) -> ERR_NOT_ARTIST (u102)",
  STRANGER, "claim-artist",
  [pepeCV, stringAsciiCV("Mandarinemarie_"), stringAsciiCV("https://x.com/Mandarinemarie_/status/1")], "(err u102)");
call("claim-artist by Marie (self) -> (ok Marie)",
  ARTIST, "claim-artist",
  [pepeCV, stringAsciiCV("Mandarinemarie_"), stringAsciiCV("https://x.com/Mandarinemarie_/status/1")], `(ok ${ARTIST})`);
evalc("get-artist(pepe): x-handle now Mandarinemarie_",
  `(get-artist '${PEPE})`, new RegExp(`x-handle "Mandarinemarie_"`));

// --- owner / manager guards ---
call("set-artist by stranger -> ERR_NOT_AUTHORIZED (u111)",
  STRANGER, "set-artist",
  [pepeCV, standardPrincipalCV(STRANGER), stringAsciiCV(""), stringAsciiCV(""), boolCV(false)],
  "(err u111)");
call("set-collection-manager by stranger -> ERR_NOT_OWNER (u100)",
  STRANGER, "set-collection-manager", [pepeCV, standardPrincipalCV(STRANGER)], "(err u100)");
call("set-artist with a STANDARD principal as nft-contract -> ERR_NOT_NFT_CONTRACT (u103)",
  DEPLOYER, "set-artist",
  [standardPrincipalCV(REQUESTER), standardPrincipalCV(ARTIST), stringAsciiCV(""), stringAsciiCV(""), boolCV(false)],
  "(err u103)");

// manager delegation: owner delegates, manager may only register ITSELF
call("owner delegates manager=requester for pepe -> (ok true)",
  DEPLOYER, "set-collection-manager", [pepeCV, standardPrincipalCV(REQUESTER)], "(ok true)");
call("manager registers ITSELF as artist -> (ok true)",
  REQUESTER, "set-artist",
  [pepeCV, standardPrincipalCV(REQUESTER), stringAsciiCV("desk"), stringAsciiCV("evidence"), boolCV(false)],
  "(ok true)");
call("manager tries to register SOMEONE ELSE -> ERR_NOT_AUTHORIZED (u111)",
  REQUESTER, "set-artist",
  [pepeCV, standardPrincipalCV(STRANGER), stringAsciiCV(""), stringAsciiCV(""), boolCV(false)],
  "(err u111)");

// --- lock: admin-locked registration cannot be overwritten (LAST) ---
call("owner set-artist(pepe, Marie, lock=true) -> (ok true)",
  DEPLOYER, "set-artist",
  [pepeCV, standardPrincipalCV(ARTIST), stringAsciiCV("Mandarinemarie_"),
   stringAsciiCV("https://x.com/Mandarinemarie_/status/1"), boolCV(true)],
  "(ok true)");
call("sync over a locked entry -> ERR_LOCKED (u110)",
  STRANGER, "sync-artist-from-collection", [pepeCV], "(err u110)");
call("claim over a locked entry -> ERR_LOCKED (u110)",
  ARTIST, "claim-artist",
  [pepeCV, stringAsciiCV("x"), stringAsciiCV("y")], "(err u110)");

// =====================================================================
// Run + verify
// =====================================================================
function decodeTx(s) {
  const r = s?.Result?.Transaction;
  if (!r) return "<no tx result>";
  if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err)}`;
  try { return cvToString(deserializeCV(r.Ok.result)); }
  catch (e) { return `decode-failed(${r.Ok?.result}): ${e.message}`; }
}
function decodeEval(s) {
  const r = s?.Result?.Eval;
  if (!r) return "<no eval result>";
  if (!("Ok" in r)) return `ERR: ${JSON.stringify(r.Err)}`;
  try { return cvToString(deserializeCV(r.Ok)); } catch { return String(r.Ok); }
}
const match = (got, expect) => (expect instanceof RegExp ? expect.test(got) : got === expect);

async function main() {
  console.log("=== license-consent SELF-VERIFYING stxer harness (REAL bitcoin-pepe) ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);

  const res = await getSimulationResult(sessionId);
  const steps = res.steps;
  let pass = 0, fail = 0;

  steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "deploy") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "✅" : "❌"} [${i}] ${p.label} -> ${decodeTx(s)}`);
      ok ? pass++ : fail++;
    } else {
      const got = p.kind === "tx" ? decodeTx(s) : decodeEval(s);
      if (p.expect === undefined) { console.log(`ℹ️  [${i}] ${p.label}: ${got}`); return; }
      const ok = match(got, p.expect);
      console.log(`${ok ? "✅" : "❌"} [${i}] ${p.label}\n        got ${got}${ok ? "" : `  EXPECTED ${p.expect}`}`);
      ok ? pass++ : fail++;
    }
  });

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(`View: ${url}`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
