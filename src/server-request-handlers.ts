import { Blue, Green, greetings, OPTIONS, Red, RESET_COLOR, Yellow } from "./constants.js";
import { activeTransfer, clientsList } from "./globals.js";
import { processServerPendingFileMessages, stringify } from "./helper.js";
import { IMessage, ISocketExtended, PendingFileMessage, TargetDrainState, Type } from "./types.js";

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
    const [userId, msg] = (parsed.msg ?? '').split(':').map((item: string) => item?.trim())
    const targetClient = clientsList.get(userId);
    if (targetClient && msg) {
        targetClient.write(stringify({
            type: Type.CLIENT_RESPONSE,
            userId: socket.userId,
            msg: Yellow + msg + '\n' + RESET_COLOR
        }))
    }
}

export function handleSendFile(
    socket: ISocketExtended,
    parsed: IMessage,
    targetDrainState: TargetDrainState,
    pendingFileMessages: Array<PendingFileMessage>
) {
    const targetClient = parsed.to ? clientsList.get(parsed.to) : undefined;

    if (socket.userId && (!activeTransfer.get(socket.userId))) {
        activeTransfer.set(socket.userId, {
            to: parsed.to,
            from: parsed.from,
            fileSize: parsed.fileSize,
            transferedBytes: parsed.currentTotalBytes
        })
    } else if (socket.userId && (activeTransfer.get(socket.userId))) {
        activeTransfer.set(socket.userId, {
            to: parsed.to,
            from: parsed.from,
            fileSize: parsed.fileSize,
            transferedBytes: parsed.currentTotalBytes
        })
    }
    if (targetClient) {
        pendingFileMessages.push({ targetClient, message: parsed })
        processServerPendingFileMessages(socket, targetDrainState, pendingFileMessages)
    }
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
