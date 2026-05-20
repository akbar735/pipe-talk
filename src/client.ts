import net, { type Socket } from 'node:net';
import readline from 'node:readline';
import { Cyan, RESET_COLOR } from './constants.js';
import { createMessageParser } from './helper.js';
import {
    createClientHandlerState,
    handleClientMessage,
    handleClientSocketClose,
    handleClientSocketConnect,
    handleClientSocketEnd,
    handleClientSocketError
} from './client-request-handlers.js';
import { type AskQuestion, type IMessage } from './types.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const connectionOptions = {
    host: '192.168.1.3',
    port: 4000
};

type ClientPromptState = {
    activeQuestionController: AbortController | null;
    activeSocket: Socket | null;
    isReadlineClosed: boolean;
    isShuttingDown: boolean;
};

const clientState: ClientPromptState = {
    activeQuestionController: null,
    activeSocket: null,
    isReadlineClosed: false,
    isShuttingDown: false
};

rl.on('close', () => {
    clientState.isReadlineClosed = true;
});

const clientHandlerState = createClientHandlerState();

function clearActiveQuestion() {
    if (!clientState.activeQuestionController) {
        return;
    }

    clientState.activeQuestionController.abort();
    clientState.activeQuestionController = null;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
}

const askQuestion: AskQuestion = (query, onAnswer) => {
    if (clientState.isReadlineClosed || clientState.isShuttingDown) {
        return;
    }

    clearActiveQuestion();
    clientState.activeQuestionController = new AbortController();

    try {
        rl.question(query, { signal: clientState.activeQuestionController.signal }, (answer) => {
            onAnswer(answer);
        });
    } catch (error) {
        if (error instanceof Error && error.message.includes('readline was closed')) {
            return;
        }

        throw error;
    }
};

function connectToServer() {
    if (clientState.isShuttingDown) {
        return;
    }

    const socket = net.createConnection(connectionOptions);
    clientState.activeSocket = socket;
    registerSocketEvents(socket);
}

function askRetryQuestion() {
    if (clientState.isReadlineClosed || clientState.isShuttingDown) {
        return;
    }

    askQuestion(Cyan + 'Enter try to Retry Connection\n' + RESET_COLOR, (answer) => {
        if (answer.trim().toLowerCase() === 'try') {
            connectToServer();
            return;
        }

        askRetryQuestion();
    });
}

function shutdownClient() {
    if (clientState.isShuttingDown) {
        return;
    }

    clientState.isShuttingDown = true;
    clearActiveQuestion();
    clientState.activeSocket?.destroy();

    if (!clientState.isReadlineClosed) {
        rl.close();
    }

    process.exit(0);
}

function registerSocketEvents(activeSocket: Socket) {
    const handleMessage = createMessageParser((parsed: IMessage) => {
        handleClientMessage(clientHandlerState, askQuestion, activeSocket, parsed);
    });

    activeSocket.on('data', handleMessage);
    activeSocket.on('error', handleClientSocketError);
    activeSocket.on('connect', handleClientSocketConnect);
    activeSocket.on('end', () => {
        handleClientSocketEnd(clientHandlerState, clearActiveQuestion);
    });
    activeSocket.on('close', () => {
        if (clientState.activeSocket === activeSocket) {
            clientState.activeSocket = null;
        }
        handleClientSocketClose(clientHandlerState, clearActiveQuestion, askRetryQuestion);
    });
}

process.once('SIGINT', shutdownClient);
process.once('SIGTERM', shutdownClient);

connectToServer();
