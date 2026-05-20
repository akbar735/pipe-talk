import fs, { type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { type Socket } from 'node:net';
import { Cyan, Magenta, Red, RESET_COLOR } from './constants.js';
import { abortPendingFileTransfer, askGreetingQuestion, resolvePendingFileReceipt, showProgressBarWithMetaData, stringify } from './helper.js';
import { type AskQuestion, DataFlow, type IMessage, Type } from './types.js';
import path from 'node:path';

type ClientHandlerState = {
    writeStream: WriteStream | null;
    pendingFileMessages: IMessage[];
    isWaitingForFileDrain: boolean;
    isProcessingPendingMessages: boolean;
    isFinalizingCurrentFile: boolean;
};

export function createClientHandlerState(): ClientHandlerState {
        return {
            writeStream: null,
            pendingFileMessages: [],
            isWaitingForFileDrain: false,
            isProcessingPendingMessages: false,
            isFinalizingCurrentFile: false
        };
}

function closeWriteStream(state: ClientHandlerState) {
    const writeStream = state.writeStream;
    if (!writeStream) {
        return;
    }

    state.writeStream = null;
    writeStream.end();
}

function resetPendingFileState(state: ClientHandlerState) {
    closeWriteStream(state);
    state.pendingFileMessages.length = 0;
    state.isWaitingForFileDrain = false;
    state.isProcessingPendingMessages = false;
    state.isFinalizingCurrentFile = false;
}

async function createWriteStreamForMessage(state: ClientHandlerState, message: IMessage) {
    if (!message.fileId || !message.fileName || !message.filePath) {
        return null;
    }
    if(message.fileName !== message.filePath){
        await mkdir(
            path.dirname(message.filePath as string),
            { recursive: true }
        );
    }

    closeWriteStream(state);
    state.writeStream = fs.createWriteStream(`${message.filePath}`);

    return state.writeStream;
}

async function getWriteStreamForMessage(state: ClientHandlerState, message: IMessage) {
    if (message.seq === 0) {
        return await createWriteStreamForMessage(state, message);
    }

    return state.writeStream;
}

function notifyIncomingFile(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    askGreetingQuestion(askQuestion, activeSocket, {
        type: Type.FEEDABCK,
        msg: Magenta + (message.from ?? 'Unknown user') + ` Sending File ${message.fileName}\n` + RESET_COLOR
    });
}

function notifyFileReceived(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    askGreetingQuestion(askQuestion, activeSocket, {
        type: Type.FEEDABCK,
        msg: Magenta + `You recieved a file ${(message.fileName?.length ?? 0) > 25 ? message.fileName?.slice(0,25): message.fileName} from ` + (message.from ?? 'Unknown user') + '\n' + RESET_COLOR
    });
}

function notifyFolderReceived(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    askGreetingQuestion(askQuestion, activeSocket, {
        type: Type.FEEDABCK,
        msg: Magenta + `You recieved Folder ${message.folderName ?? 'Unknown folder'} from ` + (message.from ?? 'Unknown user') + '\n' + RESET_COLOR
    });
}

function acknowledgeFileReceipt(activeSocket: Socket, message: IMessage) {
    activeSocket.write(stringify({
        type: Type.RECIEVED_FILE,
        from: message.from,
        fileId: message.fileId
    }));
}

function finishFileDownload(
    state: ClientHandlerState,
    askQuestion: AskQuestion,
    activeSocket: Socket,
    message: IMessage,
    writeStream: WriteStream
) {
    if (state.writeStream === writeStream) {
        state.writeStream = null;
    }

    notifyFileReceived(askQuestion, activeSocket, message);
    acknowledgeFileReceipt(activeSocket, message);
}

function finalizeFileDownload(
    state: ClientHandlerState,
    askQuestion: AskQuestion,
    activeSocket: Socket,
    message: IMessage,
    writeStream: WriteStream,
    chunk: Buffer
) {
    state.pendingFileMessages.shift();
    state.isFinalizingCurrentFile = true;

    writeStream.end(chunk, () => {
        showProgressBarWithMetaData(message, DataFlow.DOWNLOAD);
        finishFileDownload(state, askQuestion, activeSocket, message, writeStream);
        state.isFinalizingCurrentFile = false;
        void processPendingFileMessages(state, askQuestion, activeSocket);
    });
}

function waitForFileDrain(
    state: ClientHandlerState,
    askQuestion: AskQuestion,
    activeSocket: Socket,
    writeStream: WriteStream
) {
    state.isWaitingForFileDrain = true;
    activeSocket.pause();

    writeStream.once('drain', () => {
        state.isWaitingForFileDrain = false;
        activeSocket.resume();
        void processPendingFileMessages(state, askQuestion, activeSocket);
    });
}

function writeFileChunk(
    state: ClientHandlerState,
    askQuestion: AskQuestion,
    activeSocket: Socket,
    message: IMessage,
    writeStream: WriteStream
) {
    const chunk = Buffer.from(message.data ?? '', 'base64');
    const fileSize = message.fileSize ?? 0;
    const currentTotalBytes = message.currentTotalBytes ?? 0;
    const isFileComplete = currentTotalBytes >= fileSize;

    if (isFileComplete) {
        finalizeFileDownload(state, askQuestion, activeSocket, message, writeStream, chunk);
        return;
    }

    const canContinue = writeStream.write(chunk, () => {
        showProgressBarWithMetaData(message, DataFlow.DOWNLOAD);
    });

    state.pendingFileMessages.shift();

    if (!canContinue) {
        waitForFileDrain(state, askQuestion, activeSocket, writeStream);
    }
}

async function processPendingFileMessages(state: ClientHandlerState, askQuestion: AskQuestion, activeSocket: Socket) {
    if (state.isWaitingForFileDrain || state.isProcessingPendingMessages || state.isFinalizingCurrentFile) {
        return;
    }

    state.isProcessingPendingMessages = true;

    try {
        while (state.pendingFileMessages.length > 0) {
            const nextMessage = state.pendingFileMessages[0];

            if (
                nextMessage.data === undefined
                || !nextMessage.fileId
                || !nextMessage.fileName
                || nextMessage.fileSize === undefined
                || nextMessage.currentTotalBytes === undefined
                || nextMessage.seq === undefined
                || (nextMessage.seq === 0 && !nextMessage.filePath)
            ) {
                state.pendingFileMessages.shift();
                continue;
            }

            const writeStream = await getWriteStreamForMessage(state, nextMessage);
            if (!writeStream) {
                state.pendingFileMessages.shift();
                continue;
            }

            writeFileChunk(state, askQuestion, activeSocket, nextMessage, writeStream);

            if (state.isWaitingForFileDrain || state.isFinalizingCurrentFile) {
                return;
            }
        }
    } finally {
        state.isProcessingPendingMessages = false;

        if (!state.isWaitingForFileDrain && !state.isFinalizingCurrentFile && state.pendingFileMessages.length > 0) {
            void processPendingFileMessages(state, askQuestion, activeSocket);
        }
    }
}

function handleIdPrompt(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    askQuestion(message.msg ?? '', (answer) => {
        if (activeSocket.destroyed) {
            return;
        }

        activeSocket.write(stringify({
            type: Type.ID,
            msg: answer
        }));
    });
}

function handleServerResponse(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    askGreetingQuestion(askQuestion, activeSocket, message);
}

function handleClientResponse(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    askGreetingQuestion(askQuestion, activeSocket, {
        type: Type.FEEDABCK,
        msg: Magenta + (message.userId ?? 'Unknown user') + ' Sent a Message: ' + RESET_COLOR + (message.msg ?? '')
    });
}

function handleIncomingFile(
    state: ClientHandlerState,
    askQuestion: AskQuestion,
    activeSocket: Socket,
    message: IMessage
) {
    if (message.seq === 0) {
        notifyIncomingFile(askQuestion, activeSocket, message);
    }

    state.pendingFileMessages.push(message);
    void processPendingFileMessages(state, askQuestion, activeSocket);
}

function handleTransferAborted(state: ClientHandlerState, askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    resetPendingFileState(state);
    abortPendingFileTransfer(
        message.fileId,
        message.msg ?? `${message.from ?? 'The other user'} is no longer connected. Transfer cancelled.`
    );

    askGreetingQuestion(askQuestion, activeSocket, {
        type: Type.FEEDABCK,
        msg: Red + (message.msg ?? 'File Transfered cancelled') + '\n' + RESET_COLOR
    });
}

function handleFolderTransferComplete(askQuestion: AskQuestion, activeSocket: Socket, message: IMessage) {
    notifyFolderReceived(askQuestion, activeSocket, message);
}

function handleReceivedFileAck(message: IMessage) {
    resolvePendingFileReceipt(message.fileId);
}

export function handleClientMessage(
    state: ClientHandlerState,
    askQuestion: AskQuestion,
    activeSocket: Socket,
    message: IMessage
) {
    switch (message.type) {
        case Type.ID:
            handleIdPrompt(askQuestion, activeSocket, message);
            return;
        case Type.SERVER_RESPONSE:
            handleServerResponse(askQuestion, activeSocket, message);
            return;
        case Type.CLIENT_RESPONSE:
            handleClientResponse(askQuestion, activeSocket, message);
            return;
        case Type.RECIEVE_FILE:
            handleIncomingFile(state, askQuestion, activeSocket, message);
            return;
        case Type.TRANSFER_ABORTED:
            handleTransferAborted(state, askQuestion, activeSocket, message);
            return;
        case Type.FOLDER_TRANSFER_COMPLETE:
            handleFolderTransferComplete(askQuestion, activeSocket, message);
            return;
        case Type.RECIEVED_FILE:
            handleReceivedFileAck(message);
            return;
        default:
            return;
    }
}

export function handleClientSocketError(error: Error) {
    console.log(`Sowmethign went wrong on server: ${error.message}`);
}

export function handleClientSocketConnect() {
    console.log('Client Connected Successfully');
}

export function handleClientSocketEnd(state: ClientHandlerState, clearActiveQuestion: () => void) {
    clearActiveQuestion();
    closeWriteStream(state);
    console.log(Cyan + '\nServer ended connection' + RESET_COLOR);
}

export function handleClientSocketClose(
    state: ClientHandlerState,
    clearActiveQuestion: () => void,
    askRetryQuestion: () => void
) {
    clearActiveQuestion();
    closeWriteStream(state);
    console.log(Cyan + 'Connection fully closed' + RESET_COLOR);
    askRetryQuestion();
}
