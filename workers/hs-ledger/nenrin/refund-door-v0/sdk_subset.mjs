// sdk_subset.mjs: the five functions of agent-passport-system 8.0.1 the aps-receipt adapter calls, imported from the
// package files themselves so that a worker bundles these and what they import, not the whole SDK (whose index also
// loads Node's child_process, net and dns). The package is the one the adapter installs from its lockfile
// (../musubi-v0/adapters/aps_receipt, npm ci --ignore-scripts). A worker cannot digest it at run time, so
// refund_door_v0.test.mjs and the deploy check it against PINS.json (the adapter's pinnedSdk) and check that each file
// below and each file it imports lies inside that pinned package.
const P = "../musubi-v0/adapters/aps_receipt/node_modules/agent-passport-system/dist/src/";
export const SDK_ENTRY_FILES = [P + "v2/receipt-core/receipt.js", P + "v2/receipt-core/composite.js", P + "v2/action-reference/v2.js"];
export { verifyReceiptV1 } from "../musubi-v0/adapters/aps_receipt/node_modules/agent-passport-system/dist/src/v2/receipt-core/receipt.js";
export { verifyReceiptWithDecisionV1 } from "../musubi-v0/adapters/aps_receipt/node_modules/agent-passport-system/dist/src/v2/receipt-core/composite.js";
export { computeActionRefV2, computePayloadRefV1, validateActionReferenceInputV2 } from "../musubi-v0/adapters/aps_receipt/node_modules/agent-passport-system/dist/src/v2/action-reference/v2.js";
