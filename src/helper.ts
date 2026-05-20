import readline from 'node:readline';
import path from 'node:path';
import fsp, { readdir } from 'node:fs/promises';
import pathModule from 'node:path';
import fs from 'node:fs';
import { Green, Red, RESET_COLOR, OPTIONS, Yellow, DataFlowIcon, DataFlowMessage, progressBarWidth } from './constants.js';
import { AskQuestion, Command, DataFlow, IFileInfo, IMessage, ISocketExtended, PendingFileMessage, ResourceType, TargetDrainState, Type } from './types.js';
import { type Socket } from 'node:net';

const progressLineState = new Map<string, { lastRenderedAt: number; visibleLength: number }>();
const PROGRESS_RENDER_INTERVAL_MS = 80;
const pendingFileReceipts = new Map<string, () => void>();
const completedFileReceipts = new Set<string>();

export function stringify(obj: Object) {
    return JSON.stringify(obj) + '\n'
}

export function parse(str: string) {
    return JSON.parse(str)
}

export function resolvePendingFileReceipt(fileId?: string) {
    if (!fileId) {
        return
    }

    const resolveReceipt = pendingFileReceipts.get(fileId);
    if (!resolveReceipt) {
        completedFileReceipts.add(fileId);
        return
    }

    pendingFileReceipts.delete(fileId);
    resolveReceipt();
}

function waitForFileReceipt(fileId: string) {
    if (completedFileReceipts.has(fileId)) {
        completedFileReceipts.delete(fileId);
        return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
        pendingFileReceipts.set(fileId, resolve);
    });
}

function writeTransferMessage(socket: Socket, message: IMessage) {
    return new Promise<void>((resolve) => {
        let isWriteCallbackComplete = false;
        let isDrainComplete = false;

        const finalize = () => {
            if (!isWriteCallbackComplete) {
                return;
            }

            if (!isDrainComplete) {
                return;
            }

            resolve();
        };

        const canContinue = socket.write(stringify(message), () => {
            showProgressBarWithMetaData(message, DataFlow.UPLOAD)
            isWriteCallbackComplete = true;
            finalize();
        });

        if (canContinue) {
            isDrainComplete = true;
            return;
        }

        socket.once('drain', () => {
            isDrainComplete = true;
            finalize();
        });
    });
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
                const isValid = await isValidPath(path);
                if (isValid.resourceType === ResourceType.INVALID) {
                    process.stdout.write(Red + 'Please provide a valid path\n\n' + RESET_COLOR)
                    askGreetingQuestion(askQuestion, socket, {
                        type: Type.FEEDABCK,
                        msg: Green + OPTIONS + RESET_COLOR + '\n'
                    })
                    return
                }
                if (isValid.resourceType === ResourceType.FILE) {
                    return sendFile(socket, userId, path, askQuestion)
                }
                if (isValid.resourceType === ResourceType.FOLDER) {
                    const folderName = pathModule.basename(path)
                    const files = (await getFilesRecursively(path, folderName)).filter(file => file.fileName !== '.DS_Store')

                    for (const file of files) {
                        await sendFile(socket, userId, file.fullPath, askQuestion, file.filePath, false)
                    }

                    socket.write(stringify({
                        type: Type.FOLDER_TRANSFER_COMPLETE,
                        to: userId,
                        folderName
                    }))

                    askGreetingQuestion(askQuestion, socket, {
                        type: Type.FEEDABCK,
                        msg: Green + `Folder ${folderName} sent to ${userId}` + RESET_COLOR + '\n'
                    })
                    return
                }
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



export async function isValidPath(path: string): Promise<{ resourceType: ResourceType }> {
    try {
        await fsp.access(path);
        const pathInfo = await fsp.stat(path);
        const isDirectory = pathInfo.isDirectory();

        return { resourceType: isDirectory ? ResourceType.FOLDER : ResourceType.FILE };
    } catch {
        return { resourceType: ResourceType.INVALID };
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
    const isComplete = receivedBytes >= fileSize;
    const now = Date.now();

    if (previousState && !isComplete && now - previousState.lastRenderedAt < PROGRESS_RENDER_INTERVAL_MS) {
        return
    }

    if (fileSize === 0) {
        const dataFlowIcon = DataFlowIcon[dataFlow];
        const dataFlowMessage = DataFlowMessage[dataFlow];
        const bar = '#'.repeat(progressBarWidth);
        const line = `${Yellow}[${bar}] ${dataFlowMessage}: 100% ${dataFlowIcon} 0 B/0 B${RESET_COLOR}`;
        const visibleLength = stripAnsi(line).length;
        const padding = Math.max((previousState?.visibleLength ?? 0) - visibleLength, 0);

        process.stdout.write(`\r${line}${' '.repeat(padding)}\n`);
        progressLineState.delete(progressKey)
        return
    }

    const dataFlowIcon = DataFlowIcon[dataFlow];
    const dataFlowMessage = DataFlowMessage[dataFlow];

    const progress = Math.min(receivedBytes / fileSize, 1);

    const filledWidth = Math.floor(progress * progressBarWidth);
    const bar = `${'#'.repeat(filledWidth)}${'-'.repeat(progressBarWidth - filledWidth)}`;
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



export function processServerPendingFileMessages(socket: ISocketExtended, targetDrainState: TargetDrainState, pendingFileMessages: Array<PendingFileMessage>) {
    if (targetDrainState.isWaitingForTargetDrain) {
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
            filePath: nextMessage.message.filePath,
            bytes: nextMessage.message.bytes,
            currentTotalBytes: nextMessage.message.currentTotalBytes,
            seq: nextMessage.message.seq
        }))

        pendingFileMessages.shift()

        if (!canContinue) {
            targetDrainState.isWaitingForTargetDrain = true
            socket.pause()
            nextMessage.targetClient.once('drain', () => {
                targetDrainState.isWaitingForTargetDrain = false
                socket.resume()
                processServerPendingFileMessages(socket, targetDrainState, pendingFileMessages)
            })
            return
        }
    }
}


