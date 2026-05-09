import readline from 'node:readline';
import fsp from 'node:fs/promises';
import pathModule from 'node:path';
import fs from 'node:fs';
import { Green, Red, RESET_COLOR, OPTIONS } from './constants.js';
import { AskQuestion, Command, IMessage, Type } from './types.js';
import { type Socket } from 'node:net';

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
                const fileId = `${userId}-${Date.now()}`
                readStream.on('data', (chunk) => {
                    const canContinue = socket.write(stringify({
                        type: Type.SEND_FILE,
                        to: userId,
                        data: chunk.toString('base64'),
                        fileSize: fileSize,
                        fileName: fileName,
                        bytes: chunk.length,
                        fileId: fileId,
                        seq: seq++
                    }))
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
