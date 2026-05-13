import readline from 'node:readline';
import fsp from 'node:fs/promises';
import pathModule from 'node:path';
import fs from 'node:fs';
import { Green, Red, RESET_COLOR, OPTIONS, Yellow, DataFlowIcon, DataFlowMessage } from './constants.js';
import { AskQuestion, Command, DataFlow, IMessage, ISocketExtended, PendingFileMessage, Type } from './types.js';
import { type Socket } from 'node:net';

const progressLineState = new Map<string, { lastRenderedAt: number; visibleLength: number }>();
const PROGRESS_RENDER_INTERVAL_MS = 80;

export function stringify(obj: Object) {
    return JSON.stringify(obj) + '\n'
}

export function parse(str: string) {
    return JSON.parse(str)
}

export function createMessageParser(onMessage: (message: IMessage) => void | Promise<void>) {
    let buffer = '';

    return (chunk: Buffer) => {
        buffer += chunk.toString();

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
            const rawMessage = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (rawMessage) {
                void onMessage(parse(rawMessage) as IMessage);
            }

            newlineIndex = buffer.indexOf('\n');
        }
    }
}

function splitMessageTarget(answer: string) {
    const separatorIndex = answer.indexOf(':');

    if (separatorIndex === -1) {
        return ['', ''] as const;
    }

    return [
        answer.slice(0, separatorIndex).trim(),
        answer.slice(separatorIndex + 1).trim()
    ] as const;
}

function normalizeFilePath(path: string) {
    const trimmedPath = path.trim();
    const quote = trimmedPath[0];

    if ((quote === '"' || quote === "'") && trimmedPath.at(-1) === quote) {
        return trimmedPath.slice(1, -1);
    }

    return trimmedPath;
}

export function askGreetingQuestion(askQuestion: AskQuestion, socket: Socket, parsed: IMessage) {
    askQuestion(parsed.msg ?? '', async (answer) => {
        const cleanAnswer = answer.trim();
        const command = cleanAnswer.toLowerCase();

        if (command === Command.LIST_USERS || command === Command.LU) {
            if (socket.destroyed) {
                return
            }
            socket.write(stringify({
                type: Type.LIST_USERS
            }))
            return
        }
        if (command === Command.CLEAR || command === Command.CLR) {
            readline.cursorTo(process.stdout, 0, 0);
            readline.clearScreenDown(process.stdout);
            askGreetingQuestion(askQuestion, socket, {
                type: Type.FEEDABCK,
                msg: Green + OPTIONS + RESET_COLOR + '\n'
            })
            return
        }

        const [userId, msg] = splitMessageTarget(cleanAnswer)

        if (!userId || !msg) {
            process.stdout.write(Red + 'Enter Valid User Name\n\n' + RESET_COLOR)
            askGreetingQuestion(askQuestion, socket, {
                type: Type.FEEDABCK,
                msg: Green + OPTIONS + RESET_COLOR + '\n'
            })
            return
        } else {
            if (socket.destroyed) {
                return
            }
            if (msg.toLocaleLowerCase().includes('-f')) {
                const path = normalizeFilePath(msg.slice(msg.toLowerCase().indexOf('-f') + 2))
                const isValid = await isValidPath(path)
                if (socket.destroyed) {
                    return
                }
                if (!isValid) {
                    process.stdout.write(Red + 'Please provide a valid path\n\n' + RESET_COLOR)
                    askGreetingQuestion(askQuestion, socket, {
                        type: Type.FEEDABCK,
                        msg: Green + OPTIONS + RESET_COLOR + '\n'
                    })
                    return
                }
                const readStream = fs.createReadStream(path, { highWaterMark: 16 * 1024 })
                const fileName = pathModule.basename(path);
                const fileSize = (await fsp.stat(path)).size;
                let seq = 0;
                let currentTotalBytes = 0;
                const fileId = `${userId}-${Date.now()}`
                readStream.on('data', (chunk) => {
                    currentTotalBytes += chunk.length;
                    const message = {
                        type: Type.SEND_FILE,
                        to: userId,
                        data: chunk.toString('base64'),
                        fileSize: fileSize,
                        fileName: fileName,
                        bytes: chunk.length,
                        currentTotalBytes: currentTotalBytes,
                        fileId: fileId,
                        seq: seq++
                    };
                    const canContinue = socket.write(stringify(message), () => {
                        showProgressBarWithMetaData(message, DataFlow.UPLOAD)
                    })
                    if (!canContinue) {
                        readStream.pause()
                        socket.once('drain', () => {
                            readStream.resume();
                        })
                    }
                })
                readStream.on('end', () => {
                    seq = 0;
                    askGreetingQuestion(askQuestion, socket, {
                        type: Type.FEEDABCK,
                        msg: Green + `File Sent to ${userId}` + RESET_COLOR + '\n'
                    })
                    readStream.close();
                })

                return readStream;
            }
            socket.write(stringify({
                type: Type.SEND_TO,
                msg: cleanAnswer
            }))
            askGreetingQuestion(askQuestion, socket, {
                type: Type.FEEDABCK,
                msg: Green + `Sent to ${userId}` + RESET_COLOR + '\n'
            })
        }
    })
}



