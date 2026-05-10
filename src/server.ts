import net from 'node:net';
import { createMessageParser, stringify } from './helper.js';
import { Blue, greetings, Green, Red, Yellow, RESET_COLOR, OPTIONS } from './constants.js';
import { IMessage, ISocketExtended, ITransferState, Type } from './types.js';

const clientsList = new Map<string, ISocketExtended>()
const activeTransfer = new Map<string, ITransferState>();

const server = net.createServer((socket: ISocketExtended) => {
    const pendingFileMessages: Array<{ targetClient: ISocketExtended; message: IMessage }> = []
    let isWaitingForTargetDrain = false;

    function processPendingFileMessages() {
        if (isWaitingForTargetDrain) {
            return
        }

        while (pendingFileMessages.length > 0) {
            const nextMessage = pendingFileMessages[0];
            const canContinue = nextMessage.targetClient.write(stringify({
                type: Type.RECIEVE_FILE,
                from: socket.userId,
                data: nextMessage.message.data,
                fileId: nextMessage.message.fileId,
                fileName: nextMessage.message.fileName,
                fileSize: nextMessage.message.fileSize,
                bytes: nextMessage.message.bytes,
                currentTotalBytes: nextMessage.message.currentTotalBytes,
                seq: nextMessage.message.seq
            }))

            pendingFileMessages.shift()

            if (!canContinue) {
                isWaitingForTargetDrain = true
                socket.pause()
                nextMessage.targetClient.once('drain', () => {
                    isWaitingForTargetDrain = false
                    socket.resume()
                    processPendingFileMessages()
                })
                return
            }
        }
    }

    socket.write(stringify({
        type: Type.ID,
        msg: 'Enter your user Id: '
    }))

    const handleMessage = createMessageParser((parsed) => {
        if (!socket.userId) {
            if (parsed.type === Type.ID) {
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
        } else {
            if (parsed.type === Type.LIST_USERS) {
                const userIds = [...clientsList.keys()].filter(userId => userId !== socket.userId).join('\n')

                socket.write(stringify({
                    type: Type.SERVER_RESPONSE,
                    msg: Blue + (userIds ? userIds : 'Currently no one is online\n') + Green + OPTIONS + '\n\n' + RESET_COLOR
                }))
            }
            if (parsed.type === Type.SEND_TO) {
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
            if (parsed.type === Type.SEND_FILE) {
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
                    processPendingFileMessages()
                }
            }
            if (parsed.type === Type.RECIEVED_FILE) {
                if (parsed.from) {
                    activeTransfer.delete(parsed.from)
                }
            }
        }
    });
    socket.on('data', handleMessage);
    socket.on('close', () => {
        console.log(`Client disconnected: ${socket.userId}`)

        if (socket.userId) {

            if (activeTransfer.get(socket.userId) && activeTransfer.get(socket.userId)?.to) {
                const targetClient = clientsList.get(activeTransfer.get(socket.userId)?.to as string)
                if (targetClient) {
                    targetClient.write(stringify({
                        type: Type.TRANSFER_ABORTED,
                    }))
                }
            }
            clientsList.delete(socket.userId)
        }
    })
    socket.on('error', (err) => {
        console.log(`Client Lost:`, err.message)
    })
});

server.listen(4000, '0.0.0.0', () => {
    console.log(`Server started on: ${JSON.stringify(server.address())}`)
})
