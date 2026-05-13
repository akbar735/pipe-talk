import { ISocketExtended, ITransferState } from "./types.js";

export const clientsList = new Map<string, ISocketExtended>()
export const activeTransfer = new Map<string, ITransferState>();