export async function isValidPath(path: string) {
    try {
        await fsp.access(path);
        return true;
    } catch {
        return false;
    }
}

function stripAnsi(value: string) {
    return value.replace(/\u001b\[[0-9;]*m/g, '')
}

function formatBytes(bytes: number) {
    if (bytes < 1024) {
        return `${bytes} B`
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function showProgressBarWithMetaData(fileMessage: IMessage, dataFlow: DataFlow) {
    const receivedBytes = fileMessage.currentTotalBytes ?? 0;
    const fileSize = fileMessage.fileSize ?? 0;
    const progressKey = `${dataFlow}:${fileMessage.fileId ?? fileMessage.fileName ?? 'transfer'}`;
    const previousState = progressLineState.get(progressKey);
    const isComplete = fileSize > 0 && receivedBytes >= fileSize;
    const now = Date.now();

    if (previousState && !isComplete && now - previousState.lastRenderedAt < PROGRESS_RENDER_INTERVAL_MS) {
        return
    }

    if (fileSize <= 0) {
        const fallbackLine = `Bytes Received: ${receivedBytes}`;
        const padding = Math.max((previousState?.visibleLength ?? 0) - fallbackLine.length, 0);

        process.stdout.write(`\r${fallbackLine}${' '.repeat(padding)}`);
        progressLineState.set(progressKey, {
            lastRenderedAt: now,
            visibleLength: fallbackLine.length
        })
        return
    }

    const dataFlowIcon = DataFlowIcon[dataFlow];
    const dataFlowMessage = DataFlowMessage[dataFlow];

    const progress = Math.min(receivedBytes / fileSize, 1);
    const barWidth = 50;
    const filledWidth = Math.floor(progress * barWidth);
    const bar = `${'#'.repeat(filledWidth)}${'-'.repeat(barWidth - filledWidth)}`;
    const progressPercent = Math.round(progress * 100).toString().padStart(3, ' ');
    const transferMeta = `${formatBytes(receivedBytes)}/${formatBytes(fileSize)}`;
    const line = `${Yellow}[${bar}] ${dataFlowMessage}: ${progressPercent}% ${dataFlowIcon} ${transferMeta}${RESET_COLOR}`;
    const visibleLength = stripAnsi(line).length;
    const padding = Math.max((previousState?.visibleLength ?? 0) - visibleLength, 0);

    process.stdout.write(`\r${line}${' '.repeat(padding)}`)
    progressLineState.set(progressKey, {
        lastRenderedAt: now,
        visibleLength
    })

    if (isComplete) {
        process.stdout.write('\n')
        progressLineState.delete(progressKey)
    }
}



export function processServerPendingFileMessages(socket: ISocketExtended, isWaitingForTargetDrain: boolean, pendingFileMessages: Array<PendingFileMessage>) {
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
                processServerPendingFileMessages(socket, isWaitingForTargetDrain, pendingFileMessages)
            })
            return
        }
    }
}
