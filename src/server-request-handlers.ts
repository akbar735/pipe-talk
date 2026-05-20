import { Blue, Green, greetings, OPTIONS, Red, RESET_COLOR, Yellow } from "./constants.js";
import { abortedTransferFileIds, activeTransfer, clientsList } from "./globals.js";
import { processServerPendingFileMessages, stringify } from "./helper.js";
import { IMessage, ISocketExtended, ITransferState, PendingFileMessage, TargetDrainState, Type } from "./types.js";

function buildTransferAbortedMessage(otherUserId: string | undefined, fileId: string | undefined) {
    const userLabel = otherUserId ?? 'The other user';

    return stringify({
        type: Type.TRANSFER_ABORTED,
        from: otherUserId,
        fileId,
        msg: `${userLabel} is no longer connected. Transfer cancelled.`
    })
}

function resetTransferRuntime(socket: ISocketExtended) {
    socket.pendingFileMessages?.splice(0, socket.pendingFileMessages.length);

    if (socket.targetDrainState) {
        socket.targetDrainState.isWaitingForTargetDrain = false;
    }

    socket.resume();
}

export function abortTransferForSender(
    senderSocket: ISocketExtended,
    transfer: ITransferState,
    otherUserId?: string
) {
    const senderId = senderSocket.userId;
    const transferFileId = transfer.fileId ?? '__unknown_transfer__';

    resetTransferRuntime(senderSocket);

    if (senderId && abortedTransferFileIds.get(senderId) === transferFileId) {
        activeTransfer.delete(senderId);
        return
    }

    if (senderId) {
        abortedTransferFileIds.set(senderId, transferFileId);
    }

    if (!senderSocket.destroyed) {
        senderSocket.write(buildTransferAbortedMessage(otherUserId, transfer.fileId));
    }

    if (senderId) {
        activeTransfer.delete(senderId);
    }
}

export function handleUserId(socket: ISocketExtended, parsed: IMessage) {
    const userId = parsed.msg?.trim() ?? '';
    if (clientsList.has(userId)) {
        socket.write(stringify({
            type: Type.ID,
            msg: Red + 'This user id is already taken try another: ' + RESET_COLOR
        }))
    } else {
        socket.userId = userId
        clientsList.set(userId, socket)
        socket.write(stringify({
            type: Type.SERVER_RESPONSE,
            msg: `${Green}Welcome ${socket.userId}\n${greetings}${RESET_COLOR}`
        }))
        console.log(`Clinet ${socket.userId} connected`)
    }
}

export function handleListUsers(socket: ISocketExtended) {
    const userIds = [...clientsList.keys()].filter(userId => userId !== socket.userId).join('\n')

    socket.write(stringify({
        type: Type.SERVER_RESPONSE,
        msg: Blue + (userIds ? userIds : 'Currently no one is online\n') + Green + OPTIONS + '\n\n' + RESET_COLOR
    }))
}

export function handleSendTo(socket: ISocketExtended, parsed: IMessage) {
    const rawMessage = parsed.msg ?? '';
    const separatorIndex = rawMessage.indexOf(':');

    if (separatorIndex === -1) {
        socket.write(stringify({
            type: Type.FEEDABCK,
            msg: Red + 'Enter Valid User Name\n\n' + RESET_COLOR
        }))
        return
    }

    const userId = rawMessage.slice(0, separatorIndex).trim();
    const msg = rawMessage.slice(separatorIndex + 1).trim();
    const targetClient = clientsList.get(userId);

    if (!userId || !msg) {
        socket.write(stringify({
            type: Type.FEEDABCK,
            msg: Red + 'Enter Valid User Name\n\n' + RESET_COLOR
        }))
        return
    }

    if (!targetClient) {
        socket.write(stringify({
            type: Type.FEEDABCK,
            msg: Red + `${userId} is not online\n` + RESET_COLOR
        }))
        return
    }

    targetClient.write(stringify({
        type: Type.CLIENT_RESPONSE,
        userId: socket.userId,
        msg: Yellow + msg + '\n' + RESET_COLOR
    }))

    socket.write(stringify({
        type: Type.FEEDABCK,
        msg: Green + `Sent to ${userId}\n` + RESET_COLOR
    }))
}

export function handleSendFile(
    socket: ISocketExtended,
    parsed: IMessage,
    targetDrainState: TargetDrainState,
    pendingFileMessages: Array<PendingFileMessage>
) {
    if (socket.userId && abortedTransferFileIds.get(socket.userId) !== (parsed.fileId ?? '__unknown_transfer__')) {
        abortedTransferFileIds.delete(socket.userId);
    }

    const targetClient = parsed.to ? clientsList.get(parsed.to) : undefined;

    if (!targetClient) {
        abortTransferForSender(socket, {
            to: parsed.to,
            fileId: parsed.fileId,
            fileSize: parsed.fileSize,
            transferedBytes: parsed.currentTotalBytes
        }, parsed.to);
        return
    }

    if (socket.userId) {
        activeTransfer.set(socket.userId, {
            to: parsed.to,
            from: parsed.from,
            fileId: parsed.fileId,
            fileSize: parsed.fileSize,
            transferedBytes: parsed.currentTotalBytes
        })
    }

    pendingFileMessages.push({ targetClient, message: parsed })
    processServerPendingFileMessages(socket, targetDrainState, pendingFileMessages)
}

export function handleFolderTransferComplete(socket: ISocketExtended, parsed: IMessage) {
    const targetClient = parsed.to ? clientsList.get(parsed.to) : undefined;

    if (!targetClient || !parsed.folderName) {
        return
    }

    targetClient.write(stringify({
        type: Type.FOLDER_TRANSFER_COMPLETE,
        from: socket.userId,
        folderName: parsed.folderName
    }))
}

export function handleRecievedFiles(socket: ISocketExtended, parsed: IMessage) {
    if (!parsed.from) {
        return
    }

    abortedTransferFileIds.delete(parsed.from);

    const senderClient = clientsList.get(parsed.from);
    if (senderClient) {
        senderClient.write(stringify({
            type: Type.RECIEVED_FILE,
            from: socket.userId,
            fileId: parsed.fileId
        }))
    }

    activeTransfer.delete(parsed.from)
}
