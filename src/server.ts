import net from 'node:net';
import { createMessageParser, stringify } from './helper.js';
import { ISocketExtended, PendingFileMessage, TargetDrainState, Type } from './types.js';
import { handleFolderTransferComplete, handleListUsers, handleRecievedFiles, handleSendFile, handleSendTo, handleUserId } from './server-request-handlers.js';
import { activeTransfer, clientsList } from './globals.js';



const server = net.createServer((socket: ISocketExtended) => {
    const pendingFileMessages: Array<PendingFileMessage> = []
    const targetDrainState: TargetDrainState = {
        isWaitingForTargetDrain: false
    };

    socket.write(stringify({
        type: Type.ID,
        msg: 'Enter your user Id: '
    }))

    const handleMessage = createMessageParser((parsed) => {
        if (!socket.userId) {
            if (parsed.type === Type.ID) {
               handleUserId(socket, parsed)
            }
        } else {
            if (parsed.type === Type.LIST_USERS) {
                handleListUsers(socket)
            }
            if (parsed.type === Type.SEND_TO) {
               handleSendTo(socket, parsed)
            }
            if (parsed.type === Type.SEND_FILE) {
               handleSendFile(socket, parsed, targetDrainState, pendingFileMessages)
            }
            if (parsed.type === Type.FOLDER_TRANSFER_COMPLETE) {
               handleFolderTransferComplete(socket, parsed)
            }
            if (parsed.type === Type.RECIEVED_FILE) {
                handleRecievedFiles(socket, parsed)
            }
        }
    });

    const handleClose = () => {
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
    }
    const handleError = (err: Error) => {
        console.log(`Client Lost:`, err.message)
    }
    
    socket.on('data', handleMessage);
    socket.on('close', handleClose)
    socket.on('error', handleError)
});

server.listen(4000, '0.0.0.0', () => {
    console.log(`Server started on: ${JSON.stringify(server.address())}`)
})