async function sendFile(
    socket: Socket,
    userId: string,
    path: string,
    askQuestion: AskQuestion,
    filePath?: string,
    shouldPromptOnComplete = true
) {
    if (socket.destroyed) {
        return
    }

    const fileSize = (await fsp.stat(path)).size;
    const fileName = pathModule.basename(path);
    const fileId = `${userId}-${Date.now()}`
    const resolvedFilePath = filePath ? filePath : fileName
    askGreetingQuestion(askQuestion, socket, {
        type: Type.FEEDABCK,
        msg: Green + `Sending ${fileName.length > 25 ? fileName.slice(0,25): fileName}...` + RESET_COLOR + '\n'
    })

    if (fileSize === 0) {
        await writeTransferMessage(socket, {
            type: Type.SEND_FILE,
            to: userId,
            data: '',
            fileSize,
            fileName,
            filePath: resolvedFilePath,
            bytes: 0,
            currentTotalBytes: 0,
            fileId,
            seq: 0
        })

        await waitForFileReceipt(fileId)

        if (!shouldPromptOnComplete) {
            return
        }

        askGreetingQuestion(askQuestion, socket, {
            type: Type.FEEDABCK,
            msg: Green + `File ${fileName} Sent to ${userId}` + RESET_COLOR + '\n'
        })
        return
    }

    await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(path, { highWaterMark: 16 * 1024 })
        let seq = 0;
        let currentTotalBytes = 0;

        readStream.on('data', (chunk) => {
            currentTotalBytes += chunk.length;
            const message = {
                type: Type.SEND_FILE,
                to: userId,
                data: chunk.toString('base64'),
                fileSize: fileSize,
                fileName: fileName,
                filePath: resolvedFilePath,
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

        readStream.once('error', reject)
        readStream.on('end', () => {
            readStream.close();
            resolve();
        })
    })

    await waitForFileReceipt(fileId)

    if (!shouldPromptOnComplete) {
        return
    }

    askGreetingQuestion(askQuestion, socket, {
        type: Type.FEEDABCK,
        msg: Green + `File ${fileName} Sent to ${userId}` + RESET_COLOR + '\n'
    })
}

async function getFilesRecursively(rootDirectory: string, baseName: string): Promise<IFileInfo[]> {
    const entries = await readdir(rootDirectory, {
        recursive: true,
        withFileTypes: true
    })

    return entries.filter(entry => entry.isFile()).map(entry => {
        return {
            fileName: entry.name,
            filePath: baseName + '/' + path.relative(rootDirectory, path.join(entry.parentPath, entry.name)),
            fullPath: path.join(entry.parentPath, entry.name)
        }
    })
}
