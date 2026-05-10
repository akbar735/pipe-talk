import net, { type Socket } from 'node:net';
import fs, { WriteStream } from 'node:fs';
import readline from 'node:readline';
import { createMessageParser, stringify, askGreetingQuestion, showProgressBarWithMetaData } from './helper.js';
import { Cyan, RESET_COLOR, Magenta } from './constants.js'
import { DataFlow, IMessage, Type } from './types.js';


const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})
const connectionOptions = {
    host: '192.168.1.3',
    port: 4000
}

let socket: Socket;
let activeQuestionController: AbortController | null = null
let writeStream: WriteStream | null = null;
const pendingFileMessages: IMessage[] = [];
let isWaitingForFileDrain = false;

function cancelActiveQuestion() {
    if (!activeQuestionController) {
        return
    }

    activeQuestionController.abort()
    activeQuestionController = null
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
}

function askQuestion(query: string, onAnswer: (answer: string) => void) {
    cancelActiveQuestion()
    activeQuestionController = new AbortController()
    rl.question(query, { signal: activeQuestionController.signal }, (answer) => {
        //activeQuestionController = null
        onAnswer(answer)
    })
}

function connectToServer() {
    socket = net.createConnection(connectionOptions)
    registerSocketEvents(socket)
}

function askRetryQuestion() {
    askQuestion(Cyan + 'Enter try to Retry Connection\n' + RESET_COLOR, (answer: string) => {
        if (answer.trim().toLowerCase() === 'try') {
            connectToServer()
            return
        }

        askRetryQuestion()
    })
}

function processPendingFileMessages(activeSocket: Socket) {
    if (isWaitingForFileDrain) {
        return
    }

    while (pendingFileMessages.length > 0) {
        const nextMessage = pendingFileMessages[0];
        const { data, fileId, fileName, seq } = nextMessage;

        if (!data || !fileId || !fileName) {
            pendingFileMessages.shift()
            continue
        }

        if (Number(seq) === 0) {
            writeStream = fs.createWriteStream(`${fileId}${fileName}`);
        }

        if (!writeStream) {
            return
        }

        const isFileComplete = nextMessage.currentTotalBytes === nextMessage.fileSize
        const canContinue = writeStream.write(Buffer.from(data, 'base64'), () => {
            showProgressBarWithMetaData(nextMessage, DataFlow.DOWNLOAD)

            if (!isFileComplete) {
                return
            }

            askGreetingQuestion(askQuestion, activeSocket, {
                type: Type.FEEDABCK,
                msg: Magenta + `You recieved a file ${nextMessage.fileName} from ` + (nextMessage.from ?? 'Unknown user') + '\n' + RESET_COLOR
            })
        })
        pendingFileMessages.shift()

        if (!canContinue) {
            isWaitingForFileDrain = true
            activeSocket.pause()
            writeStream.once('drain', () => {
                isWaitingForFileDrain = false
                activeSocket.resume()
                processPendingFileMessages(activeSocket)
            })
            return
        }
    }
}

function registerSocketEvents(activeSocket: Socket) {
    activeSocket.on('error', (err) => {
        console.log(`Sowmethign went wrong on server: ${err.message}`)
    });

    const handleMessage = createMessageParser((parsed: IMessage) => {
        if (parsed.type === Type.ID) {
            askQuestion(parsed.msg ?? '', (answer) => {
                if (activeSocket.destroyed) {
                    return
                }

                activeSocket.write(stringify({
                    type: Type.ID,
                    msg: answer
                }))
            })
        } else if (parsed.type === Type.SERVER_RESPONSE) {
            askGreetingQuestion(askQuestion, activeSocket, parsed)
        } else if (parsed.type === Type.CLIENT_RESPONSE) {
            askGreetingQuestion(askQuestion, activeSocket, {
                type: Type.FEEDABCK,
                msg: Magenta + (parsed.userId ?? 'Unknown user') + ' ' + 'Sent a Message: ' + RESET_COLOR + (parsed.msg ?? '')
            })
        } else if (parsed.type === Type.RECIEVE_FILE) {
            if (parsed.seq === 0) {
                askGreetingQuestion(askQuestion, activeSocket, {
                    type: Type.FEEDABCK,
                    msg: Magenta + (parsed.from ?? 'Unknown user') + ' ' + `Sending File ${parsed.fileName}\n` + RESET_COLOR
                })
            }
        
            pendingFileMessages.push(parsed)
            processPendingFileMessages(activeSocket)
        }
    })
    activeSocket.on('data', handleMessage)

    activeSocket.on('connect', () => {
        console.log('Client Connected Successfully')
    })

    activeSocket.on('end', () => {
        cancelActiveQuestion()
        console.log(Cyan + '\nServer ended connection' + RESET_COLOR)
    })

    activeSocket.on('close', () => {
        cancelActiveQuestion()
        console.log(Cyan + 'Connection fully closed' + RESET_COLOR)
        askRetryQuestion()
    })
}

connectToServer()
