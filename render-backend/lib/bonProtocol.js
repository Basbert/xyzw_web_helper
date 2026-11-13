/**
 * Shared BON protocol entry for the Node.js automation backend.
 * Re-exports the single canonical implementation in src/utils/bonProtocol.js.
 */
export {
  bon,
  BonDecoder,
  BonEncoder,
  DataReader,
  DataWriter,
  encode,
  g_utils,
  getEnc,
  Int64,
  parse,
  ProtoMsg,
} from "../../src/utils/bonProtocol.js";
